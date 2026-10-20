package com.glide.app.haptic

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.SystemClock
import android.util.Log
import com.glide.app.player.SubtitleSyncModule
import java.io.DataInputStream
import java.nio.ByteBuffer
import kotlin.concurrent.thread

/**
 * Runs the [HapticListener] and [HapticRecognizer] over a film's whole audio in the background
 * (decision L2) and hands [publish] the track as it grows, about once a second, so haptics start
 * once analysis passes the playhead. A jump past the analysis starts a new piece at the [playhead],
 * and the gaps are filled after. A finished track is cached per file; a cached one is handed over at once.
 *
 * The thread runs at the lowest priority, and FFmpeg's decode thread, created from it, inherits
 * that (L2 measured it at normal priority, competing with the player).
 *
 * Logs `listen` lines with Log.w for `scripts/haptics-lab.js listen`.
 */
class HapticAnalysis private constructor(context: Context, private val uri: String, @Volatile private var publish: (HapticTrack) -> Unit) {
    @Volatile
    private var cancelled = false

    @Volatile
    private var finished = false
    private val context = context.applicationContext

    init {
        thread(name = "haptics-listen", priority = Thread.MIN_PRIORITY) {
            try {
                run()
            } finally {
                finished = true
            }
        }
    }

    /** The player closed: stop handing it tracks, but finish, so the track is cached for next time. */
    fun detach() {
        publish = {}
    }

    /**
     * The player's position while it plays. Landing where nothing is analysed, more than [JUMP_MS]
     * past the piece being analysed, stops that piece and starts one here (any thread).
     */
    fun playhead(ms: Int) {
        playheadMs = ms
    }

    @Volatile
    private var playheadMs = 0

    /** One stretch of the film, analysed from [fromMs] until [untilMs] (the next piece) or the end. */
    private class Piece(val fromMs: Int, var untilMs: Int, val recognizer: HapticRecognizer?) {
        val listener = HapticListener()
        val doneMs get() = minOf(untilMs, listener.analysedMs.coerceAtLeast(fromMs))
    }

    private val pieces = ArrayList<Piece>() // by fromMs; analysis thread only
    private var endMs = Int.MAX_VALUE // the film's end, once a piece reaches it

    private fun covered(ms: Int) = pieces.any { ms >= it.fromMs && ms < it.doneMs }

    /** Where the next piece starts: under the playhead, the first gap after it, the first gap, or none. */
    private fun nextFrom(): Int? {
        val at = playheadMs
        val gaps = ArrayList<IntRange>() // [from, until)
        var t = 0
        for (p in pieces) {
            if (p.fromMs > t) gaps += t until p.fromMs
            t = maxOf(t, p.untilMs)
        }
        if (t < endMs) gaps += t until endMs
        return gaps.firstOrNull { at in it }?.let { at }
            ?: gaps.firstOrNull { it.first > at }?.first
            ?: gaps.firstOrNull()?.first
    }

    /** All pieces as one track: each lane from its own piece, nothing in the gaps. */
    private fun snapshot(fp: HapticTrack.Fingerprint): HapticTrack {
        val frames = (pieces.maxOfOrNull { it.doneMs } ?: 0) / HapticTrack.BED_FRAME_MS
        val bed = FloatArray(frames)
        val body = FloatArray(frames)
        val events = ArrayList<HapticTrack.Event>()
        val sounds = ArrayList<FloatArray>()
        for (p in pieces) {
            val t = p.listener.track(fp)
            val a = p.fromMs / HapticTrack.BED_FRAME_MS
            val b = minOf(p.doneMs / HapticTrack.BED_FRAME_MS, t.bedIntensity.size)
            if (a < b) {
                t.bedIntensity.copyInto(bed, a, a, b)
                t.body.copyInto(body, a, a, b)
            }
            events += t.events.filter { it.timeMs >= p.fromMs && it.timeMs < p.doneMs }
            // Windows reaching into the piece: the one before stopped at its edge, short of them.
            val w = p.recognizer?.windows ?: continue
            for (k in maxOf(0, p.fromMs - HapticSounds.WINDOW_MS + HapticSounds.HOP_MS) / HapticSounds.HOP_MS until w.size) {
                if (k * HapticSounds.HOP_MS >= p.untilMs) break
                while (sounds.size <= k) sounds += FloatArray(HapticSounds.KEPT.size)
                sounds[k] = w[k]
            }
        }
        events.sortBy { it.timeMs }
        return HapticTrack(HapticListener.VERSION, fp, bed, FloatArray(frames), events, body).withSounds(sounds)
    }

    private fun run() {
        val fp = HapticPerformer.fingerprint(context, uri)
        val file = HapticPerformer.cacheFile(context, fp)
        val cached = runCatching { DataInputStream(file.inputStream().buffered()).use { HapticTrack.read(it) } }.getOrNull()
        // Version 0 is a track the Lab imported from a fixture's truth: kept as it is.
        if (cached != null && cached.analyzerVersion in setOf(0, HapticListener.VERSION)) {
            Log.w(TAG, "listen cached events=${cached.events.size} ${file.name}")
            publish(cached)
            return
        }
        val opened = HapticRecognizer.open(context)
        if (opened == null) Log.w(TAG, "listen recognizer unavailable")
        val classify = opened?.first
        val t0 = SystemClock.elapsedRealtime()
        var shown = t0
        var failed: Throwable? = null
        while (!cancelled) {
            val from = nextFrom() ?: break
            val p = Piece(from, pieces.firstOrNull { it.fromMs > from }?.fromMs ?: endMs, classify?.let { HapticRecognizer(it) })
            pieces += p
            pieces.sortBy { it.fromMs }
            Log.w(TAG, "listen piece from=$from until=${p.untilMs}")
            val sink = object : SubtitleSyncModule.PcmSink {
                var jumped = false
                override val done get() = cancelled || jumped || p.listener.analysedMs >= p.untilMs

                override fun add(ptsUs: Long, data: ByteBuffer, channels: Int, rate: Int, isFloat: Boolean) {
                    p.listener.add(ptsUs, data, channels, rate, isFloat)
                    p.recognizer?.add(ptsUs, data, channels, rate, isFloat)
                    val at = playheadMs
                    if (!covered(at) && (at < p.fromMs || at > p.doneMs + JUMP_MS)) jumped = true
                    val now = SystemClock.elapsedRealtime()
                    if (now - shown >= PUBLISH_MS || jumped) {
                        shown = now
                        publish(snapshot(fp))
                        Log.w(TAG, "listen progress analysed=${p.listener.analysedMs} wall=${System.currentTimeMillis()}")
                    }
                }
            }
            val error = runCatching { SubtitleSyncModule.decodeAudio(context, uri, sink, (from - PREROLL_MS).coerceAtLeast(0) * 1000L) }.exceptionOrNull()
            if (cancelled) break
            if (sink.jumped || p.listener.analysedMs >= p.untilMs) {
                p.untilMs = p.doneMs
                if (p.untilMs <= p.fromMs) pieces.remove(p)
                continue
            }
            // The end of the film. An extractor error in the last 1% is junk after it (L2, Blast).
            p.listener.finish()
            endMs = maxOf(p.doneMs, p.fromMs + 1)
            p.untilMs = endMs
            if (error != null && p.doneMs < 0.99 * durationMs()) failed = error
            if (failed != null) break
        }
        opened?.second?.close()
        if (cancelled) {
            Log.w(TAG, "listen cancelled analysed=${pieces.sumOf { it.doneMs - it.fromMs }}")
            return
        }
        val track = snapshot(fp)
        publish(track)
        val complete = failed == null && pieces.isNotEmpty() && nextFrom() == null
        if (complete) HapticPerformer.saveTrack(context, track)
        Log.w(TAG, "listen done analysed=${track.bedIntensity.size * HapticTrack.BED_FRAME_MS} took=${SystemClock.elapsedRealtime() - t0} " +
            "events=${track.events.size} windows=${track.sounds.size} classify=${pieces.sumOf { it.recognizer?.classifyMs ?: 0 }} pieces=${pieces.size} cached=$complete error=${failed?.message?.replace(' ', '_')} wall=${System.currentTimeMillis()}")
        // Hit times for the script to score against a fixture's truth.
        track.events.filter { it.sources and HapticTrack.LIGHT == 0 }.chunked(200).forEach { c -> Log.w(TAG, "listen events " + c.joinToString(",") { "${it.timeMs}" }) }
    }

    private fun durationMs(): Long {
        val r = MediaMetadataRetriever()
        return try {
            r.setDataSource(context, Uri.parse(uri))
            r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLong()
        } catch (e: Exception) {
            null
        } finally {
            r.release()
        } ?: Long.MAX_VALUE
    }

    companion object {
        private const val TAG = "GlideHaptics"
        private const val PUBLISH_MS = 1000L
        private const val JUMP_MS = 30_000 // about a second of analysis at ~30x: closer, it catches up
        // A piece decodes from this much earlier: the Listener's 1.5 s of context, a sound window.
        private const val PREROLL_MS = 1500
        private var current: HapticAnalysis? = null

        /**
         * One analysis at a time. Reopening the file being analysed picks it up (the next snapshot
         * comes within [PUBLISH_MS]); another file replaces it.
         */
        @Synchronized
        fun start(context: Context, uri: String, publish: (HapticTrack) -> Unit): HapticAnalysis {
            current?.takeIf { it.uri == uri && !it.finished }?.let {
                it.publish = publish
                return it
            }
            current?.cancelled = true
            return HapticAnalysis(context, uri, publish).also { current = it }
        }
    }
}
