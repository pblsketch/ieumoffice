package com.ieumoffice.mobile.plugin

import android.app.Activity
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import android.view.View
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.util.concurrent.ConcurrentLinkedQueue

@InvokeArg
class PickOpenArgs {
    var exts: List<String> = emptyList()
}

@InvokeArg
class CreateSaveArgs {
    var suggestedName: String = "document.hwp"
    var mime: String = "application/octet-stream"
}

@InvokeArg
class UriArgs {
    var uri: String = ""
}

@InvokeArg
class WriteUriArgs {
    var uri: String = ""
    var bytesBase64: String = ""
}

@InvokeArg
class ShareArgs {
    var suggestedName: String = "document.hwp"
    var mime: String = "application/octet-stream"
    var bytesBase64: String = ""
}

/**
 * Android SAF, ContentResolver, FileProvider Share Sheet, and incoming Open-With intent bridge.
 */
@TauriPlugin
class IeumFilePlugin(private val activity: Activity) : Plugin(activity) {
    private val pendingIntents = ConcurrentLinkedQueue<JSObject>()

    override fun load(webView: WebView) {
        super.load(webView)
        applySystemBarInsets()
        captureIncomingIntent(activity.intent)
    }

    private fun applySystemBarInsets() {
        activity.runOnUiThread {
            val window = activity.window ?: return@runOnUiThread
            val decorView = window.decorView
            val isNight =
                (activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
                    Configuration.UI_MODE_NIGHT_YES
            val insetsController = WindowInsetsControllerCompat(window, decorView)
            insetsController.isAppearanceLightStatusBars = !isNight
            insetsController.isAppearanceLightNavigationBars = !isNight

            val content = decorView.findViewById<View>(android.R.id.content) ?: return@runOnUiThread
            ViewCompat.setOnApplyWindowInsetsListener(content) { view, windowInsets ->
                val insets = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() or
                        WindowInsetsCompat.Type.displayCutout() or
                        WindowInsetsCompat.Type.ime()
                )
                view.setPadding(insets.left, insets.top, insets.right, insets.bottom)
                windowInsets
            }
            ViewCompat.requestApplyInsets(content)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        captureIncomingIntent(intent)
    }

    fun captureIncomingIntent(intent: Intent?) {
        if (intent == null) return
        val action = intent.action ?: return
        @Suppress("DEPRECATION")
        val uri: Uri? = when (action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND -> intent.getParcelableExtra(Intent.EXTRA_STREAM)
            else -> null
        }
        if (uri == null) return
        val flags = intent.flags
        val writable = (flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != 0
        val persistable = (flags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) != 0
        if (persistable) {
            try {
                val mask = Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    if (writable) Intent.FLAG_GRANT_WRITE_URI_PERMISSION else 0
                activity.contentResolver.takePersistableUriPermission(uri, mask)
            } catch (_: SecurityException) {
                // Fall back to ephemeral read-only session.
            }
        }
        val payload = JSObject().apply {
            put("uri", uri.toString())
            put("name", queryDisplayName(uri))
            put("writable", writable && persistable)
            put("ephemeral", !persistable)
        }
        pendingIntents.add(payload)
    }

    @Command
    fun pickOpenFile(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            )
        }
        startActivityForResult(invoke, intent, "handleDocumentPickerResult")
    }

    @Command
    fun createSaveFile(invoke: Invoke) {
        val args = invoke.parseArgs(CreateSaveArgs::class.java)
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = args.mime.ifBlank { "application/octet-stream" }
            putExtra(Intent.EXTRA_TITLE, args.suggestedName)
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            )
        }
        startActivityForResult(invoke, intent, "handleDocumentPickerResult")
    }

    @ActivityCallback
    fun handleDocumentPickerResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.reject("USER_CANCELLED: user cancelled document picker")
            return
        }
        val data = result.data
        val uri = data?.data
        if (uri == null) {
            invoke.reject("USER_CANCELLED: no URI returned")
            return
        }
        val flags = data.flags
        val writable = (flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != 0
        var persisted = false
        try {
            val mask = Intent.FLAG_GRANT_READ_URI_PERMISSION or
                if (writable) Intent.FLAG_GRANT_WRITE_URI_PERMISSION else 0
            activity.contentResolver.takePersistableUriPermission(uri, mask)
            persisted = true
        } catch (_: SecurityException) {
            persisted = false
        }
        val payload = JSObject().apply {
            put("uri", uri.toString())
            put("name", queryDisplayName(uri))
            put("writable", writable)
            put("ephemeral", !persisted)
        }
        invoke.resolve(payload)
    }

    @Command
    fun openPersistentUri(invoke: Invoke) {
        val args = invoke.parseArgs(UriArgs::class.java)
        val uri = Uri.parse(args.uri)
        val perm = activity.contentResolver.persistedUriPermissions.firstOrNull { it.uri == uri }
        if (perm == null || !perm.isReadPermission) {
            invoke.reject("PERMISSION_DENIED: persisted URI permission expired or missing")
            return
        }
        val payload = JSObject().apply {
            put("uri", uri.toString())
            put("name", queryDisplayName(uri))
            put("writable", perm.isWritePermission)
            put("ephemeral", false)
        }
        invoke.resolve(payload)
    }

    @Command
    fun takePendingOpenIntent(invoke: Invoke) {
        val next = pendingIntents.poll()
        if (next != null) {
            invoke.resolve(next)
        } else {
            invoke.resolve(JSObject())
        }
    }

    @Command
    fun readUriBytes(invoke: Invoke) {
        val args = invoke.parseArgs(UriArgs::class.java)
        val uri = Uri.parse(args.uri)
        try {
            val bytes = activity.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                ?: throw SecurityException("Unable to open input stream")
            val result = JSObject()
            result.put("bytesBase64", Base64.encodeToString(bytes, Base64.NO_WRAP))
            invoke.resolve(result)
        } catch (err: SecurityException) {
            invoke.reject("PERMISSION_DENIED: ${err.message}")
        } catch (err: Exception) {
            invoke.reject("INTERNAL_ERROR: ${err.message}")
        }
    }

    @Command
    fun writeUriBytesAtomic(invoke: Invoke) {
        val args = invoke.parseArgs(WriteUriArgs::class.java)
        val uri = Uri.parse(args.uri)
        try {
            val bytes = Base64.decode(args.bytesBase64, Base64.DEFAULT)
            activity.contentResolver.openOutputStream(uri, "wt")?.use { out ->
                out.write(bytes)
                out.flush()
            } ?: throw SecurityException("Unable to open output stream")
            invoke.resolve(JSObject().apply { put("ok", true) })
        } catch (err: SecurityException) {
            invoke.reject("READ_ONLY_URI: ${err.message}")
        } catch (err: Exception) {
            invoke.reject("INTERNAL_ERROR: ${err.message}")
        }
    }

    @Command
    fun shareFileBytes(invoke: Invoke) {
        val args = invoke.parseArgs(ShareArgs::class.java)
        try {
            // Directory matches `res/xml/file_paths.xml` (`<cache-path name="shared_docs" path="shared/" />`).
            val shareDir = File(activity.cacheDir, "shared").apply { mkdirs() }
            val safeName = args.suggestedName.replace(Regex("[/\\\\]"), "_")
            val target = File(shareDir, safeName)
            target.writeBytes(Base64.decode(args.bytesBase64, Base64.DEFAULT))
            val contentUri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                target
            )
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = args.mime
                putExtra(Intent.EXTRA_STREAM, contentUri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(shareIntent, safeName))
            invoke.resolve(JSObject().apply { put("ok", true) })
        } catch (err: Exception) {
            invoke.reject("INTERNAL_ERROR: ${err.message}")
        }
    }

    private fun queryDisplayName(uri: Uri): String {
        activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) {
                        val value = cursor.getString(idx)
                        if (!value.isNullOrBlank()) return value
                    }
                }
            }
        return uri.lastPathSegment ?: "document"
    }
}
