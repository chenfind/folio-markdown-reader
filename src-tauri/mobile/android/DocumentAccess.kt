package app.folio.mobile

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.util.UUID

class DocumentAccess(private val context: Context) {
    private val preferences = context.getSharedPreferences("folio-documents", Context.MODE_PRIVATE)

    companion object {
        private const val LIMIT = 24 * 1024 * 1024
        fun readBounded(input: InputStream): ByteArray {
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(16 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                require(output.size() + count <= LIMIT) { "文件超过 24 MB，暂时无法打开。" }
                output.write(buffer, 0, count)
            }
            return output.toByteArray()
        }
    }

    @Synchronized
    fun registerUri(uri: Uri, directory: Boolean): JSONObject {
        val document = (if (directory) DocumentFile.fromTreeUri(context, uri) else DocumentFile.fromSingleUri(context, uri))
            ?: throw IllegalArgumentException("无法读取所选文件。")
        val name = document.name ?: if (directory) "文档目录" else "Document.md"
        val existing = preferences.all.entries.firstOrNull { (_, value) ->
            runCatching { JSONObject(value as String).optString("uri") == uri.toString() }.getOrDefault(false)
        }?.key
        val id = existing ?: UUID.randomUUID().toString()
        check(preferences.edit().putString(id, JSONObject().put("uri", uri.toString()).put("directory", directory).put("name", name).toString()).commit()) { "无法保存文件授权记录。" }
        return JSONObject().put("path", "saf:/" + id + if (directory) "" else "/" + name)
            .put("directory", directory).put("label", name)
    }

    @Synchronized
    fun registerClone(root: File, label: String): String {
        val id = root.name
        check(preferences.edit().putString(id, JSONObject().put("local", root.canonicalPath).put("directory", true).put("label", label).toString()).commit()) { "无法保存仓库记录。" }
        return "saf:/" + id
    }

    private data class Location(val source: JSONObject, val parts: List<String>)

    private fun location(path: String): Location {
        require(path.startsWith("saf:/")) { "文件标识无效。" }
        val pieces = path.removePrefix("saf:/").split('/')
        require(pieces.isNotEmpty() && pieces.drop(1).all { it.isNotEmpty() && it != "." && it != ".." && !it.contains('\\') }) { "文件路径无效。" }
        val saved = preferences.getString(pieces[0], null) ?: throw IllegalStateException("请重新选择此文件或文件夹。")
        return Location(JSONObject(saved), pieces.drop(1))
    }

    private fun document(location: Location): DocumentFile {
        val uri = Uri.parse(location.source.getString("uri"))
        if (!location.source.getBoolean("directory")) {
            require(location.parts.singleOrNull() == location.source.getString("name")) { "此链接需要所在文件夹的访问授权，请打开该文件夹。" }
            return DocumentFile.fromSingleUri(context, uri) ?: throw IllegalStateException("文件授权已失效。")
        }
        var document = DocumentFile.fromTreeUri(context, uri) ?: throw IllegalStateException("目录授权已失效。")
        for (name in location.parts) {
            document = document.findFile(name) ?: throw IllegalStateException("文件已移动或删除，请刷新文档库。")
        }
        return document
    }

    private fun local(location: Location): File {
        val root = File(location.source.getString("local")).canonicalFile
        val file = location.parts.fold(root) { parent, name -> File(parent, name) }.canonicalFile
        require(file == root || file.path.startsWith(root.path + File.separator)) { "文件超出已授权目录。" }
        return file
    }

    fun list(path: String): JSONArray {
        val location = location(path)
        val result = JSONArray()
        if (location.source.has("local")) {
            val root = local(location)
            val files = root.listFiles() ?: throw IllegalStateException("无法读取克隆目录。")
            for (file in files) {
                if (java.nio.file.Files.isSymbolicLink(file.toPath())) continue
                result.put(JSONObject().put("path", path + "/" + file.name).put("directory", file.isDirectory))
            }
        } else {
            val root = document(location)
            require(root.isDirectory) { "此路径不是文件夹。" }
            for (file in root.listFiles()) {
                val name = file.name ?: continue
                if (!file.isDirectory && !file.isFile) continue
                result.put(JSONObject().put("path", path + "/" + name).put("directory", file.isDirectory))
            }
        }
        return result
    }

    fun read(path: String): ByteArray {
        val location = location(path)
        if (location.source.has("local")) return local(location).inputStream().use(::readBounded)
        val document = document(location)
        val stream = context.contentResolver.openInputStream(document.uri) ?: throw IllegalStateException("无法打开文档。")
        return stream.use(::readBounded)
    }
}
