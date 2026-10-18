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
import java.io.DataOutputStream
import java.io.File
import java.security.MessageDigest
import kotlin.math.abs
import kotlin.concurrent.thread
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
    private var playedTo = -1 // media end of the last call, until a stop
    private var analysis: HapticAnalysis? = null
    @Volatile
    private var opened = 0 // which open() a track belongs to

    // Any thread: the last raw track published, and the tags it is directed with.
    @Volatile
    private var raw: HapticTrack? = null

    @Volatile
    private var tags: List<HapticMeaning.Tag> = emptyList()

    @Volatile
    private var preset = HapticDirector.Preset.CINEMATIC

    @Volatile
    private var strength = 1f

    /**
     * After a start, resume or jump the position creeps for ~0.5 s before it runs true (measured:
     * a first hit 229 ms early), first in 250 ms steps that two samples can agree on by chance.
     * Nothing is scheduled until [SETTLE_RUN] anchors in a row agree.
     */
    private var settled = false
    private var agreeing = 0

    /** Plays [uri]'s track as [HapticAnalysis] makes it: only what is analysed, nothing before. */
    fun open(uri: String) = handler.post {
        stop("open")
        cal = loadCalibration(context)
        track = null
        raw = null
        analysis?.detach()
        val opening = ++opened
        analysis = HapticAnalysis.start(context, uri) { r ->
            raw = r
            direct(r, opening) // on the analysis thread
        }
        Log.w(TAG, "open latency=${cal.latencyMs}")
    }

    /**
     * The film's subtitle tags (Phase 5, [HapticMeaning]), at any time: a cached track is published
     * only once, so the one already here is directed again, off the haptics thread.
     */
    fun setTags(tags: List<HapticMeaning.Tag>) {
        this.tags = tags
        redirect()
    }

    /** Subtle / Cinematic / Intense (Phase 6), at any time: the track playing is directed again. */
    fun setPreset(preset: HapticDirector.Preset) {
        if (preset == this.preset) return
        this.preset = preset
        redirect()
    }

    /** The user's strength 0..1 (Phase 6), live like [setPreset]; it reaches the next call. */
    fun setStrength(strength: Float) {
        if (strength == this.strength) return
        this.strength = strength
        redirect()
    }

    private fun redirect() {
        val r = raw ?: return
        val opening = opened
        thread(name = "haptics-direct", priority = Thread.MIN_PRIORITY) { direct(r, opening) }
    }

    private fun direct(r: HapticTrack, opening: Int) {
        val t0 = SystemClock.elapsedRealtime()
        val tg = tags
        val p = preset
        val s = strength
        val t = HapticDirector.direct(r, tg, p, s)
        Log.w(TAG, "direct took=${SystemClock.elapsedRealtime() - t0} frames=${r.bedIntensity.size} events=${t.events.size}/${r.events.size} tags=${tg.size} preset=$p strength=$s")
        // A newer snapshot, tags, preset or strength may have been directed meanwhile: only the latest plays.
        handler.post { if (opening == opened && r === raw && tg === tags && p == preset && s == strength) update(t) }
    }

    /** A longer track: carries on from the call playing, or from the playhead. */
    private fun update(t: HapticTrack) {
        track = t
        if (pending == null) replan(playedTo.takeIf { it >= 0 })
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

    fun close() = handler.post {
        stop("close")
        track = null
        raw = null
        analysis?.detach()
        analysis = null
        opened++
    }

    fun release() {
        close()
        thread.quitSafely()
    }

    private fun heardAt(uptime: Long) = anchorMs + ((uptime - anchorUptime) * rate).roundToLong()

    private fun uptimeOf(mediaMs: Int) = anchorUptime + ((mediaMs - anchorMs) / rate).roundToLong()

    private fun stop(why: String) {
        handler.removeCallbacksAndMessages(FIRE)
        pending = null
        playedTo = -1
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
        playedTo = call.endMs
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
