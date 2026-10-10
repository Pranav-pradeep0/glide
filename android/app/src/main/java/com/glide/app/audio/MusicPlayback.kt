package com.glide.app.audio

import android.content.Context
import android.media.audiofx.Equalizer
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.TrackSelectionParameters
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import org.json.JSONArray

/**
 * Everything about music playback that has to outlive JavaScript.
 *
 * The music player is process-wide and plays on through a JS reload, an OTA restart, or a
 * start from Android Auto or a Bluetooth button with no JS running at all. So the state
 * that shapes what it plays lives here with it, not in [GlideAudioPlayerModule], which is
 * recreated with every JS runtime: the equalizer, the sleep timer, skipping past a file that
 * fails, and the queue saved for playback resumption. The module only relays JS calls in
 * and events out.
 *
 * Main thread only, like the player.
 */
@UnstableApi
object MusicPlayback {

    private const val TAG = "MusicPlayback"
    private const val PREFS = "glide_music_resume"

    /** What the JS module wants to hear about while one is alive. */
    interface Listener {
        fun onSleepTimerFired()
    }

    var listener: Listener? = null

    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var appContext: Context

    private var bandLevels: FloatArray? = null
    private var equalizer: Equalizer? = null
    private var sleepTimer: Runnable? = null
    private var consecutiveErrors = 0

    /** Called once, when the process-wide player is built. */
    fun attach(context: Context, player: ExoPlayer) {
        appContext = context.applicationContext
        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) consecutiveErrors = 0 else save(player)
            }

            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) = save(player)

            override fun onTimelineChanged(timeline: Timeline, reason: Int) {
                if (reason == Player.TIMELINE_CHANGE_REASON_PLAYLIST_CHANGED) save(player)
            }

            override fun onAudioSessionIdChanged(audioSessionId: Int) {
                equalizer?.release()
                equalizer = null
                applyEffects(player)
            }

            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                // Only fires when pauseAtEndOfMediaItems was set: the end-of-track sleep timer.
                if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) {
                    player.pauseAtEndOfMediaItems = false
                    listener?.onSleepTimerFired()
                }
            }

            /** Skip a file that will not play, until every item has failed in a row. */
            override fun onPlayerError(error: PlaybackException) {
                Log.w(TAG, "audio player error: ${error.errorCodeName} (${error.errorCode}): ${error.message}")
                consecutiveErrors++
                if (consecutiveErrors < player.mediaItemCount && player.hasNextMediaItem()) {
                    player.seekToNextMediaItem()
                    player.prepare()
                    player.play()
                } else {
                    consecutiveErrors = 0
                    player.stop()
                }
            }
        })
    }

    /** The user asked for playback: earlier failures no longer count towards giving up. */
    fun resetErrors() {
        consecutiveErrors = 0
    }

    // ================= Equalizer and offload =================

    /** Null bands keeps what is set: JS sends them only with a new queue or preset. */
    fun setBands(player: ExoPlayer, bands: FloatArray?) {
        if (bands != null) bandLevels = bands
        applyEffects(player)
    }

    fun clearBands(player: ExoPlayer) {
        bandLevels = null
        applyEffects(player)
    }

    private fun applyEffects(player: ExoPlayer) {
        val sessionId = player.audioSessionId
        if (sessionId == C.AUDIO_SESSION_ID_UNSET && bandLevels != null) return
        equalizer = GlideEqualizer.apply(equalizer, bandLevels, sessionId)
        // A minutes timer counts uptime, and offload lets the CPU sleep through playback:
        // the timer would fire hours late. Keep the CPU awake while one is armed.
        setAudioOffload(player, GlideEqualizer.isFlat(bandLevels) && sleepTimer == null)
    }

    /**
     * Offload decodes on the DSP with the CPU asleep, which is the largest saving there is
     * for music in the background. It bypasses the audio session effects attach to, so it
     * is enabled exactly while the equalizer is flat and dropped the moment it is not.
     */
    private fun setAudioOffload(player: ExoPlayer, enabled: Boolean) {
        val mode = if (enabled) {
            TrackSelectionParameters.AudioOffloadPreferences.AUDIO_OFFLOAD_MODE_ENABLED
        } else {
            TrackSelectionParameters.AudioOffloadPreferences.AUDIO_OFFLOAD_MODE_DISABLED
        }
        if (player.trackSelectionParameters.audioOffloadPreferences.audioOffloadMode == mode) return
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setAudioOffloadPreferences(
                TrackSelectionParameters.AudioOffloadPreferences.Builder()
                    .setAudioOffloadMode(mode)
                    // Gapless matters more than the battery: a queue that pauses between
                    // tracks is worse than one that keeps the CPU awake.
                    .setIsGaplessSupportRequired(true)
                    .build()
            )
            .build()
    }

    // ================= Sleep timer =================

    /**
     * The timer as it stands, for JS to read rather than keep its own copy: native owns it,
     * and it outlives a JS reload. [endsAtMs] is wall-clock time, 0 when no minutes timer.
     */
    class SleepTimerState(val mode: String, val minutes: Double, val endsAtMs: Long)

    private var sleepMinutes = 0.0
    private var sleepEndsAtMs = 0L

    fun sleepTimerState(player: ExoPlayer): SleepTimerState = when {
        sleepTimer != null -> SleepTimerState("time", sleepMinutes, sleepEndsAtMs)
        player.pauseAtEndOfMediaItems -> SleepTimerState("end_of_track", 0.0, 0L)
        else -> SleepTimerState("off", 0.0, 0L)
    }

    fun setSleepTimer(player: ExoPlayer, minutes: Double, atEndOfMediaItem: Boolean) {
        cancelSleepTimer()
        player.pauseAtEndOfMediaItems = atEndOfMediaItem
        if (!atEndOfMediaItem && minutes > 0.0) {
            val delayMs = (minutes * 60 * 1000).toLong()
            val timer = Runnable {
                cancelSleepTimer()
                player.pause()
                applyEffects(player)
                listener?.onSleepTimerFired()
            }
            sleepTimer = timer
            sleepMinutes = minutes
            sleepEndsAtMs = System.currentTimeMillis() + delayMs
            mainHandler.postDelayed(timer, delayMs)
        }
        applyEffects(player)
    }

    fun clearSleepTimer(player: ExoPlayer) {
        cancelSleepTimer()
        player.pauseAtEndOfMediaItems = false
        applyEffects(player)
    }

    private fun cancelSleepTimer() {
        sleepTimer?.let { mainHandler.removeCallbacks(it) }
        sleepTimer = null
        sleepMinutes = 0.0
        sleepEndsAtMs = 0L
    }

    // ================= Playback resumption =================

    class SavedQueue(val ids: List<String>, val index: Int, val positionMs: Long) {
        /**
         * Where to start once [resolvedIds] -- the saved ids MediaStore still knows, in
         * order -- replace the saved list: the saved song and position if it survived,
         * otherwise the top.
         */
        fun startIn(resolvedIds: List<String>): Pair<Int, Long> {
            val index = resolvedIds.indexOf(ids.getOrNull(index) ?: return 0 to 0L)
            return if (index >= 0) index to positionMs else 0 to 0L
        }
    }

    /**
     * The queue, as ids, for Bluetooth play and the System UI resume card after the process
     * is gone. Saved on every track change, queue change and pause, so a kill while playing
     * resumes at the start of the current track at worst. An emptied queue is not saved:
     * resuming offers the last thing that actually played.
     */
    fun save(player: Player) {
        if (!::appContext.isInitialized || player.mediaItemCount == 0) return
        val ids = JSONArray()
        for (i in 0 until player.mediaItemCount) ids.put(player.getMediaItemAt(i).mediaId)
        appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("ids", ids.toString())
            .putInt("index", player.currentMediaItemIndex)
            .putLong("positionMs", player.currentPosition.coerceAtLeast(0))
            .apply()
    }

    fun savedQueue(context: Context): SavedQueue? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val json = prefs.getString("ids", null) ?: return null
        val ids = try {
            JSONArray(json).let { array -> List(array.length()) { array.getString(it) } }
        } catch (e: Exception) {
            return null
        }
        if (ids.isEmpty()) return null
        return SavedQueue(ids, prefs.getInt("index", 0), prefs.getLong("positionMs", 0))
    }
}
