package com.glide.app.telegram

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.glide.app.smb.PhoneSignIn
import org.drinkless.tdlib.TdApi
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

/**
 * Telegram for JS (docs/telegram.md): sign-in, chats, their videos, thumbnails, the file cache.
 * Playback goes through [TelegramDataSource]. Failures reject with code `telegram` and a message
 * for the user ([Tg.reason]).
 */
class TelegramModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "GlideTelegram"

    override fun getConstants(): Map<String, Any> = mapOf("available" to Td.available)

    // One thread, so sign-in states reach JS in order (building one may ask TDLib for the user).
    private val events = Executors.newSingleThreadExecutor()
    private val onAuth: (TdApi.AuthorizationState) -> Unit = { s -> events.execute { emit(s) } }

    private val onSaves: () -> Unit = { events.execute { emitSaves() } }

    init {
        Td.onAuth += onAuth
        TgSaves.onChange += onSaves
    }

    // Telegram's calls mostly wait on the network: their own threads, so a slow search never holds
    // up the app's file work (BackgroundWork's two threads) or the thumbnails queued behind it.
    private val pool = Executors.newFixedThreadPool(8)

    override fun invalidate() {
        Td.onAuth -= onAuth
        TgSaves.onChange -= onSaves
        events.shutdown()
        pool.shutdown()
        super.invalidate()
    }

    private fun emit(s: TdApi.AuthorizationState) = runCatching {
        reactApplicationContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit(AUTH, state(s))
    }.onFailure { Log.w(TAG, "auth event", it) }

    /**
     * `{ state }`, one of `starting`, `phone`, `code` (+ `phone`, `sentTo`: `telegram`/`sms`/
     * `other`), `qr` (+ `link`, `qr` PNG data URI, redrawn as TDLib renews the link), `password`
     * (+ `hint`), `ready` (+ `name`, `phone`), `loggingOut`, `unsupported` (+ `what`: Telegram wants
     * an email or a new account, done in the Telegram app first).
     */
    private fun state(s: TdApi.AuthorizationState?): WritableMap = Arguments.createMap().apply {
        val state = when (s) {
            null, is TdApi.AuthorizationStateWaitTdlibParameters -> "starting"
            is TdApi.AuthorizationStateWaitPhoneNumber -> "phone"
            is TdApi.AuthorizationStateWaitCode -> {
                putString("phone", s.codeInfo.phoneNumber)
                putString("sentTo", when (s.codeInfo.type) {
                    is TdApi.AuthenticationCodeTypeTelegramMessage -> "telegram"
                    is TdApi.AuthenticationCodeTypeSms -> "sms"
                    else -> "other"
                })
                "code"
            }
            is TdApi.AuthorizationStateWaitOtherDeviceConfirmation -> {
                putString("link", s.link)
                putString("qr", PhoneSignIn.qrPng(s.link))
                "qr"
            }
            is TdApi.AuthorizationStateWaitPassword -> {
                putString("hint", s.passwordHint)
                "password"
            }
            is TdApi.AuthorizationStateReady -> {
                val me = Td.send(TdApi.GetMe())
                putString("name", "${me.firstName} ${me.lastName}".trim())
                putString("phone", me.phoneNumber)
                "ready"
            }
            is TdApi.AuthorizationStateLoggingOut, is TdApi.AuthorizationStateClosing, is TdApi.AuthorizationStateClosed -> "loggingOut"
            else -> {
                putString("what", s.javaClass.simpleName.removePrefix("AuthorizationStateWait"))
                "unsupported"
            }
        }
        putString("state", state)
    }

    private fun td(promise: Promise, block: () -> Unit) = pool.execute {
        try {
            block()
        } catch (e: Td.TdException) {
            Log.w(TAG, "${e.code} ${e.text}")
            promise.reject("telegram", Tg.reason(e.code, e.text))
        } catch (t: Throwable) {
            // An Error would kill the thread with the Promise unsettled; rejecting a settled one is a no-op.
            Log.w(TAG, "call failed", t)
            promise.reject("telegram", t.message ?: "Telegram failed", t)
        }
    }

    /** Starts TDLib; resolves the sign-in [state]. Changes follow as [AUTH] events. */
    @ReactMethod
    fun start(promise: Promise) = td(promise) {
        Td.start()
        promise.resolve(state(Td.auth))
    }

    @ReactMethod
    fun phoneNumber(number: String, promise: Promise) = td(promise) {
        Td.send(TdApi.SetAuthenticationPhoneNumber(number, null))
        promise.resolve(null)
    }

    @ReactMethod
    fun code(code: String, promise: Promise) = td(promise) {
        Td.send(TdApi.CheckAuthenticationCode(code))
        promise.resolve(null)
    }

    @ReactMethod
    fun password(password: String, promise: Promise) = td(promise) {
        Td.send(TdApi.CheckAuthenticationPassword(password))
        promise.resolve(null)
    }

    /** From `phone`, `code` or `password` to `qr`. Back the other way is [logOut]. */
    @ReactMethod
    fun requestQr(promise: Promise) = td(promise) {
        Td.send(TdApi.RequestQrCodeAuthentication(LongArray(0)))
        promise.resolve(null)
    }

    /** Signs out (or abandons a sign-in), wipes the session and the cache; ends at `phone`. */
    @ReactMethod
    fun logOut(promise: Promise) = td(promise) {
        Td.logOut()
        promise.resolve(null)
    }

    /** The user's Telegram chat folders, in their order: `[{ id, name }]`; empty when none. */
    @ReactMethod
    fun folders(promise: Promise) = td(promise) {
        val out = Arguments.createArray()
        Td.folders.forEach { f ->
            out.pushMap(Arguments.createMap().apply {
                putInt("id", f.id)
                putString("name", f.name.text.text)
            })
        }
        promise.resolve(out)
    }

    /**
     * The first [limit] chats of folder [folderId] (0: all chats, with Saved Messages first) in
     * Telegram's order, channels left out (docs/telegram.md "Decisions"): `{ id, title, saved,
     * group, date, preview }` (the last message: ms, one line). Local, no search: which chats have
     * videos is only known by searching each (slow, rate-limited), so a chat says so when opened.
     */
    @ReactMethod
    fun chats(limit: Int, folderId: Int, promise: Promise) = td(promise) {
        val saved = savedChat()
        val ids = chatIds(chatList(folderId), limit)
        val out = Arguments.createArray()
        // A folder keeps its own order; all chats lead with Saved Messages, where videos are sent.
        if (folderId == 0) out.pushMap(chat(saved, true))
        for (id in ids) {
            if (folderId == 0 && id == saved.id) continue
            val c = Td.send(TdApi.GetChat(id))
            if (listable(c)) out.pushMap(chat(c, id == saved.id))
        }
        promise.resolve(out)
    }

    /** The first [limit] chats of [list], loading more from Telegram as needed. */
    private fun chatIds(list: TdApi.ChatList, limit: Int): LongArray {
        var ids = Td.send(TdApi.GetChats(list, limit)).chatIds
        while (ids.size < limit) {
            try {
                Td.send(TdApi.LoadChats(list, limit - ids.size))
            } catch (e: Td.TdException) {
                if (e.code == 404) break // all loaded
                throw e
            }
            val before = ids.size
            ids = Td.send(TdApi.GetChats(list, limit)).chatIds
            if (ids.size == before) break
        }
        return ids
    }

    private fun chatList(folderId: Int) = if (folderId == 0) TdApi.ChatListMain() else TdApi.ChatListFolder(folderId)

    private fun savedChat() = Td.send(TdApi.CreatePrivateChat(Td.send(TdApi.GetMe()).id, false))

    /** Not channels (docs/telegram.md "Decisions") and not secret chats. */
    private fun listable(c: TdApi.Chat) = c.type.let { t -> t !is TdApi.ChatTypeSecret && !(t is TdApi.ChatTypeSupergroup && t.isChannel) }

    private fun chat(c: TdApi.Chat, saved: Boolean) = Arguments.createMap().apply {
        putDouble("id", c.id.toDouble())
        putString("title", c.title)
        putBoolean("saved", saved)
        putBoolean("group", c.type !is TdApi.ChatTypePrivate)
        putDouble("date", (c.lastMessage?.date ?: 0) * 1000.0)
        putString("preview", preview(c.lastMessage))
    }

    /** The last message in one line, as Telegram's chat list shows it. */
    private fun preview(m: TdApi.Message?): String = when (val c = m?.content) {
        null -> ""
        is TdApi.MessageText -> c.text.text
        is TdApi.MessageVideo -> c.caption.text.ifBlank { "Video" }
        is TdApi.MessageDocument -> c.document.fileName.ifBlank { "File" }
        is TdApi.MessagePhoto -> c.caption.text.ifBlank { "Photo" }
        is TdApi.MessageAnimation -> "GIF"
        is TdApi.MessageSticker -> "Sticker"
        is TdApi.MessageVoiceNote -> "Voice message"
        is TdApi.MessageVideoNote -> "Video message"
        is TdApi.MessageAudio -> c.audio.title.ifBlank { "Audio" }
        else -> ""
    }.lineSequence().firstOrNull()?.trim()?.take(120).orEmpty()

    /** The chat's small photo as a `file://` URI, or null when it has none. */
    @ReactMethod
    fun chatPhoto(chatId: Double, promise: Promise) = td(promise) {
        val small = Td.send(TdApi.GetChat(chatId.toLong())).photo?.small ?: return@td promise.resolve(null)
        Td.download(small.id) { promise.resolve(if (it.isEmpty()) null else "file://$it") }
    }

    /**
     * Whether the chat has any video, for hiding the chats that don't. Counts only (TDLib's own
     * figure first, free, then the server's); a chat with files but no video filter hit has its
     * newest files looked at, since MKVs are usually sent as files. Rejects when it can't tell.
     * JS asks a few chats at a time: more brings FLOOD_WAIT.
     */
    @ReactMethod
    fun hasVideos(chatId: Double, promise: Promise) = td(promise) {
        val id = chatId.toLong()
        promise.resolve(count(id, TdApi.SearchMessagesFilterVideo()) > 0 ||
            (count(id, TdApi.SearchMessagesFilterDocument()) > 0 && Td.send(TdApi.SearchChatMessages().apply {
                this.chatId = id
                query = ""
                limit = 100
                filter = TdApi.SearchMessagesFilterDocument()
            }).messages.any { video(it) != null }))
    }

    /** Messages of [filter] in the chat: TDLib's local figure, else the server's; a short FLOOD_WAIT waited out once. */
    private fun count(chatId: Long, filter: TdApi.SearchMessagesFilter): Int {
        Td.send(TdApi.GetChatMessageCount(chatId, null, filter, true)).count.let { if (it >= 0) return it }
        return try {
            Td.send(TdApi.GetChatMessageCount(chatId, null, filter, false)).count
        } catch (e: Td.TdException) {
            val wait = Regex("""\d+""").find(e.text)?.value?.toLongOrNull()
            if (e.code != 429 || wait == null || wait > 60) throw e
            Log.d(TAG, "count $chatId: FLOOD_WAIT $wait s")
            Thread.sleep(wait * 1000)
            Td.send(TdApi.GetChatMessageCount(chatId, null, filter, false)).count
        }
    }

    /**
     * The newest videos across all chats, one page only (docs/telegram.md "Decisions"): `{ chatId:
     * { name, date } }`, each chat's newest video. A hint for the chat list, never a filter.
     */
    @ReactMethod
    fun recent(promise: Promise) = td(promise) {
        val start = System.currentTimeMillis()
        val found = Td.sendAll(listOf(TdApi.SearchMessagesFilterVideo(), TdApi.SearchMessagesFilterDocument()).map {
            TdApi.SearchMessages(TdApi.ChatListMain(), "", "", 100, it, null, 0, 0)
        })
        val out = Arguments.createMap()
        found.flatMap { it.messages.asList() }.sortedByDescending { it.date }.forEach { m ->
            val key = m.chatId.toString()
            if (out.hasKey(key)) return@forEach
            val row = video(m)?.second ?: return@forEach
            out.putMap(key, Arguments.createMap().apply {
                putString("name", row.getString("name"))
                putDouble("date", row.getDouble("date"))
            })
        }
        Log.d(TAG, "recent: ${found.sumOf { it.messages.size }} messages in ${System.currentTimeMillis() - start} ms")
        promise.resolve(out)
    }

    /**
     * A page of the chat's videos, newest first, older than message [from] (0: from the newest):
     * `{ items, next }`, `next` the [from] of the following page, 0 at the end. Items: `{ uri,
     * name, size, duration, width, height, date }`; documents carry no duration (0); [poster]
     * gives the picture. A page can be empty with more to come: a chat of other files is searched
     * a few pages at a time, not to its end in one call.
     */
    @ReactMethod
    fun videos(chatId: Double, from: Double, limit: Int, promise: Promise) = td(promise) {
        var cursor = from.toLong()
        var pages = 0
        while (true) {
            val found = listOf(TdApi.SearchMessagesFilterVideo(), TdApi.SearchMessagesFilterDocument()).map { f ->
                Td.send(TdApi.SearchChatMessages().apply {
                    this.chatId = chatId.toLong()
                    query = ""
                    fromMessageId = cursor
                    this.limit = limit
                    filter = f
                })
            }
            val (rows, next) = Tg.page(found.flatMap { it.messages.mapNotNull(::video) }, found.map { it.nextFromMessageId }, cursor)
            // A page of only non-video documents: look a little further before handing JS an empty page.
            if (rows.isEmpty() && next != 0L && ++pages < 3) {
                cursor = next
                continue
            }
            val items = Arguments.createArray()
            rows.forEach { items.pushMap(it.second) }
            promise.resolve(Arguments.createMap().apply {
                putArray("items", items)
                putDouble("next", next.toDouble())
            })
            return@td
        }
    }

    private fun video(m: TdApi.Message): Pair<Long, WritableMap>? {
        val row = Arguments.createMap()
        val caption: TdApi.FormattedText?
        val name: String
        val file: TdApi.File
        when (val c = m.content) {
            is TdApi.MessageVideo -> c.video.run {
                caption = c.caption
                name = fileName
                file = video
                row.putInt("duration", duration)
                row.putInt("width", width)
                row.putInt("height", height)
            }
            is TdApi.MessageDocument -> c.document.run {
                if (!Tg.isVideo(mimeType, fileName)) return null
                caption = c.caption
                name = fileName
                file = document
                row.putInt("duration", 0)
                row.putInt("width", 0)
                row.putInt("height", 0)
            }
            else -> return null
        }
        row.putString("uri", "tg://${m.chatId}/${m.id}")
        row.putDouble("chatId", m.chatId.toDouble())
        row.putString("name", name.ifEmpty { caption?.text?.lineSequence()?.firstOrNull()?.trim().orEmpty() }.ifEmpty { "Video" })
        row.putDouble("size", file.total.toDouble())
        row.putDouble("date", m.date * 1000.0)
        return m.id to row
    }

    /**
     * The picture Telegram keeps for a `tg://` film (never a frame: that would download part of
     * it): resolves a `file://` URI, or null when it has none.
     */
    @ReactMethod
    fun poster(uri: String, promise: Promise) = td(promise) {
        val (chatId, messageId) = parse(uri) ?: return@td promise.resolve(null)
        val thumb = when (val c = Td.message(chatId, messageId).content) {
            is TdApi.MessageVideo -> c.video.thumbnail
            is TdApi.MessageDocument -> c.document.thumbnail
            else -> null
        }
        if (thumb == null) return@td promise.resolve(null)
        Td.download(thumb.file.id) { promise.resolve(if (it.isEmpty()) null else "file://$it") }
    }

    private fun parse(uri: String) = tgIds(uri)

    private val prefetching = AtomicReference<String?>()
    private val prefetcher = Executors.newSingleThreadExecutor()

    /**
     * Fetches a `tg://` film's head and tail ahead of Play ([Td.prefetch]); call when a film is
     * opened or focused. Only the latest call is worked on; a focus that moved on is dropped.
     */
    @ReactMethod
    fun prefetch(uri: String) {
        if (!Td.available || prefetching.getAndSet(uri) != null) return
        prefetcher.execute {
            while (true) {
                val u = prefetching.getAndSet(null) ?: break
                val (chatId, messageId) = parse(u) ?: continue
                runCatching { Td.prefetch(chatId, messageId) }.onFailure { Log.w(TAG, "prefetch $u", it) }
            }
        }
    }

    /** Bytes of downloaded films and thumbnails. */
    @ReactMethod
    fun cacheSize(promise: Promise) = td(promise) {
        promise.resolve(Td.cacheSize().toDouble())
    }

    @ReactMethod
    fun clearCache(promise: Promise) = td(promise) {
        Td.clearCache()
        promise.resolve(null)
    }

    /**
     * Offline saves: `[{ uri, state, done, total }]`, `state` `downloading` (the first),
     * `waiting` or `saved` (`done` = `total` = the file's size). Changes follow as [SAVES] events.
     */
    @ReactMethod
    fun saves(promise: Promise) = td(promise) { promise.resolve(savesList()) }

    private fun savesList() = Arguments.createArray().apply {
        val queue = TgSaves.queue.toList()
        queue.forEachIndexed { i, it ->
            pushMap(if (it.complete) save(it.uri, "saved", it.total, it.total) else save(it.uri, if (i == 0) "downloading" else "waiting", it.done, it.total))
        }
        // A film being moved is in both for a moment: once.
        TgSaves.saved().forEach { (uri, f) -> if (queue.none { it.uri == uri }) pushMap(save(uri, "saved", f.length(), f.length())) }
    }

    private fun save(uri: String, state: String, done: Long, total: Long) = Arguments.createMap().apply {
        putString("uri", uri)
        putString("state", state)
        putDouble("done", done.toDouble())
        putDouble("total", total.toDouble())
    }

    private fun emitSaves() = runCatching {
        reactApplicationContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit(SAVES, savesList())
    }.onFailure { Log.w(TAG, "saves event", it) }

    /** Saves a `tg://` film for offline, queued after any others; [name] goes on the notification. */
    @ReactMethod
    fun save(uri: String, name: String, promise: Promise) = td(promise) {
        val (chatId, messageId) = parse(uri) ?: return@td promise.resolve(null)
        TgSaves.save(chatId, messageId, name)
        promise.resolve(null)
    }

    /** Cancels a save, or deletes a saved film. */
    @ReactMethod
    fun unsave(uri: String, promise: Promise) = td(promise) {
        val (chatId, messageId) = parse(uri) ?: return@td promise.resolve(null)
        TgSaves.remove(chatId, messageId)
        promise.resolve(null)
    }

    /** Cancels every save and deletes every saved film. */
    @ReactMethod
    fun deleteSaves(promise: Promise) = td(promise) {
        TgSaves.wipe()
        promise.resolve(null)
    }

    companion object {
        private const val TAG = "GlideTelegram"
        private const val AUTH = "GlideTelegramAuth"
        private const val SAVES = "GlideTelegramSaves"
    }
}

/** The module's TDLib-free rules, unit-tested. */
object Tg {
    private val VIDEO = Regex("""\.(mkv|mp4|m4v|mov|avi|webm|ts|wmv|flv|3gp)$""", RegexOption.IGNORE_CASE)

    /** A document worth listing: MKVs are usually sent as files. */
    fun isVideo(mime: String, name: String) = mime.startsWith("video/") || VIDEO.containsMatchIn(name)

    /**
     * One page from several searches run from the same message ([from], 0: newest). Each search
     * stopped at its own `next` (0: it has no more), so only rows down to the highest `next` are
     * complete; rows below it come again on the next page, which starts there. Rows newest first.
     */
    fun <T> page(rows: List<Pair<Long, T>>, nexts: List<Long>, from: Long): Pair<List<Pair<Long, T>>, Long> {
        val next = nexts.maxOrNull() ?: 0L
        return rows.filter { (id) -> id >= next && (from == 0L || id < from) }.distinctBy { it.first }.sortedByDescending { it.first } to next
    }

    /** TDLib's error, in words for the sign-in screen. */
    fun reason(code: Int, message: String): String {
        if (code == 429) {
            val minutes = ((Regex("""\d+""").find(message)?.value?.toLongOrNull() ?: 60L) + 59) / 60
            val wait = if (minutes >= 120) "${(minutes + 59) / 60} hours" else if (minutes == 1L) "1 minute" else "$minutes minutes"
            return "Too many tries. Try again in $wait"
        }
        return when {
            "PHONE_CODE_INVALID" in message -> "Wrong code"
            "PHONE_CODE_EXPIRED" in message -> "That code has expired. Start again for a new one"
            "PASSWORD_HASH_INVALID" in message -> "Wrong password"
            "PHONE_NUMBER_INVALID" in message -> "Check the number, with its country code (+91…)"
            "PHONE_NUMBER_BANNED" in message -> "Telegram has banned this number"
            else -> message
        }
    }
}
