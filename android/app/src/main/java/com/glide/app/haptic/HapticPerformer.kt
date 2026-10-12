package com.glide.app.haptic

import android.content.Context
import android.media.AudioAttributes
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.security.MessageDigest
import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * Plays a [HapticTrack] in step with the player. ExoPlayer lives on the main looper, so the
 * player view samples its clock there and hands it over through [sync]; everything else runs on
 * one high-priority thread that issues each [HapticRenderer.Call] early by the motor's latency.
 *
 * The clock is the player's own position, the one video is lip-synced to, so Bluetooth and other
 * output latency is already in it. Audio delay is not: the position reads ahead by it.
 *
 * Every call and anchor is logged with Log.w (release builds strip Log.i) for
 * `scripts/haptics-lab.js perform`.
 */
class HapticPerformer(private val context: Context) {
    private val vibrator = context.getSystemService(Vibrator::class.java)
    private val media = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build()
    private val thread = HandlerThread("haptics", Process.THREAD_PRIORITY_URGENT_AUDIO).apply { start() }
    private val handler = Handler(thread.looper)

    // Haptics thread only.
    private var track: HapticTrack? = null
    private var cal = HapticCalibration.DEFAULT
    private var playing = false
    private var anchorMs = 0L // heard media time at anchorUptime
    private var anchorUptime = 0L
    private var rate = 1f
    private var pending: HapticRenderer.Call? = null
    private var buzzing = false

    /**
     * After a start, resume or jump the position creeps for ~0.5 s before it runs true (measured:
     * a first hit 229 ms early), first in 250 ms steps that two samples can agree on by chance.
     * Nothing is scheduled until [SETTLE_RUN] anchors in a row agree.
     */
    private var settled = false
    private var agreeing = 0

    /** Loads the cached track for [uri], or plays nothing if there is none. */
    fun open(uri: String) = handler.post {
        stop("open")
        cal = loadCalibration(context)
        val file = cacheFile(context, fingerprint(context, uri))
        track = runCatching { DataInputStream(file.inputStream().buffered()).use { HapticTrack.read(it) } }
            .onFailure { if (file.exists()) Log.w(TAG, "unreadable track ${file.name}: ${it.message}") }
            .getOrNull()
        Log.w(TAG, "open track=${track != null} events=${track?.events?.size} latency=${cal.latencyMs} ${file.name}")
        replan()
    }

    /**
     * The player's state, sampled on the main thread. [hard] for anything that breaks the
     * running call (play/pause, seek, rate, delay): the motor stops and a new call starts at the
     * playhead. Otherwise the anchor only moves the next call.
     */
    fun sync(isPlaying: Boolean, positionMs: Long, speed: Float, delayMs: Int, hard: Boolean) {
        val uptime = SystemClock.uptimeMillis()
        val wall = System.currentTimeMillis()
        handler.post {
            val heard = positionMs - delayMs
            val changed = hard || isPlaying != playing || speed != rate
            val err = heardAt(uptime) - heard
            // A settled clock only drifts; each sample jitters by a few ms. Small differences
            // nudge the anchor a quarter of the way instead of replacing it.
            val nudge = !changed && settled && abs(err) <= SETTLE_MS
            if (playing && !changed) {
                Log.w(TAG, "anchor err=$err pos=$heard wall=$wall")
                agreeing = if (abs(err) <= SETTLE_MS) agreeing + 1 else 0
                if (agreeing >= SETTLE_RUN) settled = true
            }
            if (changed) Log.w(TAG, "sync playing=$isPlaying pos=$heard rate=$speed wall=$wall")
            playing = isPlaying
            anchorMs = if (nudge) heard + err * 3 / 4 else heard
            anchorUptime = uptime
            rate = speed
            if (changed) {
                settled = false
                agreeing = 0
                stop(if (isPlaying) "jump" else "pause")
            }
            replan()
        }
    }

    fun close() = handler.post { stop("close"); track = null }

    fun release() {
        close()
        thread.quitSafely()
    }

    private fun heardAt(uptime: Long) = anchorMs + ((uptime - anchorUptime) * rate).roundToLong()

    private fun uptimeOf(mediaMs: Int) = anchorUptime + ((mediaMs - anchorMs) / rate).roundToLong()

    private fun stop(why: String) {
        handler.removeCallbacksAndMessages(FIRE)
        pending = null
        if (buzzing) {
            vibrator.cancel()
            buzzing = false
            Log.w(TAG, "cancel $why wall=${System.currentTimeMillis()}")
        }
    }

    /** Schedules the next call after what is playing, or from the playhead. */
    private fun replan(from: Int? = null) {
        handler.removeCallbacksAndMessages(FIRE)
        val t = track ?: return
        if (!playing || !settled) return
        val now = SystemClock.uptimeMillis()
        // A call issued now is felt latencyMs later, at this media time.
        val earliest = (heardAt(now + cal.latencyMs)).toInt()
        val call = pending?.takeIf { from == null } ?: HapticRenderer.next(t, maxOf(from ?: earliest, earliest), cal) ?: return
        pending = call
        handler.postAtTime({ fire(call) }, FIRE, uptimeOf(call.startMs) - cal.latencyMs)
    }

    private fun fire(call: HapticRenderer.Call) {
        val target = uptimeOf(call.startMs) - cal.latencyMs
        val actual = SystemClock.uptimeMillis()
        val timings = LongArray(call.stepsMs.size) { (call.stepsMs[it] / rate).roundToLong().coerceAtLeast(1) }
        vibrator.vibrate(VibrationEffect.createWaveform(timings, call.amplitudes, -1), media)
        buzzing = true
        Log.w(TAG, "call late=${actual - target} wall=${System.currentTimeMillis()} rate=$rate $call")
        pending = null
        replan(call.endMs)
    }

    companion object {
        private const val TAG = "GlideHaptics"
        private val FIRE = Any() // token of scheduled calls, so clearing them keeps queued syncs
        private const val SETTLE_MS = 20
        private const val SETTLE_RUN = 3
        private const val PREFS = "haptics"
        private const val KEY_CALIBRATION = "calibration"

        fun loadCalibration(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_CALIBRATION, null)?.let { HapticCalibration.decode(it) } ?: HapticCalibration.DEFAULT

        fun saveCalibration(context: Context, cal: HapticCalibration) =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_CALIBRATION, cal.encode()).apply()

        /** Path, size and mtime of the media; content URIs have no mtime. */
        fun fingerprint(context: Context, uri: String): HapticTrack.Fingerprint {
            val u = Uri.parse(uri)
            if (u.scheme.isNullOrEmpty() || u.scheme == "file") {
                val f = File(u.path ?: uri)
                return HapticTrack.Fingerprint(f.absolutePath, f.length(), f.lastModified())
            }
            val size = runCatching { context.contentResolver.openFileDescriptor(u, "r")?.use { it.statSize } }.getOrNull() ?: -1
            return HapticTrack.Fingerprint(uri, size, 0)
        }

        fun cacheFile(context: Context, fp: HapticTrack.Fingerprint): File {
            val key = MessageDigest.getInstance("SHA-1").digest("${fp.path}|${fp.size}|${fp.mtimeMs}".toByteArray())
                .joinToString("") { "%02x".format(it) }
            return File(File(context.filesDir, "haptics"), "$key.ght")
        }

        fun saveTrack(context: Context, track: HapticTrack) {
            val file = cacheFile(context, track.fingerprint)
            file.parentFile?.mkdirs()
            DataOutputStream(file.outputStream().buffered()).use { track.write(it) }
        }
    }
}
