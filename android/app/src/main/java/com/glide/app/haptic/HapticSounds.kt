package com.glide.app.haptic

import kotlin.math.exp

/**
 * What a sound is (docs/haptics-decisions.md, Moments): YAMNet's scores for 521 AudioSet sounds, one
 * 0.975 s window every 0.48 s, and a small learned "moment" score over them: how likely a viewer
 * would point at this window (an impact, an explosion, a roar, an engine), as SDH subtitles mark
 * them. Logistic regression over the [KEPT] classes' scores and the Listener's view of the same
 * window ([HapticDirector.listened]), trained on the PC by `HapticMomentTrain` on the tuning films.
 *
 * The track's sounds lane holds the [KEPT] scores, so a retrain on the same classes rebuilds
 * nothing; a retrain that changes [KEPT] must bump [HapticListener.VERSION].
 */
object HapticSounds {
    const val CLASSES = 521
    const val HOP_MS = 480
    const val WINDOW_MS = 975

    /** The Listener's features per window, after the [KEPT] scores: see [HapticDirector.listened]. */
    const val LISTENED = 5

    /** YAMNet's Speech class, always [KEPT]: the Director finds the opening by it. */
    const val SPEECH = 0

    /** The [KEPT] scores out of all 521. */
    fun features(scores: FloatArray): FloatArray = FloatArray(KEPT.size) { scores[KEPT[it]] }

    /** The moment score 0..1 of one window: its [features] and [LISTENED] Listener features. */
    fun moment(sounds: FloatArray, listened: FloatArray): Float {
        var z = WEIGHTS.last()
        for (j in KEPT.indices) z += WEIGHTS[j] * logit(sounds[j])
        for (j in 0 until LISTENED) z += WEIGHTS[KEPT.size + j] * listened[j]
        return (1 / (1 + exp(-z.toDouble()))).toFloat()
    }

    /**
     * A score as YAMNet's own logit, where evidence adds: 0.01 and 0.1 differ as much as 0.5 and
     * 0.9. Clamped to half a step of the lane's 8 bits.
     */
    fun logit(s: Float): Float = (s.coerceIn(0.5f / 255, 1 - 0.5f / 255)).let { Math.log(it / (1.0 - it)).toFloat() }

    // <model> written by HapticMomentTrain from frankenstein, together, us (lambda 0.005); don't edit by hand.
    // 0 Speech
    // 82 Horse
    // 83 Clip-clop
    // 102 Honk
    // 113 Caw
    // 128 Croak
    // 137 Bass guitar
    // 168 Wood block
    // 253 Christian music
    // 263 Theme music
    // 273 Tender music
    // 279 Wind noise (microphone)
    // 281 Thunder
    // 294 Vehicle
    // 348 Door
    // 354 Tap
    // 420 Explosion
    // 435 Glass
    // 454 Thump, thud
    // 462 Whack, thwack
    // 463 Smash, crash
    // 501 Inside, large room or hall
    val KEPT = intArrayOf(0, 82, 83, 102, 113, 128, 137, 168, 253, 263, 273, 279, 281, 294, 348, 354, 420, 435, 454, 462, 463, 501)
    val WEIGHTS = floatArrayOf(-0.0000f, 0.0301f, 0.0360f, 0.0392f, 0.1261f, 0.3952f, 0.3106f, 0.0909f, -0.0616f, -0.0233f, -0.0075f, 0.1926f, 0.0352f, 0.0251f, 0.1271f, 0.0583f, 0.2543f, 0.1121f, 0.0322f, 0.0460f, 0.0529f, 0.0010f, 0.0000f, 0.0000f, 0.5485f, 0.0440f, -0.0000f, 8.5483f)
    // </model>
}
