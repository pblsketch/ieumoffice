package com.ieumoffice.mobile.plugin

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ComponentCallbacks
import android.content.Context
import android.content.Intent
import android.content.UriPermission
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.view.View
import android.view.WindowManager
import android.webkit.MimeTypeMap
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
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.InputStream
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

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

/** A document and a local file inside the app cache (bytes travel through the file). */
@InvokeArg
class UriPathArgs {
    var uri: String = ""
    var path: String = ""
}

@InvokeArg
class SharePathArgs {
    var path: String = ""
    var suggestedName: String = "document.hwp"
    var mime: String = "application/octet-stream"
}

@InvokeArg
class FolderListArgs {
    var uri: String = ""
    var subPath: List<String> = emptyList()
}

@InvokeArg
class NameArgs {
    var uri: String = ""
    var newName: String = ""
}

@InvokeArg
class UrisArgs {
    var uris: List<String> = emptyList()
}

@InvokeArg
class KeepScreenOnArgs {
    var on: Boolean = false
}

@InvokeArg
class AppThemeArgs {
    var theme: String = "system"
}

@InvokeArg
class UrlArgs {
    var url: String = ""
}

@InvokeArg
class PrintPathArgs {
    var path: String = ""
    var jobName: String = "document.pdf"
}

@InvokeArg
class RenderPdfThumbArgs {
    var srcPath: String = ""
    var destPath: String = ""
    var maxPx: Int = 360
}

/** One child row of a SAF folder query. */
private data class ChildDoc(
    val docId: String,
    val name: String,
    val mime: String?,
    val size: Long?,
    val modified: Long?,
) {
    val isDir: Boolean get() = mime == DocumentsContract.Document.MIME_TYPE_DIR
}

/** A document under a linked folder, with the folder's persisted grant. */
private class HomeDoc(val uri: Uri, val treeUri: Uri, val docId: String, val flags: Int)

/**
 * Android SAF, ContentResolver, FileProvider Share Sheet, and incoming Open-With intent bridge.
 */
@TauriPlugin
class IeumFilePlugin(private val activity: Activity) : Plugin(activity) {
    private val pendingIntents = ConcurrentLinkedQueue<JSObject>()
    private val incomingBatches = ConcurrentLinkedQueue<JSObject>()
    private val batchCounter = AtomicLong(0)
    private val printIoExecutor = Executors.newSingleThreadExecutor()
    @Volatile private var activeWebView: WebView? = null
    @Volatile private var appTheme: String = "system"
    private var configCallbacks: ComponentCallbacks? = null

    // One worker for received files: copies run in arrival order, and a batch query queued
    // after them answers only once they are done.
    private val incomingExecutor = Executors.newSingleThreadExecutor()

    // Folder listing, rename, copy, delete, and share copies run off the calling thread.
    private val workExecutor = Executors.newCachedThreadPool()

    // PdfRenderer is not thread-safe and allows only one open page at a time.
    private val pdfThumbExecutor = Executors.newSingleThreadExecutor()

    override fun load(webView: WebView) {
        super.load(webView)
        activeWebView = webView
        // Keep Android WebView from pinch-zooming app chrome (bars/sheets);
        // individual document viewports handle two-finger zoom in JS.
        // System font size scaling (settings.textZoom / rem) stays intact.
        webView.settings.setSupportZoom(false)
        webView.settings.builtInZoomControls = false
        webView.settings.displayZoomControls = false
        // Disable Android WebView algorithmic darkening on API 33+ so explicit "light" mode and
        // light document iframes (HWP flow/page, HTML, PDF) are never force-inverted under OS dark mode.
        // App theme styling is driven directly via data-theme and CSS color-scheme tokens.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            webView.settings.isAlgorithmicDarkeningAllowed = false
        }
        applySystemBarInsets()
        installDarkModeObserver(webView)
        captureIncomingIntent(activity.intent, notifyWebView = false)
    }

    private fun isSystemNightMode(config: Configuration = activity.resources.configuration): Boolean =
        (config.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    private fun isEffectiveDark(config: Configuration = activity.resources.configuration): Boolean =
        when (appTheme) {
            "dark" -> true
            "light" -> false
            else -> isSystemNightMode(config)
        }

    /** Matches Android status/navigation bar icon tone and background to the active app theme. */
    private fun applySystemBarAppearance(isDark: Boolean) {
        activity.runOnUiThread {
            val window = activity.window ?: return@runOnUiThread
            val decorView = window.decorView
            val insetsController = WindowInsetsControllerCompat(window, decorView)
            insetsController.isAppearanceLightStatusBars = !isDark
            insetsController.isAppearanceLightNavigationBars = !isDark
            // The WebView draws behind the status bar (see applySystemBarInsets), so this colour only
            // shows behind the navigation bar and side cutouts; it matches --chrome-bg like the tab bar.
            val barBg = if (isDark) Color.parseColor("#252525") else Color.WHITE
            decorView.setBackgroundColor(barBg)
            decorView.findViewById<View>(android.R.id.content)?.setBackgroundColor(barBg)
        }
    }

    /** Mirrors Android's live UI_MODE_NIGHT state into the WebView so system theme always matches. */
    private fun pushSystemDarkMode(webView: WebView, isNight: Boolean) {
        val flag = if (isNight) "true" else "false"
        val effectiveDark = when (appTheme) {
            "dark" -> true
            "light" -> false
            else -> isNight
        }
        applySystemBarAppearance(effectiveDark)
        activity.runOnUiThread {
            webView.evaluateJavascript(
                "window.__ieumSystemDark=$flag;window.dispatchEvent(new CustomEvent('ieum:system-dark',{detail:$flag}));",
                null
            )
        }
    }

    private fun installDarkModeObserver(webView: WebView) {
        pushSystemDarkMode(webView, isSystemNightMode())
        // Re-push once initial page load completes so listeners mounted after load() receive it.
        webView.postDelayed({ pushSystemDarkMode(webView, isSystemNightMode()) }, 400)
        webView.postDelayed({ pushSystemDarkMode(webView, isSystemNightMode()) }, 1500)
        if (configCallbacks != null) return
        val cb = object : ComponentCallbacks {
            override fun onConfigurationChanged(newConfig: Configuration) {
                val current = activeWebView ?: return
                pushSystemDarkMode(current, isSystemNightMode(newConfig))
            }
            override fun onLowMemory() {}
        }
        configCallbacks = cb
        activity.application?.registerComponentCallbacks(cb)
    }

    /** Notifies the foreground WebView when a new intent arrives without a visibility transition. */
    private fun notifyIncomingDocument() {
        val webView = activeWebView ?: return
        activity.runOnUiThread {
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('ieum:incoming-document'))",
                null
            )
        }
    }

    private fun applySystemBarInsets() {
        applySystemBarAppearance(isEffectiveDark())
        activity.runOnUiThread {
            val window = activity.window ?: return@runOnUiThread
            val decorView = window.decorView

            val content = decorView.findViewById<View>(android.R.id.content) ?: return@runOnUiThread
            ViewCompat.setOnApplyWindowInsetsListener(content) { view, windowInsets ->
                val insets = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() or
                        WindowInsetsCompat.Type.displayCutout() or
                        WindowInsetsCompat.Type.ime()
                )
                // Sides and bottom (navigation bar, keyboard) stay native padding. The top is left
                // to the WebView so each screen's own header colour runs behind the status bar;
                // its height goes to CSS as --m-safe-top instead of env(), which some WebViews
                // report and others leave at 0.
                view.setPadding(insets.left, 0, insets.right, insets.bottom)
                val density = activity.resources.displayMetrics.density
                safeTopCss = if (density > 0f) insets.top / density else 0f
                activeWebView?.let { pushSafeTop(it) }
                // Consumed so the WebView never adds env(safe-area-inset-*) on top of this.
                WindowInsetsCompat.CONSUMED
            }
            ViewCompat.requestApplyInsets(content)
        }
        // The page may not exist yet on the first push; repeat once it has loaded.
        activeWebView?.let { webView ->
            webView.postDelayed({ pushSafeTop(webView) }, 150)
            webView.postDelayed({ pushSafeTop(webView) }, 400)
            webView.postDelayed({ pushSafeTop(webView) }, 1500)
        }
    }

    /** Status bar / cutout height in CSS px, applied by the WebView to its top headers. */
    @Volatile private var safeTopCss = 0f

    private fun pushSafeTop(webView: WebView) {
        val px = safeTopCss
        activity.runOnUiThread {
            webView.evaluateJavascript(
                "window.__ieumSafeTop=$px;document.documentElement&&document.documentElement.style.setProperty('--m-safe-top','${px}px');",
                null
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        captureIncomingIntent(intent, notifyWebView = true)
    }

    fun captureIncomingIntent(intent: Intent?, notifyWebView: Boolean = false) {
        if (intent == null) return
        val action = intent.action ?: return
        if (action == Intent.ACTION_SEND_MULTIPLE) {
            val uris = streamUris(intent)
            if (uris.isEmpty()) return
            // A lone non-picture document keeps the single-document path.
            if (uris.size == 1 && !isPicture(uris[0], intent.type)) {
                queueSingleDocument(intent, uris[0], notifyWebView)
            } else {
                queueIncomingBatch(uris, notifyWebView)
            }
            return
        }
        @Suppress("DEPRECATION")
        val uri: Uri? = when (action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND -> intent.getParcelableExtra(Intent.EXTRA_STREAM)
            else -> null
        }
        if (uri == null) return
        if (action == Intent.ACTION_SEND && isPicture(uri, intent.type)) {
            queueIncomingBatch(listOf(uri), notifyWebView)
            return
        }
        queueSingleDocument(intent, uri, notifyWebView)
    }

    private fun queueSingleDocument(intent: Intent, uri: Uri, notifyWebView: Boolean) {
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
        if (notifyWebView) notifyIncomingDocument()
    }

    @Suppress("DEPRECATION")
    private fun streamUris(intent: Intent): List<Uri> {
        val list: ArrayList<Uri>? = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
        if (!list.isNullOrEmpty()) return list.filterNotNull()
        val clip = intent.clipData ?: return emptyList()
        return (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
    }

    private fun isPicture(uri: Uri, intentType: String?): Boolean {
        val mime = try {
            activity.contentResolver.getType(uri)
        } catch (_: Exception) {
            null
        } ?: intentType
        return mime?.startsWith("image/") == true
    }

    /**
     * Copies received files into `<cache>/ieum-tmp/home/incoming/<batchId>/` on the incoming
     * worker and queues the batch for `takePendingIncomingBatch`. Files that cannot be read are
     * left out; a batch with no readable file is not queued.
     */
    private fun queueIncomingBatch(uris: List<Uri>, notifyWebView: Boolean) {
        val batchId = "b${System.currentTimeMillis()}-${batchCounter.incrementAndGet()}"
        val resolver = activity.contentResolver
        // Names and types are read now, while the share grant is surely valid.
        val sources = uris.map { uri ->
            val name = queryDisplayName(uri)
            val mime = try {
                resolver.getType(uri)
            } catch (_: Exception) {
                null
            } ?: guessMime(name)
            Triple(uri, name, mime)
        }
        incomingExecutor.execute {
            val dir = File(activity.cacheDir, "$INCOMING_DIR/$batchId")
            val taken = mutableListOf<String>()
            val files = JSArray()
            for ((uri, rawName, mime) in sources) {
                val name = uniqueIncomingName(rawName, taken)
                val target = File(dir, name)
                val size = try {
                    dir.mkdirs()
                    resolver.openInputStream(uri)?.use { input ->
                        target.outputStream().use { input.copyTo(it) }
                    } ?: -1L
                } catch (_: Exception) {
                    -1L
                }
                if (size < 0) {
                    target.delete()
                    continue
                }
                files.put(JSObject().apply {
                    put("name", name)
                    put("mime", mime)
                    put("path", target.absolutePath)
                    put("sizeBytes", size)
                })
            }
            if (files.length() > 0) {
                incomingBatches.add(JSObject().apply {
                    put("id", batchId)
                    put("files", files)
                })
                if (notifyWebView) notifyIncomingDocument()
            }
        }
    }

    @Command
    fun takePendingIncomingBatch(invoke: Invoke) {
        // Queued behind every copy that started before this call.
        incomingExecutor.execute {
            val next = incomingBatches.poll()
            invoke.resolve(if (next != null) JSObject().apply { put("batch", next) } else JSObject())
        }
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
        if (perm != null && perm.isReadPermission) {
            val payload = JSObject().apply {
                put("uri", uri.toString())
                put("name", queryDisplayName(uri))
                put("writable", perm.isWritePermission)
                put("ephemeral", false)
            }
            invoke.resolve(payload)
            return
        }
        // A document under a linked folder opens through the folder's tree grant.
        val tree = treeGrantFor(uri)
        if (tree == null) {
            invoke.reject("PERMISSION_DENIED: persisted URI permission expired or missing")
            return
        }
        val flags = queryDocumentFlags(uri)
        if (flags == null) {
            invoke.reject("PERMISSION_DENIED: document missing under the linked folder")
            return
        }
        val payload = JSObject().apply {
            put("uri", uri.toString())
            put("name", queryDisplayName(uri))
            put(
                "writable",
                tree.isWritePermission &&
                    (flags and DocumentsContract.Document.FLAG_SUPPORTS_WRITE) != 0
            )
            put("ephemeral", false)
        }
        invoke.resolve(payload)
    }

    @Command
    fun pickFolder(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
            )
        }
        startActivityForResult(invoke, intent, "handleFolderPickerResult")
    }

    @ActivityCallback
    fun handleFolderPickerResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.reject("USER_CANCELLED: user cancelled folder picker")
            return
        }
        val treeUri = result.data?.data
        if (treeUri == null) {
            invoke.reject("USER_CANCELLED: no folder returned")
            return
        }
        try {
            activity.contentResolver.takePersistableUriPermission(
                treeUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
        } catch (err: SecurityException) {
            invoke.reject("PERMISSION_DENIED: ${err.message}")
            return
        }
        val name = try {
            queryDisplayName(
                DocumentsContract.buildDocumentUriUsingTree(
                    treeUri,
                    DocumentsContract.getTreeDocumentId(treeUri)
                )
            )
        } catch (_: Exception) {
            treeUri.lastPathSegment ?: "folder"
        }
        invoke.resolve(JSObject().apply {
            put("uri", treeUri.toString())
            put("name", name)
        })
    }

    @Command
    fun releaseFolder(invoke: Invoke) {
        val args = invoke.parseArgs(UriArgs::class.java)
        val uri = Uri.parse(args.uri)
        val perm = activity.contentResolver.persistedUriPermissions.firstOrNull { it.uri == uri }
        if (perm != null) {
            var mask = 0
            if (perm.isReadPermission) mask = mask or Intent.FLAG_GRANT_READ_URI_PERMISSION
            if (perm.isWritePermission) mask = mask or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            try {
                activity.contentResolver.releasePersistableUriPermission(uri, mask)
            } catch (_: SecurityException) {
                // Already gone.
            }
        }
        invoke.resolve(JSObject().apply { put("ok", true) })
    }

    @Command
    fun checkFolderGrant(invoke: Invoke) {
        val args = invoke.parseArgs(UriArgs::class.java)
        val treeUri = Uri.parse(args.uri)
        workExecutor.execute {
            val perm = activity.contentResolver.persistedUriPermissions
                .firstOrNull { it.uri == treeUri }
            val state = when {
                perm == null || !perm.isReadPermission -> "revoked"
                !treeRootExists(treeUri) -> "missing"
                else -> "alive"
            }
            invoke.resolve(JSObject().apply { put("state", state) })
        }
    }

    @Command
    fun listFolder(invoke: Invoke) {
        val args = invoke.parseArgs(FolderListArgs::class.java)
        val treeUri = Uri.parse(args.uri)
        workExecutor.execute {
            val perm = activity.contentResolver.persistedUriPermissions
                .firstOrNull { it.uri == treeUri }
            if (perm == null || !perm.isReadPermission) {
                invoke.reject("PERMISSION_DENIED: folder grant lost")
                return@execute
            }
            try {
                var docId = DocumentsContract.getTreeDocumentId(treeUri)
                for (name in args.subPath) {
                    val child = queryChildren(treeUri, docId).firstOrNull { it.isDir && it.name == name }
                    if (child == null) {
                        invoke.reject("NOT_FOUND: sub folder missing")
                        return@execute
                    }
                    docId = child.docId
                }
                val entries = JSArray()
                for (child in queryChildren(treeUri, docId)) {
                    entries.put(JSObject().apply {
                        put("uri", DocumentsContract.buildDocumentUriUsingTree(treeUri, child.docId).toString())
                        put("name", child.name)
                        put("isDir", child.isDir)
                        if (!child.isDir) {
                            child.mime?.let { put("mime", it) }
                            child.size?.let { put("sizeBytes", it) }
                        }
                        child.modified?.let { put("modifiedMs", it) }
                    })
                }
                invoke.resolve(JSObject().apply { put("entries", entries) })
            } catch (err: Exception) {
                // The folder was moved or deleted, or the provider dropped the grant.
                invoke.reject("PERMISSION_DENIED: ${err.message}")
            }
        }
    }

    @Command
    fun renameDocument(invoke: Invoke) {
        val args = invoke.parseArgs(NameArgs::class.java)
        workExecutor.execute {
            try {
                if (!isValidName(args.newName)) {
                    invoke.reject("INVALID_ARGUMENT: invalid document name")
                    return@execute
                }
                val doc = resolveHomeDoc(invoke, Uri.parse(args.uri)) ?: return@execute
                if ((doc.flags and DocumentsContract.Document.FLAG_SUPPORTS_RENAME) == 0) {
                    invoke.reject("NOT_SUPPORTED: provider cannot rename this document")
                    return@execute
                }
                val parentId = parentDocumentId(doc.uri)
                if (parentId == null) {
                    invoke.reject("NOT_SUPPORTED: provider cannot locate the parent folder")
                    return@execute
                }
                if (nameTaken(doc.treeUri, parentId, args.newName, doc.docId)) {
                    invoke.reject("NAME_TAKEN: name already used in this folder")
                    return@execute
                }
                val renamed = DocumentsContract.renameDocument(
                    activity.contentResolver,
                    doc.uri,
                    args.newName
                ) ?: doc.uri
                invoke.resolve(JSObject().apply { put("uri", renamed.toString()) })
            } catch (err: Exception) {
                rejectHomeFailure(invoke, err)
            }
        }
    }

    @Command
    fun copyDocument(invoke: Invoke) {
        val args = invoke.parseArgs(NameArgs::class.java)
        workExecutor.execute {
            try {
                if (!isValidName(args.newName)) {
                    invoke.reject("INVALID_ARGUMENT: invalid document name")
                    return@execute
                }
                val doc = resolveHomeDoc(invoke, Uri.parse(args.uri)) ?: return@execute
                val parentId = parentDocumentId(doc.uri)
                if (parentId == null) {
                    invoke.reject("NOT_SUPPORTED: provider cannot locate the parent folder")
                    return@execute
                }
                val parentUri = DocumentsContract.buildDocumentUriUsingTree(doc.treeUri, parentId)
                val parentFlags = queryDocumentFlags(parentUri) ?: 0
                if ((parentFlags and DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE) == 0) {
                    invoke.reject("NOT_SUPPORTED: provider cannot create documents here")
                    return@execute
                }
                if (nameTaken(doc.treeUri, parentId, args.newName, null)) {
                    invoke.reject("NAME_TAKEN: name already used in this folder")
                    return@execute
                }
                val resolver = activity.contentResolver
                val mime = resolver.getType(doc.uri) ?: guessMime(args.newName)
                val created = DocumentsContract.createDocument(resolver, parentUri, mime, args.newName)
                if (created == null) {
                    invoke.reject("NOT_SUPPORTED: provider refused to create the copy")
                    return@execute
                }
                try {
                    val input = resolver.openInputStream(doc.uri)
                        ?: throw FileNotFoundException("cannot read the source document")
                    input.use { src ->
                        val output = resolver.openOutputStream(created, "w")
                            ?: throw FileNotFoundException("cannot write the copy")
                        output.use { src.copyTo(it) }
                    }
                } catch (err: Exception) {
                    try {
                        DocumentsContract.deleteDocument(resolver, created)
                    } catch (_: Exception) {
                        // Best effort: leave the empty copy if the provider refuses.
                    }
                    throw err
                }
                invoke.resolve(JSObject().apply { put("uri", created.toString()) })
            } catch (err: Exception) {
                rejectHomeFailure(invoke, err)
            }
        }
    }

    @Command
    fun deleteDocument(invoke: Invoke) {
        val args = invoke.parseArgs(UriArgs::class.java)
        workExecutor.execute {
            try {
                val doc = resolveHomeDoc(invoke, Uri.parse(args.uri)) ?: return@execute
                if ((doc.flags and DocumentsContract.Document.FLAG_SUPPORTS_DELETE) == 0) {
                    invoke.reject("NOT_SUPPORTED: provider cannot delete this document")
                    return@execute
                }
                if (!DocumentsContract.deleteDocument(activity.contentResolver, doc.uri)) {
                    invoke.reject("NOT_SUPPORTED: provider refused to delete the document")
                    return@execute
                }
                invoke.resolve(JSObject().apply { put("ok", true) })
            } catch (err: Exception) {
                rejectHomeFailure(invoke, err)
            }
        }
    }

    @Command
    fun shareFiles(invoke: Invoke) {
        val args = invoke.parseArgs(UrisArgs::class.java)
        workExecutor.execute {
            try {
                if (args.uris.isEmpty()) {
                    invoke.reject("INVALID_ARGUMENT: nothing to share")
                    return@execute
                }
                val resolver = activity.contentResolver
                val cacheRoot = activity.cacheDir.canonicalFile
                // Matches `res/xml/file_paths.xml` (`<cache-path name="shared_docs" path="shared/" />`).
                val batchDir = File(activity.cacheDir, "shared/multi-${System.currentTimeMillis()}")
                val contentUris = ArrayList<Uri>()
                val mimes = mutableListOf<String>()
                for ((index, raw) in args.uris.withIndex()) {
                    val name: String
                    val mime: String
                    val open: () -> InputStream
                    if (raw.startsWith("/")) {
                        // A received file copied into the app cache.
                        val file = File(raw).canonicalFile
                        if (!file.isFile || !file.path.startsWith(cacheRoot.path + File.separator)) {
                            invoke.reject("NOT_FOUND: nothing to share at this location")
                            return@execute
                        }
                        name = file.name
                        mime = guessMime(file.name)
                        open = { FileInputStream(file) }
                    } else {
                        val uri = Uri.parse(raw)
                        name = queryDisplayName(uri)
                        mime = resolver.getType(uri) ?: guessMime(name)
                        open = {
                            resolver.openInputStream(uri)
                                ?: throw FileNotFoundException("cannot read the document")
                        }
                    }
                    val target = File(File(batchDir, index.toString()), safeFileName(name))
                    target.parentFile?.mkdirs()
                    open().use { input -> target.outputStream().use { input.copyTo(it) } }
                    contentUris.add(
                        FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", target)
                    )
                    mimes.add(mime)
                }
                val shareIntent = if (contentUris.size == 1) {
                    Intent(Intent.ACTION_SEND).apply { putExtra(Intent.EXTRA_STREAM, contentUris[0]) }
                } else {
                    Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                        putParcelableArrayListExtra(Intent.EXTRA_STREAM, contentUris)
                    }
                }
                shareIntent.type = commonMime(mimes)
                // ClipData carries the read grant for every item to the chosen app.
                val clip = ClipData.newRawUri("", contentUris[0])
                for (extra in contentUris.drop(1)) clip.addItem(ClipData.Item(extra))
                shareIntent.clipData = clip
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                activity.runOnUiThread {
                    try {
                        activity.startActivity(Intent.createChooser(shareIntent, null))
                        invoke.resolve(JSObject().apply { put("ok", true) })
                    } catch (err: Exception) {
                        invoke.reject("INTERNAL_ERROR: ${err.message}")
                    }
                }
            } catch (err: SecurityException) {
                invoke.reject("PERMISSION_DENIED: ${err.message}")
            } catch (err: FileNotFoundException) {
                invoke.reject("NOT_FOUND: ${err.message}")
            } catch (err: Exception) {
                invoke.reject("INTERNAL_ERROR: ${err.message}")
            }
        }
    }

    @Command
    fun setKeepScreenOn(invoke: Invoke) {
        val args = invoke.parseArgs(KeepScreenOnArgs::class.java)
        activity.runOnUiThread {
            val window = activity.window
            if (window == null) {
                invoke.reject("NOT_SUPPORTED: no activity window")
                return@runOnUiThread
            }
            if (args.on) {
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
            invoke.resolve(JSObject().apply { put("ok", true) })
        }
    }

    /** Applies the user's explicit theme preference ("system", "light", "dark") to Android system bars. */
    @Command
    fun setAppTheme(invoke: Invoke) {
        val args = invoke.parseArgs(AppThemeArgs::class.java)
        appTheme = when (args.theme) {
            "light", "dark", "system" -> args.theme
            else -> "system"
        }
        applySystemBarAppearance(isEffectiveDark())
        invoke.resolve(JSObject().apply { put("ok", true) })
    }

    @Command
    fun openExternalUrl(invoke: Invoke) {
        val args = invoke.parseArgs(UrlArgs::class.java)
        if (!isOpenableExternalUrl(args.url)) {
            invoke.reject("INVALID_ARGUMENT: only http, https, and mailto URLs are opened")
            return
        }
        val parsed = Uri.parse(args.url)
        val intent = Intent(Intent.ACTION_VIEW, parsed).apply {
            if (!parsed.scheme.equals("mailto", ignoreCase = true)) {
                addCategory(Intent.CATEGORY_BROWSABLE)
            }
        }
        activity.runOnUiThread {
            try {
                activity.startActivity(intent)
                invoke.resolve(JSObject().apply { put("ok", true) })
            } catch (err: ActivityNotFoundException) {
                invoke.reject("NOT_SUPPORTED: no app can open the URL")
            }
        }
    }

    @Command
    fun getNativeDirs(invoke: Invoke) {
        invoke.resolve(JSObject().apply {
            put("cacheDir", activity.cacheDir.absolutePath)
            put("shareTempDir", File(activity.cacheDir, "shared").absolutePath)
        })
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

    /** A file under the app cache directory, or null for any other path. */
    private fun cacheFile(path: String): File? {
        val root = activity.cacheDir.canonicalFile
        val file = File(path).canonicalFile
        return if (file.path.startsWith(root.path + File.separator)) file else null
    }

    /**
     * Streams a document into a file inside the app cache (replaced if it exists). The bytes never
     * travel as one string argument, so there is no size limit.
     */
    @Command
    fun copyUriToFile(invoke: Invoke) {
        val args = invoke.parseArgs(UriPathArgs::class.java)
        workExecutor.execute {
            val dest = cacheFile(args.path)
            if (dest == null) {
                invoke.reject("INVALID_ARGUMENT: the copy must go into the app cache")
                return@execute
            }
            try {
                dest.parentFile?.mkdirs()
                val input = activity.contentResolver.openInputStream(Uri.parse(args.uri))
                    ?: throw SecurityException("Unable to open input stream")
                val size = input.use { stream -> dest.outputStream().use { stream.copyTo(it) } }
                invoke.resolve(JSObject().apply { put("size", size) })
            } catch (err: SecurityException) {
                invoke.reject("PERMISSION_DENIED: ${err.message}")
            } catch (err: FileNotFoundException) {
                invoke.reject("PERMISSION_DENIED: ${err.message}")
            } catch (err: Exception) {
                invoke.reject("INTERNAL_ERROR: ${err.message}")
            }
        }
    }

    /**
     * Streams a file from the app cache over a document ("wt": truncate, then write) and syncs it.
     * This alone can leave a document cut short when it fails halfway; the Rust side
     * (`write_uri_from_file`) keeps a copy of the original first, reads the result back and puts
     * the original back on any failure.
     */
    @Command
    fun writeUriFromFile(invoke: Invoke) {
        val args = invoke.parseArgs(UriPathArgs::class.java)
        workExecutor.execute {
            val src = cacheFile(args.path)
            if (src == null || !src.isFile) {
                invoke.reject("INVALID_ARGUMENT: the source must be a file in the app cache")
                return@execute
            }
            try {
                val out = activity.contentResolver.openOutputStream(Uri.parse(args.uri), "wt")
                    ?: throw SecurityException("Unable to open output stream")
                val size = out.use { stream ->
                    val written = src.inputStream().use { it.copyTo(stream) }
                    stream.flush()
                    if (stream is FileOutputStream) stream.fd.sync()
                    written
                }
                invoke.resolve(JSObject().apply { put("size", size) })
            } catch (err: SecurityException) {
                invoke.reject("READ_ONLY_URI: ${err.message}")
            } catch (err: Exception) {
                invoke.reject("INTERNAL_ERROR: ${err.message}")
            }
        }
    }

    /** Shares one file the Rust side wrote under `<cache>/shared/` (the FileProvider path). */
    @Command
    fun shareFileFromPath(invoke: Invoke) {
        val args = invoke.parseArgs(SharePathArgs::class.java)
        val file = cacheFile(args.path)
        val sharedRoot = File(activity.cacheDir, "shared").canonicalFile
        if (file == null || !file.isFile || !file.path.startsWith(sharedRoot.path + File.separator)) {
            invoke.reject("INVALID_ARGUMENT: the file must be under the shared cache folder")
            return
        }
        try {
            val contentUri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                file
            )
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = args.mime
                putExtra(Intent.EXTRA_STREAM, contentUri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(shareIntent, safeFileName(args.suggestedName)))
            invoke.resolve(JSObject().apply { put("ok", true) })
        } catch (err: Exception) {
            invoke.reject("INTERNAL_ERROR: ${err.message}")
        }
    }

    /** Hands a staged PDF under `<cache>/ieum-tmp/print/` to Android PrintManager. */
    @Command
    fun printPdfFromPath(invoke: Invoke) {
        val args = invoke.parseArgs(PrintPathArgs::class.java)
        val file = cacheFile(args.path)
        val printRoot = File(activity.cacheDir, "ieum-tmp/print").canonicalFile
        if (file == null || !file.isFile || !file.path.startsWith(printRoot.path + File.separator)) {
            invoke.reject("INVALID_ARGUMENT: the file must be under the print cache folder")
            return
        }
        val jobName = safeFileName(args.jobName.ifBlank { file.name })
        activity.runOnUiThread {
            try {
                val printManager = activity.getSystemService(Context.PRINT_SERVICE) as? PrintManager
                if (printManager == null) {
                    file.delete()
                    invoke.reject("INTERNAL_ERROR: print service unavailable")
                    return@runOnUiThread
                }
                val adapter = PdfFilePrintDocumentAdapter(file, jobName, printIoExecutor)
                printManager.print(jobName, adapter, PrintAttributes.Builder().build())
                invoke.resolve(JSObject().apply { put("ok", true) })
            } catch (err: Exception) {
                file.delete()
                invoke.reject("INTERNAL_ERROR: ${err.message}")
            }
        }
    }

    /** Renders page 0 of a cached PDF into a white-backed PNG thumbnail on a dedicated thread. */
    @Command
    fun renderPdfThumbnail(invoke: Invoke) {
        val args = invoke.parseArgs(RenderPdfThumbArgs::class.java)
        val srcFile = cacheFile(args.srcPath)
        val destFile = cacheFile(args.destPath)
        if (srcFile == null || !srcFile.isFile || destFile == null) {
            invoke.reject("INVALID_ARGUMENT: paths must stay inside the app cache")
            return
        }
        val maxPx = args.maxPx.coerceIn(64, 1024)
        pdfThumbExecutor.execute {
            try {
                val rendered = ParcelFileDescriptor.open(srcFile, ParcelFileDescriptor.MODE_READ_ONLY).use { pfd ->
                    PdfRenderer(pfd).use { renderer ->
                        if (renderer.pageCount <= 0) {
                            false
                        } else {
                            renderer.openPage(0).use { page ->
                                val pw = page.width.coerceAtLeast(1)
                                val ph = page.height.coerceAtLeast(1)
                                val scale = maxPx.toFloat() / maxOf(pw, ph).toFloat()
                                val outW = (pw * scale).toInt().coerceIn(1, 1024)
                                val outH = (ph * scale).toInt().coerceIn(1, 1024)
                                val bitmap = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888)
                                try {
                                    Canvas(bitmap).drawColor(Color.WHITE)
                                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                                    destFile.parentFile?.mkdirs()
                                    FileOutputStream(destFile).use { out ->
                                        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
                                        out.flush()
                                    }
                                    true
                                } finally {
                                    bitmap.recycle()
                                }
                            }
                        }
                    }
                }
                invoke.resolve(JSObject().apply { put("rendered", rendered) })
            } catch (_: SecurityException) {
                // Password-protected PDFs never produce cached thumbnails.
                invoke.resolve(JSObject().apply { put("rendered", false) })
            } catch (_: Exception) {
                invoke.resolve(JSObject().apply { put("rendered", false) })
            }
        }
    }

    /** Streams a staged PDF file off the UI thread to Android's print spooler and deletes it once finished. */
    private class PdfFilePrintDocumentAdapter(
        private val file: File,
        private val jobName: String,
        private val ioExecutor: java.util.concurrent.ExecutorService,
    ) : PrintDocumentAdapter() {
        override fun onLayout(
            oldAttributes: PrintAttributes?,
            newAttributes: PrintAttributes?,
            cancellationSignal: CancellationSignal?,
            callback: LayoutResultCallback,
            extras: Bundle?,
        ) {
            if (cancellationSignal?.isCanceled == true) {
                callback.onLayoutCancelled()
                return
            }
            ioExecutor.execute {
                if (cancellationSignal?.isCanceled == true) {
                    callback.onLayoutCancelled()
                    return@execute
                }
                val pageCount = try {
                    ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { pfd ->
                        PdfRenderer(pfd).use { renderer ->
                            renderer.pageCount.coerceAtLeast(1)
                        }
                    }
                } catch (_: SecurityException) {
                    PrintDocumentInfo.PAGE_COUNT_UNKNOWN
                } catch (_: Exception) {
                    PrintDocumentInfo.PAGE_COUNT_UNKNOWN
                }
                if (cancellationSignal?.isCanceled == true) {
                    callback.onLayoutCancelled()
                    return@execute
                }
                val info = PrintDocumentInfo.Builder(jobName)
                    .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                    .setPageCount(pageCount)
                    .build()
                callback.onLayoutFinished(info, true)
            }
        }

        override fun onWrite(
            pages: Array<out PageRange>,
            destination: ParcelFileDescriptor,
            cancellationSignal: CancellationSignal,
            callback: WriteResultCallback,
        ) {
            if (cancellationSignal.isCanceled) {
                callback.onWriteCancelled()
                return
            }
            ioExecutor.execute {
                if (cancellationSignal.isCanceled) {
                    callback.onWriteCancelled()
                    return@execute
                }
                try {
                    FileInputStream(file).use { input ->
                        FileOutputStream(destination.fileDescriptor).use { output ->
                            val buffer = ByteArray(16 * 1024)
                            while (true) {
                                if (cancellationSignal.isCanceled) {
                                    callback.onWriteCancelled()
                                    return@execute
                                }
                                val read = input.read(buffer)
                                if (read <= 0) break
                                output.write(buffer, 0, read)
                            }
                            output.flush()
                        }
                    }
                    callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
                } catch (err: Exception) {
                    callback.onWriteFailed(err.message ?: "failed to stream PDF to print spooler")
                }
            }
        }

        override fun onFinish() {
            // Queue deletion on the same single-thread executor so any in-flight write finishes first.
            ioExecutor.execute {
                try {
                    file.delete()
                } catch (_: Exception) {
                    // Startup cleanup removes any leftover files under ieum-tmp/print.
                }
            }
        }
    }

    /** The persisted read grant of the linked folder a tree document URI lives under, if any. */
    private fun treeGrantFor(uri: Uri): UriPermission? {
        val treeId = try {
            DocumentsContract.getTreeDocumentId(uri)
        } catch (_: Exception) {
            return null
        }
        val treeUri = DocumentsContract.buildTreeDocumentUri(uri.authority, treeId)
        return activity.contentResolver.persistedUriPermissions
            .firstOrNull { it.uri == treeUri && it.isReadPermission }
    }

    /** `Document.COLUMN_FLAGS` of a document, or null when it cannot be queried. */
    private fun queryDocumentFlags(uri: Uri): Int? = try {
        activity.contentResolver.query(
            uri,
            arrayOf(DocumentsContract.Document.COLUMN_FLAGS),
            null,
            null,
            null
        )?.use { cursor -> if (cursor.moveToFirst()) cursor.getInt(0) else null }
    } catch (_: Exception) {
        null
    }

    private fun treeRootExists(treeUri: Uri): Boolean = try {
        val root = DocumentsContract.buildDocumentUriUsingTree(
            treeUri,
            DocumentsContract.getTreeDocumentId(treeUri)
        )
        activity.contentResolver.query(
            root,
            arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID),
            null,
            null,
            null
        )?.use { it.moveToFirst() } ?: false
    } catch (_: Exception) {
        false
    }

    private fun queryChildren(treeUri: Uri, parentId: String): List<ChildDoc> {
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId)
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED
        )
        val cursor = activity.contentResolver.query(childrenUri, projection, null, null, null)
            ?: throw FileNotFoundException("folder missing")
        val out = mutableListOf<ChildDoc>()
        cursor.use { c ->
            while (c.moveToNext()) {
                val docId = c.getString(0) ?: continue
                out.add(
                    ChildDoc(
                        docId = docId,
                        name = c.getString(1) ?: docId,
                        mime = c.getString(2),
                        size = if (c.isNull(3)) null else c.getLong(3),
                        modified = if (c.isNull(4)) null else c.getLong(4),
                    )
                )
            }
        }
        return out
    }

    /**
     * Resolves a document under a linked folder with a write grant, or rejects the invoke
     * (`NOT_SUPPORTED` outside linked folders or in read-only ones, `PERMISSION_DENIED` when
     * the folder grant is gone, `NOT_FOUND` when the document is gone) and returns null.
     */
    private fun resolveHomeDoc(invoke: Invoke, uri: Uri): HomeDoc? {
        val treeId = try {
            DocumentsContract.getTreeDocumentId(uri)
        } catch (_: Exception) {
            null
        }
        if (treeId == null) {
            invoke.reject("NOT_SUPPORTED: document is not under a linked folder")
            return null
        }
        val treeUri = DocumentsContract.buildTreeDocumentUri(uri.authority, treeId)
        val grant = activity.contentResolver.persistedUriPermissions.firstOrNull { it.uri == treeUri }
        if (grant == null || !grant.isReadPermission) {
            invoke.reject("PERMISSION_DENIED: folder grant lost")
            return null
        }
        if (!grant.isWritePermission) {
            invoke.reject("NOT_SUPPORTED: the linked folder is read-only")
            return null
        }
        val flags = queryDocumentFlags(uri)
        if (flags == null) {
            invoke.reject("NOT_FOUND: document missing")
            return null
        }
        return HomeDoc(uri, treeUri, DocumentsContract.getDocumentId(uri), flags)
    }

    /** The parent folder's document id inside the linked tree, or null if unknown. */
    private fun parentDocumentId(uri: Uri): String? = try {
        val path = DocumentsContract.findDocumentPath(activity.contentResolver, uri)?.path
        if (path != null && path.size >= 2) path[path.size - 2] else null
    } catch (_: Exception) {
        null
    }

    private fun nameTaken(treeUri: Uri, parentId: String, name: String, exceptDocId: String?): Boolean =
        queryChildren(treeUri, parentId).any {
            it.docId != exceptDocId && it.name.equals(name, ignoreCase = true)
        }

    private fun isValidName(name: String): Boolean {
        val trimmed = name.trim()
        return trimmed.isNotEmpty() && trimmed != "." && trimmed != ".." &&
            !name.contains('/') && !name.contains('\\') && name.none { it.isISOControl() }
    }

    private fun rejectHomeFailure(invoke: Invoke, err: Exception) {
        when (err) {
            is SecurityException, is UnsupportedOperationException ->
                invoke.reject("NOT_SUPPORTED: ${err.message}")
            is FileNotFoundException -> invoke.reject("NOT_FOUND: ${err.message}")
            is IllegalArgumentException -> invoke.reject("NOT_SUPPORTED: ${err.message}")
            else -> invoke.reject("INTERNAL_ERROR: ${err.message}")
        }
    }

    private fun guessMime(name: String): String {
        val ext = name.substringAfterLast('.', "").lowercase()
        if (ext.isEmpty()) return "application/octet-stream"
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
    }

    private fun safeFileName(raw: String): String {
        val cleaned = raw.map { if (it == '/' || it == '\\' || it.isISOControl()) '_' else it }
            .joinToString("")
            .trim()
        return if (cleaned.isEmpty() || cleaned == "." || cleaned == "..") "file" else cleaned
    }

    /** A safe file name, unique (ignoring letter case) among `taken`: `a.png`, `a (2).png`, ... */
    private fun uniqueIncomingName(raw: String, taken: MutableList<String>): String {
        val base = safeFileName(raw)
        val dot = base.lastIndexOf('.')
        val stem = if (dot > 0) base.substring(0, dot) else base
        val ext = if (dot > 0) base.substring(dot) else ""
        var name = base
        var n = 2
        while (taken.any { it.equals(name, ignoreCase = true) }) {
            name = "$stem ($n)$ext"
            n += 1
        }
        taken.add(name)
        return name
    }

    /** One share type for several files: the common type, else a common major type, else any. */
    private fun commonMime(mimes: List<String>): String {
        val distinct = mimes.distinct()
        if (distinct.size == 1) return distinct[0]
        val majors = distinct.map { it.substringBefore('/') }.distinct()
        return if (majors.size == 1) "${majors[0]}/*" else "*/*"
    }

    private fun isOpenableExternalUrl(url: String): Boolean {
        if (url.any { it.isWhitespace() || it.isISOControl() }) return false
        val uri = Uri.parse(url)
        val scheme = uri.scheme?.lowercase() ?: return false
        return when (scheme) {
            "https", "http" -> !uri.host.isNullOrEmpty() && uri.userInfo == null
            "mailto" -> !uri.schemeSpecificPart.isNullOrEmpty()
            else -> false
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

    private companion object {
        /** Received files go to `<cache>/ieum-tmp/home/incoming/<batchId>/` (T6 temp area). */
        const val INCOMING_DIR = "ieum-tmp/home/incoming"
    }
}
