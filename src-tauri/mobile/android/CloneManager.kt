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
    @Volatile private var progress = JSObject().put("phase", "idle").put("completed", 0).put("total", 0) as JSObject

    fun status(): JSObject = progress
    fun cancel() { if (active.get()) cancelled.set(true) }

    private fun report(phase: String, completed: Int = 0, total: Int = 0) {
        progress = JSObject().put("phase", phase).put("completed", completed).put("total", total) as JSObject
    }

    @Synchronized
    fun cleanAbandonedTasks() {
        if (active.get()) return
        root.listFiles()?.filter { it.name.matches(Regex("\\.pending-[0-9a-f-]{36}")) }
            ?.forEach { runCatching { removePending(it) } }
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

    @Synchronized
    private fun begin() {
        check(active.compareAndSet(false, true)) { "已有克隆任务正在运行。" }
        cancelled.set(false)
    }

    fun clone(args: JSObject): JSObject {
        begin()
        val id = UUID.randomUUID().toString()
        val temporary = File(root, ".pending-" + id)
        val destination = File(root, id)
        try {
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
            if (supplied.isNotEmpty()) secrets.write(secretName, supplied)
            report("正在完成")
            check(temporary.renameTo(destination)) { "无法保存完整仓库。" }
            val result = documents.registerClone(destination, name)
            report("完成")
            return JSObject().put("path", result).put("label", name) as JSObject
        } catch (failure: Exception) {
            report("正在清理")
            try { removePending(temporary) }
            catch (_: Exception) {
                report("清理失败")
                throw IllegalStateException("未完成的数据清理失败，请释放存储空间后重试。")
            }
            report(if (cancelled.get()) "已取消" else "克隆失败")
            throw IllegalStateException(if (cancelled.get()) "克隆已取消，未完成的数据已清理，可重新克隆。"
                else "克隆失败，未完成的数据已清理。请检查网络、仓库地址和令牌权限后重新克隆。")
        } finally {
            active.set(false)
        }
    }

    private fun cleanOldTasksBeforeStart(current: File) {
        for (directory in root.listFiles().orEmpty()) {
            if (directory != current && directory.name.matches(Regex("\\.pending-[0-9a-f-]{36}"))) removePending(directory)
        }
    }
}
