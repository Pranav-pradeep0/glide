package com.glide.app.telegram

import android.content.Context
import android.os.Build
import android.util.Log
import com.glide.app.BuildConfig
import org.drinkless.tdlib.Client
import org.drinkless.tdlib.TdApi
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** A file's size, or TDLib's estimate while it isn't known. */
val TdApi.File.total get() = if (size > 0) size else expectedSize

/** One TDLib client for the process, started on first use (docs/telegram.md). */
object Td {
    private const val TAG = "GlideTelegram"

    /** Builds without an API ID hide Telegram. */
    val available get() = BuildConfig.TELEGRAM_API_ID != 0 && BuildConfig.TELEGRAM_API_HASH.isNotEmpty()

    class TdException(val code: Int, val text: String) : IOException("$code $text")

    private lateinit var app: Context
    private var client: Client? = null
    private val windows = ConcurrentHashMap<Int, TgWindow>()

    @Volatile
    var auth: TdApi.AuthorizationState? = null
        private set

    /** Sign-in state as it changes, on TDLib's thread. */
    val onAuth = CopyOnWriteArraySet<(TdApi.AuthorizationState) -> Unit>()

    /** The user's chat folders, in Telegram's order; TDLib sends them once signed in. */
    @Volatile
    var folders: Array<TdApi.ChatFolderInfo> = emptyArray()
        private set

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

    /** [fs] sent together, all answers awaited: one round trip instead of one each. */
    fun <R : TdApi.Object> sendAll(fs: List<TdApi.Function<R>>): List<R> {
        val latch = CountDownLatch(fs.size)
        val results = arrayOfNulls<TdApi.Object>(fs.size)
        fs.forEachIndexed { i, f -> client().send(f) { results[i] = it; latch.countDown() } }
        latch.await()
        results.forEach { if (it is TdApi.Error) throw TdException(it.code, it.message) }
        @Suppress("UNCHECKED_CAST")
        return results.map { it as R }
    }

    /** Fire and forget; errors only logged. */
    fun post(f: TdApi.Function<*>) = client().send(f) { if (it is TdApi.Error) Log.w(TAG, "${f.javaClass.simpleName}: ${it.code} ${it.message}") }

    private fun onUpdate(o: TdApi.Object) {
        when (o) {
            is TdApi.UpdateAuthorizationState -> {
                val s = o.authorizationState
                auth = s
                Log.i(TAG, "auth: ${s.javaClass.simpleName}")
                when (s) {
                    is TdApi.AuthorizationStateWaitTdlibParameters -> post(parameters())
                    is TdApi.AuthorizationStateReady -> post(optimize(cap()))
                    // This client is finished; the next call starts a new one.
                    is TdApi.AuthorizationStateClosed -> synchronized(this) { client = null }
                    else -> {}
                }
                onAuth.forEach { it(s) }
            }
            is TdApi.UpdateChatFolders -> folders = o.chatFolders
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
    fun file(chatId: Long, messageId: Long): TdApi.File =
        when (val c = message(chatId, messageId).content) {
            is TdApi.MessageVideo -> c.video.video
            is TdApi.MessageDocument -> c.document.document
            else -> throw TdException(404, "message $messageId is not a video")
        }

    /** A message, its chat loaded first (TDLib knows no message of a chat it hasn't seen). */
    fun message(chatId: Long, messageId: Long): TdApi.Message {
        send(TdApi.GetChat(chatId))
        return send(TdApi.GetMessage(chatId, messageId))
    }

    /**
     * Drops a file from TDLib's cache. Cancel first: `deleteFile` alone unlinks the partial file
     * while its download keeps writing into the deleted copy, and TDLib still counts those bytes.
     */
    fun delete(fileId: Int) {
        send(TdApi.CancelDownloadFile(fileId, false))
        send(TdApi.DeleteFile(fileId))
    }

    /**
     * [file], made to forget a partial file that's gone from disk (Android clears cacheDir; the
     * app died mid-delete), so its download starts over.
     */
    private fun onDisk(chatId: Long, messageId: Long): TdApi.File {
        val f = file(chatId, messageId)
        if (f.local.path.isEmpty() || java.io.File(f.local.path).exists()) return f
        delete(f.id)
        return file(chatId, messageId)
    }

    /** `tg://chatId/messageId` → its download window and size. One window per file, shared. */
    fun open(chatId: Long, messageId: Long): Pair<TgWindow, Long> {
        val f = onDisk(chatId, messageId)
        val size = f.total
        // Seeded before it's registered, so no update can land ahead of the seed.
        val window = windows[f.id] ?: TgWindow(size, tdlib(f.id)).also {
            it.onUpdate(progress(f))
            windows.putIfAbsent(f.id, it)
        }
        return windows.getValue(f.id) to size
    }

    /**
     * Fetches the film's first and last [PREFETCH] bytes before Play: Matroska needs both (header,
     * then the Cues at the end) before its first frame, ~3 s each (docs/telegram.md, step (a)).
     * Low priority, and stops once the film is playing: its own reads lead then.
     */
    fun prefetch(chatId: Long, messageId: Long) {
        val f = onDisk(chatId, messageId)
        val size = f.total
        for (offset in listOf(0L, maxOf(0L, size - PREFETCH))) {
            if (windows.containsKey(f.id)) return
            val want = minOf(PREFETCH, size - offset)
            if (send(TdApi.GetFileDownloadedPrefixSize(f.id, offset)).size >= want) continue
            Log.d(TAG, "prefetch ${f.id} @ $offset")
            send(TdApi.DownloadFile(f.id, 1, offset, want, true))
        }
    }

    /**
     * A small file (thumbnail, chat photo), downloaded whole: [done] gets its path ("" on an
     * error) on TDLib's thread. No thread waits meanwhile: a screen of rows asks for many at once.
     */
    fun download(fileId: Int, done: (String) -> Unit) =
        client().send(TdApi.DownloadFile(fileId, 16, 0, 0, true)) { done((it as? TdApi.File)?.local?.path.orEmpty()) }

    /** Bytes in TDLib's file cache. */
    fun cacheSize(): Long = send(TdApi.GetStorageStatisticsFast()).filesSize

    /**
     * Stops the films' downloads: each asks for the rest of the file, which TDLib would otherwise
     * fetch whole in the background after the player has gone. What's downloaded stays.
     */
    fun stopStreams() {
        windows.keys.forEach { post(TdApi.CancelDownloadFile(it, false)) }
        windows.clear()
    }

    /** Empties the file cache; the session and chat lists stay. A file still downloading isn't deleted, so stop those first. */
    fun clearCache() {
        stopStreams()
        send(optimize(0))
    }

    // ponytail: a size cap applied when TDLib signs in, not while a film plays. A long session can
    // pass it until the next start; trim on playback end if that matters.
    private fun cap() = minOf(4L shl 30, app.cacheDir.usableSpace / 4)

    private fun optimize(size: Long) = TdApi.OptimizeStorage(size, -1, -1, 0, null, null, null, false, 0)

    /**
     * Signs out and wipes the session and cache, then starts a fresh client (waiting for a phone
     * number). Also how sign-in switches from QR to phone: TDLib can't leave the QR state.
     */
    fun logOut() {
        val closed = CountDownLatch(1)
        val listener: (TdApi.AuthorizationState) -> Unit = { if (it is TdApi.AuthorizationStateClosed) closed.countDown() }
        onAuth += listener
        try {
            send(TdApi.LogOut())
            closed.await(30, TimeUnit.SECONDS)
        } finally {
            onAuth -= listener
        }
        windows.clear()
        app.filesDir.resolve("tdlib").deleteRecursively()
        app.cacheDir.resolve("tdlib").deleteRecursively()
        start()
    }

    private fun tdlib(fileId: Int) = object : TgWindow.Tdlib {
        override fun prefixAt(pos: Long) = send(TdApi.GetFileDownloadedPrefixSize(fileId, pos)).size

        override fun download(offset: Long) {
            Log.d(TAG, "downloadFile $fileId @ $offset")
            send(TdApi.DownloadFile(fileId, 32, offset, 0, false)) { windows[fileId]?.onUpdate(progress(it)) }
        }
    }

    private const val PREFETCH = 2L shl 20

    private fun progress(f: TdApi.File) = f.local.run {
        Progress(path, downloadOffset, downloadedPrefixSize, isDownloadingActive, isDownloadingCompleted)
    }
}
