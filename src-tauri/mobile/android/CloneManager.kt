package app.folio.mobile

import android.content.Context
import app.tauri.plugin.JSObject
import org.eclipse.jgit.api.Git
import org.eclipse.jgit.lib.ProgressMonitor
import org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider
import org.json.JSONObject
import java.io.File
import java.net.URI
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

class CloneManager(
    context: Context,
    private val documents: DocumentAccess,
    private val secrets: SecureCredentials,
) {
    private val root = File(context.filesDir, "repositories").apply { mkdirs() }.canonicalFile
    private val active = AtomicBoolean(false)
    private val cancelled = AtomicBoolean(false)
    private val foreground = AtomicBoolean(true)
    @Volatile private var progress = JSObject().put("phase", "idle").put("completed", 0).put("total", 0) as JSObject

    fun status(): JSObject = progress
    fun cancel() { if (active.get()) cancelled.set(true) }
    @Synchronized fun setForeground(value: Boolean) { foreground.set(value); if (!value) cancel() }

    private fun report(phase: String, completed: Int = 0, total: Int = 0) {
        progress = JSObject().put("phase", phase).put("completed", completed).put("total", total) as JSObject
    }

    @Synchronized
    fun cleanAbandonedTasks() {
        if (active.get()) return
        root.listFiles()?.filter { it.name.matches(Regex("\\.pending-[0-9a-f-]{36}")) }
            ?.forEach { runCatching { removePending(it) } }
        val registered = runCatching { documents.activeCloneDirectories() }.getOrNull() ?: return
        root.listFiles()?.filter { it.name.matches(Regex("[0-9a-f-]{36}")) && it.canonicalPath !in registered }
            ?.forEach { runCatching { removeSnapshot(it) } }
    }

    private fun removePending(directory: File) {
        require(directory.absoluteFile.parentFile == root && directory.name.matches(Regex("\\.pending-[0-9a-f-]{36}"))) {
            "临时目录不属于此次克隆任务。"
        }
        if (!directory.exists()) return
        Files.walkFileTree(directory.toPath(), object : SimpleFileVisitor<Path>() {
            override fun visitFile(file: Path, attributes: BasicFileAttributes): FileVisitResult {
                Files.delete(file)
                return FileVisitResult.CONTINUE
            }
            override fun postVisitDirectory(directory: Path, error: java.io.IOException?): FileVisitResult {
                if (error != null) throw error
                Files.delete(directory)
                return FileVisitResult.CONTINUE
            }
        })
    }

    private fun managedDirectory(file: File): File {
        val canonical = file.canonicalFile
        require(canonical.parentFile == root && canonical.name.matches(Regex("[0-9a-f-]{36}")) && !Files.isSymbolicLink(file.toPath())) { "此目录不是 Folio 管理的克隆副本。" }
        return canonical
    }

    fun info(path: String): JSObject? {
        if (!path.startsWith("saf:/")) return null
        val record = documents.cloneRecord(path) ?: return null
        val local = managedDirectory(File(record.getString("local")))
        val source = record.optJSONObject("source") ?: Git.open(local).use { git ->
            val url = git.repository.config.getString("remote", "origin", "url") ?: return null
            val parsed = URI(url)
            require(parsed.scheme == "https" && parsed.userInfo == null && parsed.query == null && parsed.fragment == null) { "仓库来源地址不受支持。" }
            val normalized = URI("https", null, parsed.host.lowercase(), parsed.port, parsed.path.trimEnd('/').removeSuffix(".git"), null, null).toString()
            val provider = listOf("github", "gitlab", "git").firstOrNull { secrets.read("Folio:" + it + ":" + normalized) != null }
                ?: if (parsed.host == "github.com") "github" else if (parsed.host?.contains("gitlab") == true) "gitlab" else "git"
            val ref = git.repository.fullBranch.orEmpty()
            val head = git.repository.resolve("HEAD")
            val tag = git.tagList().call().firstOrNull { (git.repository.refDatabase.peel(it).peeledObjectId ?: it.objectId) == head }?.name?.removePrefix("refs/tags/")
            val branch = if (ref.startsWith("refs/heads/")) ref.removePrefix("refs/heads/") else tag.orEmpty()
            JSONObject().put("url", url).put("provider", provider).put("branch", branch)
        }
        return JSObject().put("path", "saf:/" + path.removePrefix("saf:/").substringBefore('/')).put("source", source)
            .put("directory", record.optString("readingDirectory")) as JSObject
    }

    @Synchronized
    private fun begin() {
        check(foreground.get()) { "请回到应用前台后再更新仓库。" }
        check(active.compareAndSet(false, true)) { "已有克隆任务正在运行。" }
        cancelled.set(false)
    }

    fun clone(args: JSObject): JSObject {
        begin()
        val id = UUID.randomUUID().toString()
        val temporary = File(root, ".pending-" + id)
        val destination = File(root, id)
        var installed = false
        try {
            val previous = args.optString("path").takeIf { it.isNotEmpty() }?.let { info(it) ?: error("此来源不是本地克隆。") }
            val oldDirectory = previous?.let { managedDirectory(File(documents.cloneRecord(it.getString("path")!!)!!.getString("local"))) }
            cleanOldTasksBeforeStart(temporary)
            val url = URI(args.getString("url")!!.trim())
            require(url.scheme == "https" && url.host != null && url.userInfo == null && url.query == null && url.fragment == null) {
                "请填写不含账号或令牌的 HTTPS 仓库地址。"
            }
            val path = url.path.trimEnd('/').removeSuffix(".git")
            val name = path.substringAfterLast('/')
            require(name.isNotBlank()) { "仓库地址无效。" }
            val provider = args.optString("provider")
            val normalized = URI("https", null, url.host.lowercase(), url.port, path, null, null).toString()
            val secretName = "Folio:" + provider + ":" + normalized
            val supplied = args.optString("token").trim()
            val token = supplied.ifEmpty { secrets.read(secretName) ?: "" }
            val branch = args.optString("branch").trim()
            val directory = args.optString("directory").trim().trim('/')
            require(directory.isEmpty() || directory.split('/').all { it.isNotEmpty() && it != "." && it != ".." && !it.contains('\\') }) { "阅读目录必须是仓库内的相对路径。" }
            report("准备连接")
            val monitor = object : ProgressMonitor {
                private var title = "下载仓库"
                private var completed = 0
                private var total = 0
                override fun start(totalTasks: Int) {}
                override fun beginTask(title: String, totalWork: Int) {
                    this.title = title
                    completed = 0
                    total = totalWork
                    report(title, completed, total)
                }
                override fun update(work: Int) { completed += work; report(title, completed, total) }
                override fun endTask() {}
                override fun isCancelled(): Boolean = cancelled.get()
                override fun showDuration(enabled: Boolean) {}
            }
            val command = Git.cloneRepository().setURI(url.toString()).setDirectory(temporary)
                .setDepth(1).setTimeout(30).setProgressMonitor(monitor)
            if (branch.isNotEmpty()) command.setBranch(branch)
            if (token.isNotEmpty()) command.setCredentialsProvider(
                UsernamePasswordCredentialsProvider(if (provider == "github") "x-access-token" else "oauth2", token)
            )
            command.call().use { check(!cancelled.get()) { "已取消克隆。" } }
            val selected = File(temporary, directory).canonicalFile
            require((selected == temporary.canonicalFile || selected.path.startsWith(temporary.canonicalPath + File.separator)) && selected.isDirectory) { "指定阅读目录不存在。" }
            if (supplied.isNotEmpty()) secrets.write(secretName, supplied)
            report("正在完成")
            check(temporary.renameTo(destination)) { "无法保存完整仓库。" }
            val source = JSONObject().put("url", normalized).put("provider", provider).put("branch", branch)
            val stableId = previous?.getString("path")?.removePrefix("saf:/") ?: id
            val result = synchronized(this) {
                check(!cancelled.get() && foreground.get()) { "已取消下载。" }
                documents.registerClone(destination, name, stableId, source, directory).also { installed = true }
            }
            // The preference commit switches the stable document ID atomically. Only then may the old owned snapshot be removed.
            if (oldDirectory != null) runCatching { removeSnapshot(oldDirectory) }
            report("完成")
            return JSObject().put("path", result + if (directory.isEmpty()) "" else "/" + directory).put("label", name) as JSObject
        } catch (failure: Exception) {
            report("正在清理")
            try { removePending(temporary) }
            catch (_: Exception) {
                report("清理失败")
                throw IllegalStateException("未完成的数据清理失败，请释放存储空间后重试。")
            }
            if (!installed && destination.exists()) runCatching { removeSnapshot(destination) }
            report(if (cancelled.get()) "已取消" else "克隆失败")
            throw IllegalStateException(if (cancelled.get()) "克隆已取消，未完成的数据已清理，可重新克隆。"
                else "下载失败，原有副本保留。请检查网络、阅读目录、分支和令牌权限后重试。")
        } finally {
            active.set(false)
        }
    }

    private fun removeSnapshot(directory: File) {
        val owned = managedDirectory(directory)
        Files.walkFileTree(owned.toPath(), object : SimpleFileVisitor<Path>() {
            override fun visitFile(file: Path, attributes: BasicFileAttributes): FileVisitResult { Files.delete(file); return FileVisitResult.CONTINUE }
            override fun postVisitDirectory(directory: Path, error: java.io.IOException?): FileVisitResult {
                if (error != null) throw error
                Files.delete(directory)
                return FileVisitResult.CONTINUE
            }
        })
    }

    private fun cleanOldTasksBeforeStart(current: File) {
        for (directory in root.listFiles().orEmpty()) {
            if (directory != current && directory.name.matches(Regex("\\.pending-[0-9a-f-]{36}"))) removePending(directory)
        }
    }
}
