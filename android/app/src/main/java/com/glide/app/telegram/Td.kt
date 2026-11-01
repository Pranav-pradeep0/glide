package com.glide.app.telegram

import android.content.Context
import android.os.Build
import android.util.Log
import com.glide.app.BuildConfig
import org.drinkless.tdlib.Client
import org.drinkless.tdlib.TdApi
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch

/** One TDLib client for the process, started on first use (docs/telegram.md). */
object Td {
    private const val TAG = "GlideTelegram"

    /** Builds without an API ID hide Telegram. */
    val available get() = BuildConfig.TELEGRAM_API_ID != 0 && BuildConfig.TELEGRAM_API_HASH.isNotEmpty()

    class TdException(val code: Int, message: String) : IOException("$code $message")

    private lateinit var app: Context
    private var client: Client? = null
    private val windows = ConcurrentHashMap<Int, TgWindow>()

    @Volatile
    var auth: TdApi.AuthorizationState? = null
        private set

    /** Sign-in state as it changes, on TDLib's thread. */
    @Volatile
    var onAuth: ((TdApi.AuthorizationState) -> Unit)? = null

    /** Every `updateFile`, on TDLib's thread (the debug screen's download speed). */
    @Volatile
    var onFile: ((TdApi.File) -> Unit)? = null

    fun init(context: Context) {
        app = context.applicationContext
    }

    @Synchronized
    private fun client(): Client = client ?: run {
        check(available) { "no Telegram API ID in this build" }
        Client.execute(TdApi.SetLogVerbosityLevel(1))
        Client.create({ onUpdate(it) }, null, null).also { client = it }
    }

    /** Starts TDLib if needed; the sign-in state follows through [onAuth]. */
    fun start() {
        client()
    }

    /**
     * [f]'s answer, waiting for it; never call on TDLib's thread. [inOrder] sees the answer on
     * TDLib's thread, in order with updates.
     */
    fun <R : TdApi.Object> send(f: TdApi.Function<R>, inOrder: (R) -> Unit = {}): R {
        val latch = CountDownLatch(1)
        var result: TdApi.Object? = null
        client().send(f) {
            @Suppress("UNCHECKED_CAST")
            if (it !is TdApi.Error) inOrder(it as R)
            result = it
            latch.countDown()
        }
        latch.await()
        val r = result
        if (r is TdApi.Error) throw TdException(r.code, r.message)
        @Suppress("UNCHECKED_CAST")
        return r as R
    }

    /** Fire and forget; errors only logged. */
    fun post(f: TdApi.Function<*>) = client().send(f) { if (it is TdApi.Error) Log.w(TAG, "${f.javaClass.simpleName}: ${it.code} ${it.message}") }

    private fun onUpdate(o: TdApi.Object) {
        when (o) {
            is TdApi.UpdateAuthorizationState -> {
                val s = o.authorizationState
                auth = s
                Log.i(TAG, "auth: ${s.javaClass.simpleName}")
                if (s is TdApi.AuthorizationStateWaitTdlibParameters) post(parameters())
                onAuth?.invoke(s)
            }
            is TdApi.UpdateFile -> {
                windows[o.file.id]?.onUpdate(progress(o.file))
                onFile?.invoke(o.file)
            }
        }
    }

    private fun parameters() = TdApi.SetTdlibParameters().apply {
        // The session lives here; allowBackup="false" keeps it off backups.
        databaseDirectory = app.filesDir.resolve("tdlib").path
        filesDirectory = app.cacheDir.resolve("tdlib").path
        useFileDatabase = true
        useChatInfoDatabase = true
        useMessageDatabase = true
        useSecretChats = false
        apiId = BuildConfig.TELEGRAM_API_ID
        apiHash = BuildConfig.TELEGRAM_API_HASH
        systemLanguageCode = java.util.Locale.getDefault().language
        deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}"
        systemVersion = "Android ${Build.VERSION.RELEASE}"
        applicationVersion = BuildConfig.VERSION_NAME
    }

    /** The film in message [messageId] of [chatId] (a video, or a video sent as a file). */
    fun file(chatId: Long, messageId: Long): TdApi.File {
        send(TdApi.GetChat(chatId))
        return when (val c = send(TdApi.GetMessage(chatId, messageId)).content) {
            is TdApi.MessageVideo -> c.video.video
            is TdApi.MessageDocument -> c.document.document
            else -> throw TdException(404, "message $messageId is not a video")
        }
    }

    /**
     * Drops a file from TDLib's cache. Cancel first: `deleteFile` alone unlinks the partial file
     * while its download keeps writing into the deleted copy, and TDLib still counts those bytes.
     */
    fun delete(fileId: Int) {
        send(TdApi.CancelDownloadFile(fileId, false))
        send(TdApi.DeleteFile(fileId))
    }

    /** `tg://chatId/messageId` → its download window and size. One window per file, shared. */
    fun open(chatId: Long, messageId: Long): Pair<TgWindow, Long> {
        var f = file(chatId, messageId)
        // TDLib's database can list a partial file that's gone from disk (Android clears
        // cacheDir; the app died mid-delete). Make it forget the file and start over.
        if (f.local.path.isNotEmpty() && !java.io.File(f.local.path).exists()) {
            delete(f.id)
            f = file(chatId, messageId)
        }
        val size = if (f.size > 0) f.size else f.expectedSize
        // Seeded before it's registered, so no update can land ahead of the seed.
        val window = windows[f.id] ?: TgWindow(size, tdlib(f.id)).also {
            it.onUpdate(progress(f))
            windows.putIfAbsent(f.id, it)
        }
        return windows.getValue(f.id) to size
    }

    private fun tdlib(fileId: Int) = object : TgWindow.Tdlib {
        override fun prefixAt(pos: Long) = send(TdApi.GetFileDownloadedPrefixSize(fileId, pos)).size

        override fun download(offset: Long) {
            Log.d(TAG, "downloadFile $fileId @ $offset")
            send(TdApi.DownloadFile(fileId, 32, offset, 0, false)) { windows[fileId]?.onUpdate(progress(it)) }
        }
    }

    private fun progress(f: TdApi.File) = f.local.run {
        Progress(path, downloadOffset, downloadedPrefixSize, isDownloadingActive, isDownloadingCompleted)
    }
}
