package com.glide.app.telegram

import android.app.Activity
import android.content.res.Configuration
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.InputType
import android.util.Log
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import com.glide.app.smb.PhoneSignIn
import com.glide.app.smb.SmbAwareDataSource
import org.drinkless.tdlib.TdApi
import java.util.concurrent.Executors

/**
 * Step (a) spike (docs/telegram.md), debug builds only:
 * `adb shell am start -n com.glide.player/com.glide.app.telegram.TelegramDebugActivity`.
 * Sign-in (phone: number + code; TV: QR), then the newest videos of Saved Messages; tap one to play it through
 * [TelegramDataSource] and read the numbers (also logged, tag `GlideTelegram`). Leaving a film
 * deletes its download, so every run starts cold.
 */
@OptIn(UnstableApi::class)
class TelegramDebugActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private lateinit var status: TextView
    private lateinit var qr: ImageView
    private lateinit var password: EditText
    private lateinit var list: LinearLayout
    private lateinit var browse: ScrollView
    private lateinit var playerView: PlayerView
    private lateinit var stats: TextView
    private var player: ExoPlayer? = null
    private var playingFile = 0
    private var started = 0L
    private var firstFrameMs = -1L
    private var stalls = 0
    private val samples = ArrayDeque<Pair<Long, Long>>() // (elapsed ms, downloadedSize)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        status = TextView(this).apply { textSize = 18f }
        qr = ImageView(this).apply { visibility = View.GONE }
        // One field for the phone number, the code and the 2-step password, in turn.
        password = EditText(this).apply { visibility = View.GONE }
        val passwordGo = Button(this).apply {
            text = "Next"
            visibility = View.GONE
            setOnClickListener {
                val t = password.text.toString().trim()
                val f = when (Td.auth) {
                    is TdApi.AuthorizationStateWaitPhoneNumber -> TdApi.SetAuthenticationPhoneNumber(t, null)
                    is TdApi.AuthorizationStateWaitCode -> TdApi.CheckAuthenticationCode(t)
                    else -> TdApi.CheckAuthenticationPassword(t)
                }
                io.execute { runCatching { Td.send(f) }.onFailure { say("${status.text}\n${it.message}") } }
            }
        }
        password.tag = passwordGo
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        browse = ScrollView(this).apply {
            addView(LinearLayout(this@TelegramDebugActivity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(48, 48, 48, 48)
                listOf(status, qr, password, passwordGo, list).forEach { addView(it) }
            })
        }
        playerView = PlayerView(this).apply { visibility = View.GONE }
        stats = TextView(this).apply {
            setBackgroundColor(0x99000000.toInt())
            setTextColor(0xffffffff.toInt())
            setPadding(24, 12, 24, 12)
            visibility = View.GONE
        }
        setContentView(FrameLayout(this).apply {
            setBackgroundColor(0xffffffff.toInt())
            addView(browse, MATCH_PARENT, MATCH_PARENT)
            addView(playerView, MATCH_PARENT, MATCH_PARENT)
            addView(stats, WRAP_CONTENT, WRAP_CONTENT)
        })

        if (!Td.available) {
            say("No TELEGRAM_API_ID/TELEGRAM_API_HASH in .env for this build.")
            return
        }
        say("Starting TDLib…")
        Td.onAuth += onAuth
        Td.onFile = { f -> if (f.id == playingFile) main.post { sample(f.local.downloadedSize) } }
        io.execute {
            Td.start()
            Td.auth?.let { s -> main.post { show(s) } }
        }
    }

    private val onAuth: (TdApi.AuthorizationState) -> Unit = { s -> main.post { show(s) } }

    private fun say(text: String) { main.post { status.text = text } }

    private val isTv get() =
        (resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK) == Configuration.UI_MODE_TYPE_TELEVISION

    private fun ask(prompt: String, type: Int) {
        say(prompt)
        password.inputType = type
        password.text.clear()
        password.visibility = View.VISIBLE
        (password.tag as View).visibility = View.VISIBLE
        password.requestFocus()
    }

    private fun show(s: TdApi.AuthorizationState) {
        qr.visibility = View.GONE
        password.visibility = View.GONE
        (password.tag as View).visibility = View.GONE
        when (s) {
            // TV: QR, scanned with the phone. Phone: number + code (it can't scan its own screen).
            is TdApi.AuthorizationStateWaitPhoneNumber -> if (isTv) {
                say("Asking Telegram for a sign-in QR code…")
                io.execute { runCatching { Td.send(TdApi.RequestQrCodeAuthentication(LongArray(0))) }.onFailure { say("QR: ${it.message}") } }
            } else ask("Phone number, with country code (+91…)", InputType.TYPE_CLASS_PHONE)
            is TdApi.AuthorizationStateWaitCode -> ask("Code Telegram sent to your Telegram app", InputType.TYPE_CLASS_NUMBER)
            is TdApi.AuthorizationStateWaitOtherDeviceConfirmation -> {
                say("On your phone: Telegram → Settings → Devices → Link Desktop Device, and scan this.")
                qr.setImageBitmap(PhoneSignIn.qrBitmap(s.link))
                qr.visibility = View.VISIBLE
            }
            is TdApi.AuthorizationStateWaitPassword -> ask(
                "Two-step password${if (s.passwordHint.isNullOrEmpty()) "" else " (hint: ${s.passwordHint})"}",
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD,
            )
            is TdApi.AuthorizationStateReady -> {
                say("Signed in. Newest videos in Saved Messages:")
                io.execute { loadVideos() }
            }
            else -> say("Telegram: ${s.javaClass.simpleName}")
        }
    }

    private class Film(val chatId: Long, val messageId: Long, val fileId: Int, val name: String, val size: Long, val date: Int)

    private fun loadVideos() {
        val films = runCatching {
            val chat = Td.send(TdApi.CreatePrivateChat(Td.send(TdApi.GetMe()).id, false))
            listOf(TdApi.SearchMessagesFilterVideo(), TdApi.SearchMessagesFilterDocument()).flatMap { filter ->
                Td.send(TdApi.SearchChatMessages().apply {
                    chatId = chat.id
                    query = ""
                    limit = 20
                    this.filter = filter
                }).messages.toList()
            }.mapNotNull { m ->
                when (val c = m.content) {
                    is TdApi.MessageVideo -> Film(m.chatId, m.id, c.video.video.id, c.video.fileName, c.video.video.size, m.date)
                    is TdApi.MessageDocument -> c.document.takeIf { d ->
                        d.mimeType.startsWith("video/") || VIDEO.containsMatchIn(d.fileName)
                    }?.let { d -> Film(m.chatId, m.id, d.document.id, d.fileName, d.document.size, m.date) }
                    else -> null
                }
            }.sortedByDescending { it.date }.take(10)
        }.getOrElse { return say("Saved Messages: ${it.message}") }
        main.post {
            list.removeAllViews()
            if (films.isEmpty()) status.text = "No videos in Saved Messages."
            films.forEach { f ->
                list.addView(Button(this).apply {
                    text = "${f.name.ifEmpty { "video" }} · ${f.size shr 20} MB"
                    isAllCaps = false
                    setOnClickListener { play(f) }
                })
            }
            list.getChildAt(0)?.requestFocus()
        }
    }

    private fun play(f: Film) {
        stop()
        playingFile = f.fileId
        started = SystemClock.elapsedRealtime()
        firstFrameMs = -1
        stalls = 0
        samples.clear()
        val p = ExoPlayer.Builder(this, DefaultRenderersFactory(this).setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON))
            // The player's own factory (GlidePlayerView), so this is the same tg:// path.
            .setMediaSourceFactory(DefaultMediaSourceFactory(SmbAwareDataSource.Factory(DefaultDataSource.Factory(this))))
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        p.addListener(object : Player.Listener {
            override fun onRenderedFirstFrame() {
                if (firstFrameMs < 0) {
                    firstFrameMs = SystemClock.elapsedRealtime() - started
                    Log.i(TAG, "first frame ${firstFrameMs} ms: ${f.name} (${f.size shr 20} MB)")
                }
            }

            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_BUFFERING && firstFrameMs >= 0) {
                    stalls++
                    Log.i(TAG, "stall $stalls at ${p.currentPosition / 1000} s")
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                Log.w(TAG, "player error", error)
                stats.text = "Error: ${error.errorCodeName}: ${error.cause?.message}"
            }
        })
        player = p
        browse.visibility = View.GONE
        playerView.visibility = View.VISIBLE
        stats.visibility = View.VISIBLE
        playerView.player = p
        playerView.requestFocus()
        p.setMediaItem(MediaItem.fromUri("tg://${f.chatId}/${f.messageId}"))
        p.prepare()
        p.play()
        tick()
    }

    private fun sample(downloaded: Long) {
        samples.addLast(SystemClock.elapsedRealtime() to downloaded)
        while (samples.size > 2 && samples.first().first < samples.last().first - WINDOW_MS) samples.removeFirst()
    }

    /** Download speed over the last [WINDOW_MS], from TDLib's own byte count. */
    private fun speed(): Double {
        if (samples.size < 2) return 0.0
        val (t0, b0) = samples.first()
        val (t1, b1) = samples.last()
        return if (t1 > t0) (b1 - b0) / 1048576.0 / ((t1 - t0) / 1000.0) else 0.0
    }

    private var ticks = 0

    private fun tick() {
        val p = player ?: return
        val ram = android.os.Debug.getPss() / 1024
        val disk = samples.lastOrNull()?.second?.shr(20) ?: 0
        val ff = if (firstFrameMs < 0) "…" else "%.1f s".format(firstFrameMs / 1000.0)
        stats.text = "first frame $ff · %.1f MB/s · %d MB on disk · buffered %d s · stalls %d · RAM %d MB"
            .format(speed(), disk, (p.bufferedPosition - p.currentPosition) / 1000, stalls, ram)
        if (++ticks % 5 == 0) Log.i(TAG, stats.text.toString())
        main.postDelayed(::tick, 1000)
    }

    /** Ends a run: the film's download is deleted so the next run starts cold. */
    private fun stop() {
        main.removeCallbacksAndMessages(null)
        player?.release()
        player = null
        val id = playingFile
        if (id != 0) io.execute { runCatching { Td.delete(id) } }
        playingFile = 0
    }

    @Deprecated("Back from the player returns to the list.")
    override fun onBackPressed() {
        if (player == null) return super.onBackPressed()
        stop()
        playerView.visibility = View.GONE
        stats.visibility = View.GONE
        browse.visibility = View.VISIBLE
        list.getChildAt(0)?.requestFocus()
    }

    override fun onDestroy() {
        stop()
        Td.onAuth -= onAuth
        Td.onFile = null
        io.shutdown()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "GlideTelegram"
        private const val WINDOW_MS = 10_000L
        private val VIDEO = Regex("""\.(mkv|mp4|m4v|mov|avi|webm|ts)$""", RegexOption.IGNORE_CASE)
    }
}
