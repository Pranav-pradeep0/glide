package com.glide.app.haptic

import com.glide.app.player.SubtitleAligner
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Puts an SDH subtitle on the film's own dialogue before its captions direct haptics
 * (docs/haptics-decisions.md, Events): a subtitle from another release can sit seconds off, and a
 * caption then names the wrong sound. The app's subtitle sync ([SubtitleAligner]) on YAMNet's
 * Speech score from the haptic track itself, accepted as the player's own speech fit is: a plain
 * delay it is sure of, both halves of the window agreeing. Anything less applies nothing.
 */
internal object HapticCaptions {
    private const val WINDOW_S = 300.0
    private val NEED = (WINDOW_S * 1000 / HapticSounds.HOP_MS).toInt() // sound windows in one fit
    private val BRACKETS = Regex("""\[[^\]]*]|\([^)]*\)|<[^>]*>|\{[^}]*\}|♪|♫""")

    /** A fit's delay in ms (positive: the cues come later), null if unsure, and the sound window a later try starts from. */
    class Fit(val delayMs: Int?, val nextWindow: Int)

    /** Fits [cues]' lines to [raw]'s speech on the first fully analysed [WINDOW_S] at or after sound window [fromWindow]; null until that much is analysed. */
    fun fit(cues: List<HapticMeaning.Cue>, raw: HapticTrack, fromWindow: Int): Fit? {
        val sounds = raw.sounds
        var k0 = fromWindow
        var run = 0
        var k = fromWindow
        while (k < sounds.size && run < NEED) {
            if (sounds[k].any { it > 0f }) run++ else { run = 0; k0 = k + 1 }
            k++
        }
        if (run < NEED) return null // not enough analysed yet
        val lines = cues.filter { it.text.replace(BRACKETS, "").isNotBlank() }
        val speechAt = HapticSounds.KEPT.indexOf(HapticSounds.SPEECH)
        val speech = FloatArray(sounds.size) { sounds[it][speechAt] }
        val startS = k0 * HapticSounds.HOP_MS / 1000.0
        val levels = SubtitleAligner.scoreFrames(speech, startS, (WINDOW_S / SubtitleAligner.FRAME_S).toInt())
        val starts = DoubleArray(lines.size) { lines[it].startMs / 1000.0 }
        val ends = DoubleArray(lines.size) { lines[it].endMs / 1000.0 }
        val r = SubtitleAligner.align(levels, startS, starts, ends, clampDb = false)
        val sure = r != null && r.confident && r.ratio == 1.0 && SubtitleAligner.halvesConfirm(levels, startS, starts, ends, r, clampDb = false)
        val d = if (sure) (r!!.delayS * 1000).roundToInt() else return Fit(null, k0 + NEED)
        return Fit(if (abs(d) < MIN_SHIFT_MS) 0 else d, k0 + NEED)
    }

    /**
     * The fit reads films already in sync 0.1-0.3 s early (YAMNet's ~1 s windows smear speech) and
     * finds any shift to within that; a caption's window ([HapticDirector.SNAP_MS]) absorbs it, so
     * a smaller fit moves nothing.
     */
    private const val MIN_SHIFT_MS = 500

    fun shifted(cues: List<HapticMeaning.Cue>, delayMs: Int) = cues.map { it.copy(startMs = it.startMs + delayMs, endMs = it.endMs + delayMs) }
}
