package app.folio.mobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Base64
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import androidx.activity.OnBackPressedCallback
import androidx.documentfile.provider.DocumentFile
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors

@TauriPlugin
class FolioMobilePlugin(private val activity: Activity) : Plugin(activity) {
    private val io = Executors.newCachedThreadPool()
    private val documents = DocumentAccess(activity)
    private val secrets = SecureCredentials(activity)
    private val clones = CloneManager(activity, documents, secrets)

    override fun load(webView: WebView) {
        io.execute { clones.cleanAbandonedTasks() }
        (activity as AppCompatActivity).onBackPressedDispatcher.addCallback(activity, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("(function(){const event=new CustomEvent('folio-back',{cancelable:true});return !window.dispatchEvent(event)})()") { handled ->
                    if (handled != "true") activity.moveTaskToBack(true)
                }
            }
        })
    }

    override fun onStop(activity: AppCompatActivity) {
        clones.setForeground(false)
    }

    override fun onResume(activity: AppCompatActivity) { clones.setForeground(true) }

    private fun background(invoke: Invoke, action: () -> JSObject) {
        io.execute {
            try { invoke.resolve(action()) }
            catch (error: Exception) {
                invoke.reject(error.message ?: "操作未能完成。")
            }
        }
    }

    @Command
    fun choose(invoke: Invoke) {
        val directory = invoke.getArgs().optBoolean("directory")
        val intent = if (directory) Intent(Intent.ACTION_OPEN_DOCUMENT_TREE) else {
            Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                type = "*/*"
                addCategory(Intent.CATEGORY_OPENABLE)
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
        }
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        startActivityForResult(invoke, intent, "chosen")
    }

    @ActivityCallback
    fun chosen(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.resolve(JSObject().put("entries", JSONArray()) as JSObject)
            return
        }
        try {
            val data = result.data ?: throw IllegalStateException("未选择文件。")
            val uris = data.clipData?.let { clip -> (0 until clip.itemCount).map { clip.getItemAt(it).uri } }
                ?: listOfNotNull(data.data)
            val directory = invoke.getArgs().optBoolean("directory")
            val entries = JSONArray()
            for (uri in uris) {
                activity.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                val entry = documents.registerUri(uri, directory)
                if (directory || entry.getString("path").matches(Regex("(?i).+\\.(md|markdown|mdown|mkd)$"))) entries.put(entry)
            }
            invoke.resolve(JSObject().put("entries", entries) as JSObject)
        } catch (error: Exception) { invoke.reject(error.message ?: "无法获取文件授权，请重新选择。") }
    }

    @Command
    fun list(invoke: Invoke) = background(invoke) {
        JSObject().put("entries", documents.list(invoke.getArgs().getString("path")!!)) as JSObject
    }

    @Command
    fun read(invoke: Invoke) = background(invoke) {
        val data = documents.read(invoke.getArgs().getString("path")!!)
        JSObject().put("data", Base64.encodeToString(data, Base64.NO_WRAP)) as JSObject
    }

    @Command
    fun readSecret(invoke: Invoke) {
        try { invoke.resolve(JSObject().put("value", secrets.read(invoke.getArgs().getString("key")!!)) as JSObject) }
        catch (_: Exception) { invoke.reject("无法解密访问令牌，请重新授权。") }
    }

    @Command
    fun writeSecret(invoke: Invoke) {
        try {
            val args = invoke.getArgs()
            secrets.write(args.getString("key")!!, args.getString("value")!!)
            invoke.resolve(JSObject())
        } catch (_: Exception) { invoke.reject("无法安全保存访问令牌。") }
    }

    @Command
    fun cloneStart(invoke: Invoke) = background(invoke) { clones.clone(invoke.getArgs()) }

    @Command
    fun cloneInfo(invoke: Invoke) {
        io.execute {
            try { invoke.resolve(clones.info(invoke.getArgs().getString("path")!!)) }
            catch (_: Exception) { invoke.reject("无法识别本地克隆来源。") }
        }
    }

    @Command
    fun cloneStatus(invoke: Invoke) { invoke.resolve(clones.status()) }

    @Command
    fun cloneCancel(invoke: Invoke) {
        clones.cancel()
        invoke.resolve(JSObject())
    }

    @Command
    fun http(invoke: Invoke) = background(invoke) {
        val args = invoke.getArgs()
        val url = URL(args.getString("url")!!)
        require(url.protocol == "https" && url.userInfo == null) { "仅支持 HTTPS 仓库请求。" }
        val connection = url.openConnection() as HttpURLConnection
        try {
            connection.useCaches = false
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 20_000
            connection.readTimeout = 35_000
            connection.setRequestProperty("User-Agent", "Folio Markdown Reader")
            val headers = args.optJSONObject("headers") ?: JSONObject()
            for (key in headers.keys()) connection.setRequestProperty(key, headers.getString(key))
            val status = connection.responseCode
            val input = if (status < 400) connection.inputStream else connection.errorStream
            val data = input?.use { DocumentAccess.readBounded(it) } ?: ByteArray(0)
            val responseHeaders = JSONObject()
            connection.headerFields.forEach { (key, values) ->
                if (key != null && !values.isNullOrEmpty()) responseHeaders.put(key.lowercase(), values.first())
            }
            JSObject().put("status", status).put("headers", responseHeaders)
                .put("data", Base64.encodeToString(data, Base64.NO_WRAP)) as JSObject
        } finally { connection.disconnect() }
    }
}
