package com.glide.app.telegram

import android.net.Uri
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.glide.app.player.BackgroundWork
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

    init {
        Td.onAuth += onAuth
    }

    override fun invalidate() {
        Td.onAuth -= onAuth
        events.shutdown()
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

    private fun td(promise: Promise, block: () -> Unit) = BackgroundWork.submit(promise) {
        try {
            block()
        } catch (e: Td.TdException) {
            Log.w(TAG, "${e.code} ${e.text}")
            promise.reject("telegram", Tg.reason(e.code, e.text))
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

    /**
     * Saved Messages (`saved: true`) then the first [limit] chats of the main list, channels left
     * out (docs/telegram.md "Decisions"): `{ id, title, saved, photo, mini }`, `photo` a file id
     * for [thumbnail] (0: none), `mini` a tiny blurred JPEG data URI or null.
     */
    @ReactMethod
    fun chats(limit: Int, promise: Promise) = td(promise) {
        val saved = Td.send(TdApi.CreatePrivateChat(Td.send(TdApi.GetMe()).id, false))
        var ids = Td.send(TdApi.GetChats(TdApi.ChatListMain(), limit)).chatIds
        while (ids.size < limit) {
            try {
                Td.send(TdApi.LoadChats(TdApi.ChatListMain(), limit - ids.size))
            } catch (e: Td.TdException) {
                if (e.code == 404) break // all loaded
                throw e
            }
            val before = ids.size
            ids = Td.send(TdApi.GetChats(TdApi.ChatListMain(), limit)).chatIds
            if (ids.size == before) break
        }
        val out = Arguments.createArray()
        out.pushMap(chat(saved, true))
        for (id in ids) {
            if (id == saved.id) continue
            val c = Td.send(TdApi.GetChat(id))
            val t = c.type
            if (t is TdApi.ChatTypeSecret || (t is TdApi.ChatTypeSupergroup && t.isChannel)) continue
            out.pushMap(chat(c, false))
        }
        promise.resolve(out)
    }

    private fun chat(c: TdApi.Chat, saved: Boolean) = Arguments.createMap().apply {
        putDouble("id", c.id.toDouble())
        putString("title", c.title)
        putBoolean("saved", saved)
        putInt("photo", c.photo?.small?.id ?: 0)
        putString("mini", mini(c.photo?.minithumbnail))
    }

    /**
     * A page of the chat's videos, newest first, older than message [from] (0: from the newest):
     * `{ items, next }`, `next` the [from] of the following page, 0 at the end. Items: `{ uri,
     * name, size, duration, width, height, date, thumb, mini }`; documents carry no duration (0).
     */
    @ReactMethod
    fun videos(chatId: Double, from: Double, limit: Int, promise: Promise) = td(promise) {
        var cursor = from.toLong()
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
            // A page of only non-video documents: keep going rather than hand JS an empty page.
            if (rows.isEmpty() && next != 0L) {
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
        val thumb: TdApi.Thumbnail?
        val blur: TdApi.Minithumbnail?
        when (val c = m.content) {
            is TdApi.MessageVideo -> c.video.run {
                caption = c.caption
                name = fileName
                file = video
                thumb = thumbnail
                blur = minithumbnail
                row.putInt("duration", duration)
                row.putInt("width", width)
                row.putInt("height", height)
            }
            is TdApi.MessageDocument -> c.document.run {
                if (!Tg.isVideo(mimeType, fileName)) return null
                caption = c.caption
                name = fileName
                file = document
                thumb = thumbnail
                blur = minithumbnail
                row.putInt("duration", 0)
                row.putInt("width", 0)
                row.putInt("height", 0)
            }
            else -> return null
        }
        row.putString("uri", "tg://${m.chatId}/${m.id}")
        row.putString("name", name.ifEmpty { caption?.text?.lineSequence()?.firstOrNull()?.trim().orEmpty() }.ifEmpty { "Video" })
        row.putDouble("size", file.total.toDouble())
        row.putDouble("date", m.date * 1000.0)
        row.putInt("thumb", thumb?.file?.id ?: 0)
        row.putString("mini", mini(blur))
        return m.id to row
    }

    private fun mini(m: TdApi.Minithumbnail?) = m?.let { "data:image/jpeg;base64," + Base64.encodeToString(it.data, Base64.NO_WRAP) }

    /** A thumbnail or chat photo by file id (`thumb`, `photo`): resolves a `file://` URI. */
    @ReactMethod
    fun thumbnail(fileId: Int, promise: Promise) = td(promise) {
        val path = Td.download(fileId)
        if (path.isEmpty()) promise.reject("telegram", "No thumbnail") else promise.resolve("file://$path")
    }

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
                val u = Uri.parse(prefetching.getAndSet(null) ?: break)
                val chatId = u.host?.toLongOrNull() ?: continue
                val messageId = u.pathSegments.firstOrNull()?.toLongOrNull() ?: continue
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

    companion object {
        private const val TAG = "GlideTelegram"
        private const val AUTH = "GlideTelegramAuth"
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
