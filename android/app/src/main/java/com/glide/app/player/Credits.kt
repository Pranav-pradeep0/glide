package com.glide.app.player

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.util.Log
import com.glide.app.haptic.HapticPerformer
import java.security.MessageDigest
import kotlin.concurrent.thread

/**
 * Where a video's end credits start, so Up next can show then rather than at the last second.
 * A chapter named for them is exact; without one, the frames are read from the end back.
 * Pure, so `CreditsDetectorTest` checks it on generated frames and `CreditsFilmTest` on films
 * (scripts/credits-fixtures.js).
 *
 * Credits are text on black. A frame counts when most of it is dark and what isn't is thin and
 * sharp: a dense roller is only ~85% dark but full of edges, small text dissolved by the
 * downscale leaves a plain black frame, and both count. A dark scene is dark too, but not for
 * long without a break; the credits are, and run to the end. So the answer is the last unbroken
 * run of such frames, if it is long enough and nothing much follows it -- from its first frame
 * with text: plain black only carries a run, or a film's dark last scene would join the credits
 * (Stranger Things 1x01).
 *
 * It may come late (designed titles over pictures before the roller, a scene inside the
 * credits: Up next waits for the roller), never early: a wrong early answer would cut off the
 * ending. Samples are labelled with the time asked for and show the keyframe at or before it,
 * which can only push the start later.
 */
object CreditsDetector {
    /** Bumped when the frame rule or the walk changes: cached answers are dropped. */
    const val VERSION = 1

    const val STEP_MS = 5_000L
    /** A break longer than this ends the credits (a studio bumper inside them is ~15 s). */
    private const val GAP_MS = 30_000L
    /** Logos or a short tag after the credits; a real post-credits scene is longer and gets no answer. */
    private const val TAIL_MS = 60_000L
    private const val MIN_RUN_MS = 30_000L
    private const val MAX_SEARCH_MS = 20 * 60_000L

    /** Shorter videos (clips, trailers) have no credits worth skipping. */
    const val MIN_DURATION_MS = 10 * 60_000L

    // Full-range luma, as a Bitmap gives it.
    private const val DARK = 40
    private const val BRIGHT = 70
    private const val EDGE = 30

    // Same words as scripts/credits-fixtures.js.
    private val CHAPTER = Regex("""\b(end ?credits|credits|ending|outro|ed)\b""", RegexOption.IGNORE_CASE)

    /** The first credits chapter in the second half; titles and start times in ms. */
    fun fromChapters(chapters: List<Pair<String, Long>>, durationMs: Long): Long? =
        chapters.filter { (title, start) -> start > durationMs / 2 && CHAPTER.containsMatchIn(title) }
            .minOfOrNull { it.second }

    enum class Frame { FILM, BLACK, TEXT }

    /** [luma]: w*h bytes, row by row. */
    fun judge(luma: ByteArray, w: Int, h: Int): Frame {
        var dark = 0
        var edges = 0
        for (y in 1 until h - 1) {
            for (x in 1 until w - 1) {
                val i = y * w + x
                val p = luma[i].toInt() and 0xff
                if (p < DARK) dark++
                if (p > BRIGHT) {
                    val around = ((luma[i - 1].toInt() and 0xff) + (luma[i + 1].toInt() and 0xff) +
                        (luma[i - w].toInt() and 0xff) + (luma[i + w].toInt() and 0xff)) / 4
                    if (p - around > EDGE) edges++
                }
            }
        }
        val n = ((w - 2) * (h - 2)).toDouble()
        val darkShare = dark / n
        val edgeShare = edges / n
        // An edge pixel stands for its stroke: 1.5% of edges is a page of text. Text starts a run
        // from 0.3%: the sparsest credits card seen is 0.34%, street lamps in a night scene 0.22%
        // (Once Upon a Time in Hollywood's last scene).
        return when {
            darkShare < 0.8 || darkShare + 10 * edgeShare < 0.95 -> Frame.FILM
            edgeShare >= 0.003 -> Frame.TEXT
            else -> Frame.BLACK
        }
    }

    /**
     * Walks back from the end in [STEP_MS] steps; [frameAt] judges the frame at a time (null:
     * none could be read, which counts as film). Stops once the run is broken, so a film costs
     * its credits' length in frames, not the window.
     */
    fun find(durationMs: Long, frameAt: (Long) -> Frame?): Long? {
        if (durationMs < MIN_DURATION_MS) return null
        val floor = durationMs - minOf(MAX_SEARCH_MS, durationMs / 3)
        var runFrom: Long? = null // earliest credits frame so far, black or text
        var start: Long? = null // earliest text frame
        var last = 0L
        var t = durationMs - 1000
        while (t >= floor) {
            val frame = frameAt(t) ?: Frame.FILM
            if (frame != Frame.FILM) {
                if (runFrom == null) last = t
                runFrom = t
                if (frame == Frame.TEXT) start = t
            } else if (runFrom == null) {
                if (durationMs - t > TAIL_MS) return null
            } else if (runFrom - t > GAP_MS) {
                break
            }
            t -= STEP_MS
        }
        return start?.takeIf { last - it >= MIN_RUN_MS }
    }
}

/**
 * Runs [CreditsDetector.find] on a file's frames in the background and caches the answer per
 * file, so a film is read once. One at a time: opening another video cancels it.
 */
class CreditsAnalysis private constructor(
    context: Context,
    private val uri: String,
    private val durationMs: Long,
    private val found: (Long) -> Unit,
) {
    @Volatile
    private var cancelled = false
    private val context = context.applicationContext

    init {
        thread(name = "credits", priority = Thread.MIN_PRIORITY) { run() }
    }

    fun cancel() {
        cancelled = true
    }

    private fun run() {
        val prefs = context.getSharedPreferences("credits", Context.MODE_PRIVATE)
        val fp = HapticPerformer.fingerprint(context, uri)
        val key = MessageDigest.getInstance("SHA-1")
            .digest("${CreditsDetector.VERSION}|${fp.path}|${fp.size}|${fp.mtimeMs}".toByteArray())
            .joinToString("") { "%02x".format(it) }
        if (prefs.contains(key)) {
            val cached = prefs.getLong(key, -1)
            Log.w(TAG, "credits cached start=$cached")
            if (cached >= 0 && !cancelled) found(cached)
            return
        }
        val t0 = SystemClock.elapsedRealtime()
        var frames = 0
        val retriever = MediaMetadataRetriever()
        val start = try {
            retriever.setDataSource(context, Uri.parse(uri))
            CreditsDetector.find(durationMs) { t ->
                if (cancelled) throw InterruptedException()
                frames++
                frame(retriever, t)?.let { (luma, w, h) -> CreditsDetector.judge(luma, w, h) }
            }
        } catch (e: InterruptedException) {
            return
        } catch (e: Exception) {
            Log.w(TAG, "credits failed: ${e.message}")
            return
        } finally {
            retriever.release()
        }
        prefs.edit().putLong(key, start ?: -1).apply()
        Log.w(TAG, "credits start=$start frames=$frames took=${SystemClock.elapsedRealtime() - t0}")
        if (start != null && !cancelled) found(start)
    }

    /** Luma of the keyframe at or before [ms], fitted into 320x180. */
    private fun frame(retriever: MediaMetadataRetriever, ms: Long): Triple<ByteArray, Int, Int>? {
        val option = MediaMetadataRetriever.OPTION_PREVIOUS_SYNC
        val bitmap = (if (Build.VERSION.SDK_INT >= 27) {
            retriever.getScaledFrameAtTime(ms * 1000, option, WIDTH, HEIGHT)
        } else {
            retriever.getFrameAtTime(ms * 1000, option)?.let { full ->
                val scale = minOf(WIDTH.toFloat() / full.width, HEIGHT.toFloat() / full.height)
                Bitmap.createScaledBitmap(full, (full.width * scale).toInt(), (full.height * scale).toInt(), true)
                    .also { if (it !== full) full.recycle() }
            }
        }) ?: return null
        val w = bitmap.width
        val h = bitmap.height
        val pixels = IntArray(w * h)
        bitmap.getPixels(pixels, 0, w, 0, 0, w, h)
        bitmap.recycle()
        val luma = ByteArray(w * h) { i ->
            val c = pixels[i]
            (((c shr 16 and 0xff) * 77 + (c shr 8 and 0xff) * 150 + (c and 0xff) * 29) shr 8).toByte()
        }
        return Triple(luma, w, h)
    }

    companion object {
        private const val TAG = "GlidePlayer"
        private const val WIDTH = 320
        private const val HEIGHT = 180
        private var current: CreditsAnalysis? = null

        @Synchronized
        fun start(context: Context, uri: String, durationMs: Long, found: (Long) -> Unit): CreditsAnalysis {
            current?.cancel()
            return CreditsAnalysis(context, uri, durationMs, found).also { current = it }
        }
    }
}
