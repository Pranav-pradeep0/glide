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
 * once analysis passes the playhead. A finished track is cached per file; a cached one is handed over at once.
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
        val listener = HapticListener()
        val opened = HapticRecognizer.open(context)
        if (opened == null) Log.w(TAG, "listen recognizer unavailable")
        val recognizer = opened?.first
        fun snapshot() = listener.track(fp).withSounds(recognizer?.windows?.toList().orEmpty())
        val t0 = SystemClock.elapsedRealtime()
        var shown = t0
        val sink = object : SubtitleSyncModule.PcmSink {
            override val done get() = cancelled

            override fun add(ptsUs: Long, data: ByteBuffer, channels: Int, rate: Int, isFloat: Boolean) {
                listener.add(ptsUs, data, channels, rate, isFloat)
                recognizer?.add(ptsUs, data, channels, rate, isFloat)
                val now = SystemClock.elapsedRealtime()
                if (now - shown >= PUBLISH_MS) {
                    shown = now
                    publish(snapshot())
                    Log.w(TAG, "listen progress analysed=${listener.analysedMs} wall=${System.currentTimeMillis()}")
                }
            }
        }
        val error = runCatching { SubtitleSyncModule.decodeAudio(context, uri, sink) }.exceptionOrNull()
        opened?.second?.close()
        if (cancelled) {
            Log.w(TAG, "listen cancelled analysed=${listener.analysedMs}")
            return
        }
        listener.finish()
        val track = snapshot()
        publish(track)
        // An extractor error in the last 1% is junk after the end (L2, Blast): keep the track.
        val complete = listener.analysedMs > 0 && (error == null || listener.analysedMs >= 0.99 * durationMs())
        if (complete) HapticPerformer.saveTrack(context, track)
        Log.w(TAG, "listen done analysed=${listener.analysedMs} took=${SystemClock.elapsedRealtime() - t0} " +
            "events=${track.events.size} windows=${track.sounds.size} classify=${recognizer?.classifyMs} cached=$complete error=${error?.message?.replace(' ', '_')} wall=${System.currentTimeMillis()}")
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
