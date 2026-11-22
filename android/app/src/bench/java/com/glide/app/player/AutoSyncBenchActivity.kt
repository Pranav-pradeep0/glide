package com.glide.app.player

import android.app.Activity
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import com.facebook.react.bridge.BridgeReactContext
import java.io.File
import kotlin.concurrent.thread

/**
 * Auto-sync timing on every film in a folder, no UI (the bench build only, optimised like release):
 * `adb shell am start -n com.glide.player/com.glide.app.player.AutoSyncBenchActivity [--es dir /sdcard/Movies]`.
 * Each film's first text subtitle picks the clips the way SubtitleAutoSync.ts does; every
 * [CONFIGS] entry then runs [SubtitleSyncModule.align] and logs one line (tag AutoSyncBench).
 */
@OptIn(UnstableApi::class)
class AutoSyncBenchActivity : Activity() {

    private data class Config(val name: String, val pool: Int, val earlyZ: Double, val keepCache: Boolean = false)

    private val CONFIGS = listOf(
        Config("old: 4 at a time, all 8", 4, Double.MAX_VALUE),
        Config("new", 8, 13.0),
        Config("new, run again", 8, 13.0, keepCache = true),
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dir = File(intent.getStringExtra("dir") ?: "/sdcard/Download/1DMP/Videos")
        val module = SubtitleSyncModule(BridgeReactContext(applicationContext))
        thread(name = "AutoSyncBench") {
            val films = dir.walk().filter { it.isFile && it.extension.lowercase() in setOf("mkv", "mp4", "webm") }.sorted().toList()
            log("start dir=$dir films=${films.size}")
            for (film in films) try {
                bench(module, film)
            } catch (t: Throwable) {
                log("film=${film.name} error=$t")
            }
            log("done")
            runOnUiThread { finish() }
        }
    }

    private fun bench(module: SubtitleSyncModule, film: File) {
        val uri = Uri.fromFile(film)
        val track = EmbeddedSubtitles.listTracks(this, uri).firstOrNull { !it.isBitmap }
            ?: return log("film=${film.name} skipped=no text subtitle")
        val srt = EmbeddedSubtitles.extractSrt(this, uri, track.ordinal) ?: return log("film=${film.name} skipped=empty subtitle")
        val speech = parseSrt(srt).filter(::isSpeechCue)
        val clips = chooseClips(speech)
        if (clips.isEmpty()) return log("film=${film.name} skipped=too few cues")
        val s = DoubleArray(speech.size) { speech[it].first }
        val e = DoubleArray(speech.size) { speech[it].second }
        val position = (speech.last().second / 2)
        for (c in CONFIGS) {
            if (!c.keepCache) File(cacheDir, "autosync").deleteRecursively() // decode from scratch
            val t0 = SystemClock.elapsedRealtime()
            val result = try {
                module.align(film.path, clips, CLIP_S, s, e, null, position, c.pool, earlyZ = c.earlyZ)?.toString()
            } catch (_: SubtitleSyncModule.NoAudio) { "no-audio" }
            log("film=${film.name} config=${c.name} ms=${SystemClock.elapsedRealtime() - t0} result=$result")
        }
    }

    private fun log(message: String) { Log.w("AutoSyncBench", message) }

    // --- SubtitleAutoSync.ts, ported -----------------------------------------------------------

    private fun parseSrt(srt: String): List<Triple<Double, Double, String>> {
        val time = Regex("""(\d+):(\d+):(\d+),(\d+) --> (\d+):(\d+):(\d+),(\d+)""")
        return srt.split("\n\n").mapNotNull { block ->
            val lines = block.trim().lines()
            val m = lines.getOrNull(1)?.let(time::find) ?: return@mapNotNull null
            val g = m.groupValues.drop(1).map { it.toDouble() }
            Triple(g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000, g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000, lines.drop(2).joinToString("\n"))
        }
    }

    private fun isSpeechCue(cue: Triple<Double, Double, String>): Boolean {
        val (start, end, text) = cue
        if (end - start > 12 || end <= start) return false
        if (Regex("[♪♫♬♩]").containsMatchIn(text)) return false
        val spoken = text
            .replace(Regex("<[^>]*>|\\{[^}]*\\}"), "")
            .replace(Regex("\\[[^\\]]*\\]|\\([^)]*\\)|［[^］]*］|（[^）]*）|【[^】]*】|〔[^〕]*〕"), "")
            .replace(Regex("[\\s\\d.,!?'\"…:;\\-–—¡¿«»“”‘’„。、，！？：；「」『』・〜～‥،؛؟।॥]"), "")
        return spoken.length >= (if (Regex("[぀-ヿ㐀-䶿一-鿿豈-﫿]").containsMatchIn(spoken)) 1 else 2)
    }

    private fun chooseClips(speech: List<Triple<Double, Double, String>>): List<Double> {
        val cues = speech.sortedBy { it.first }
        val span = cues.maxOfOrNull { it.second } ?: 0.0
        val clips = ArrayList<Double>()
        for (part in 0 until 8) {
            val from = maxOf(span * part / 8, clips.lastOrNull()?.plus(CLIP_S) ?: 0.0)
            val to = maxOf(from, span * (part + 1) / 8 - CLIP_S)
            var best = -1.0
            var bestCount = 0
            var t = from
            while (t <= to) {
                val count = cues.count { it.first >= t && it.second <= t + CLIP_S }
                if (count > bestCount) { best = t; bestCount = count }
                t += 5
            }
            if (bestCount >= 5) clips += best
        }
        return if (clips.size >= 2) clips else emptyList()
    }

    private companion object {
        const val CLIP_S = 60.0
    }
}
