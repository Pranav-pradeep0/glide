package com.glide.app.telegram

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import org.drinkless.tdlib.TdApi
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors

/**
 * Offline saves (docs/telegram.md, Decisions 2026-11-02): whole films, one at a time, downloaded
 * while [TelegramSaveService] keeps the app alive, then moved out of TDLib's cache to
 * `filesDir/telegram/<chatId>_<messageId>.<ext>`, which [TelegramDataSource] plays with no network.
 */
object TgSaves {
    private const val TAG = "GlideTelegram"

    class Item(val uri: String, val chatId: Long, val messageId: Long, val name: String) {
        @Volatile var fileId = 0
        @Volatile var done = 0L
        @Volatile var total = 0L
        /** All of it is on disk; moved out of TDLib's cache once the player lets go of it. */
        @Volatile var complete = false
    }

    /** Waiting and downloading, in order; the first is the one downloading. */
    val queue = CopyOnWriteArrayList<Item>()
    private val worker = Executors.newSingleThreadExecutor()

    /** The queue or a download's progress changed (progress at most once a second). */
    val onChange = CopyOnWriteArraySet<() -> Unit>()
    private var lastTick = 0L

    private fun dir() = Td.app.filesDir.resolve("telegram")

    /** The saved film of message [messageId] in [chatId], or null. */
    fun file(chatId: Long, messageId: Long): File? =
        dir().listFiles()?.firstOrNull { it.name.startsWith("${chatId}_$messageId.") }

    /** Saved films: `tg://` URI → file. */
    fun saved(): List<Pair<String, File>> = dir().listFiles().orEmpty().mapNotNull { f ->
        val (chat, msg) = f.nameWithoutExtension.split('_').takeIf { it.size == 2 } ?: return@mapNotNull null
        "tg://$chat/$msg" to f
    }

    fun save(chatId: Long, messageId: Long, name: String) {
        val uri = "tg://$chatId/$messageId"
        if (queue.any { it.uri == uri } || file(chatId, messageId) != null) return
        val item = Item(uri, chatId, messageId, name)
        queue += item
        changed()
        Td.app.startForegroundService(Intent(Td.app, TelegramSaveService::class.java))
        worker.execute { run(item) }
    }

    /** Cancels a save waiting or downloading (what's downloaded stays in TDLib's cache), or deletes a saved film. */
    fun remove(chatId: Long, messageId: Long) {
        val item = queue.firstOrNull { it.chatId == chatId && it.messageId == messageId }
        if (item != null) cancel(item) else file(chatId, messageId)?.delete()
        changed()
    }

    private fun cancel(item: Item) {
        queue.remove(item)
        // Wakes the synchronous downloadFile in [run].
        if (item.fileId != 0) Td.post(TdApi.CancelDownloadFile(item.fileId, false))
    }

    /** Cancels every save and deletes every saved film (logging out, Settings). */
    fun wipe() {
        queue.toList().forEach(::cancel)
        dir().deleteRecursively()
        changed()
    }

    private fun run(item: Item) {
        if (item !in queue) return
        try {
            val f = Td.file(item.chatId, item.messageId)
            item.fileId = f.id
            item.total = f.total
            // Not deleted when another film is opened.
            Td.saving += f.id
            while (item in queue) {
                // The player leads (TDLib keeps one download per file); carry on once it closes.
                if (Td.streaming(f.id)) {
                    Thread.sleep(2000)
                    continue
                }
                // Returns when complete, cancelled, or the player asked for another range.
                val r = Td.send(TdApi.DownloadFile(f.id, 1, 0, 0, true))
                if (r.local.isDownloadingCompleted) {
                    keep(item, r)
                    break
                }
                Thread.sleep(1000)
            }
        } catch (e: Exception) {
            Log.w(TAG, "save ${item.uri}", e)
        } finally {
            Td.saving -= item.fileId
            queue.remove(item)
            changed()
        }
    }

    /** Moves the finished film out of TDLib's cache (Android may empty it) and makes TDLib forget it. */
    private fun keep(item: Item, f: TdApi.File) {
        val src = File(f.local.path)
        val dst = dir().apply { mkdirs() }.resolve("${item.chatId}_${item.messageId}.${src.extension.ifEmpty { "mp4" }}")
        // Same volume (/data), so a rename: instant, and never a half-copied film.
        if (!src.renameTo(dst)) throw java.io.IOException("can't move ${src.path}")
        Td.send(TdApi.DeleteFile(f.id))
        Log.d(TAG, "saved ${item.uri} (${dst.length()} bytes)")
    }

    /** TDLib's `updateFile`, for the progress of the film downloading. */
    fun onFile(f: TdApi.File) {
        val item = queue.firstOrNull { it.fileId == f.id } ?: return
        item.done = f.local.downloadedSize
        // Shown as saved now, even while the player still reads it.
        if (f.local.isDownloadingCompleted && !item.complete) {
            item.complete = true
            changed()
            return
        }
        val now = System.currentTimeMillis()
        if (now - lastTick >= 1000) {
            lastTick = now
            changed()
        }
    }

    private fun changed() = onChange.forEach { it() }
}

/** Keeps the app alive while [TgSaves] downloads, with a progress notification and Cancel. */
class TelegramSaveService : Service() {
    private val update = { show() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CHANNEL, "Telegram downloads", NotificationManager.IMPORTANCE_LOW))
        TgSaves.onChange += update
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == CANCEL) TgSaves.queue.firstOrNull()?.let { TgSaves.remove(it.chatId, it.messageId) }
        ServiceCompat.startForeground(this, ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        if (TgSaves.queue.isEmpty()) stopSelf()
        return START_NOT_STICKY
    }

    /** Android 15 caps dataSync at 6 hours a day: stop rather than be stopped. */
    override fun onTimeout(startId: Int, fgsType: Int) {
        TgSaves.queue.toList().forEach { TgSaves.remove(it.chatId, it.messageId) }
        stopSelf()
    }

    override fun onDestroy() {
        TgSaves.onChange -= update
        super.onDestroy()
    }

    private fun show() {
        if (TgSaves.queue.isEmpty()) {
            stopSelf()
            return
        }
        getSystemService(NotificationManager::class.java).notify(ID, notification())
    }

    private fun notification(): Notification {
        val item = TgSaves.queue.firstOrNull()
        val waiting = TgSaves.queue.size - 1
        val percent = if (item != null && item.total > 0) (item.done * 100 / item.total).toInt() else 0
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
        }
        val cancel = PendingIntent.getService(this, 1, Intent(this, TelegramSaveService::class.java).setAction(CANCEL), PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(item?.name ?: "Downloading")
            .setContentText(if (waiting > 0) "$percent% · $waiting more waiting" else "$percent%")
            .setProgress(100, percent, item == null || item.total == 0L)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .addAction(0, "Cancel", cancel)
            .build()
    }

    companion object {
        private const val CHANNEL = "telegram_saves"
        private const val ID = 7301
        private const val CANCEL = "com.glide.app.telegram.CANCEL_SAVE"
    }
}

/** `tg://chatId/messageId` → its ids, or null. */
fun tgIds(uri: String): Pair<Long, Long>? {
    val u = Uri.parse(uri)
    return (u.host?.toLongOrNull() ?: return null) to (u.pathSegments.firstOrNull()?.toLongOrNull() ?: return null)
}
