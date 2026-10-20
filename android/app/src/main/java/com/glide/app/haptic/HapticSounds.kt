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

    // <model> written by HapticMomentTrain from behindeyes-s01e01, behindeyes-s01e06, frankenstein, hollywood, spiderman, strangerthings-s01e01, together, us (lambda 0.002); don't edit by hand.
    // 0 Speech
    // 74 Growling
    // 104 Roaring cats (lions, tigers)
    // 132 Music
    // 281 Thunder
    // 292 Fire
    // 294 Vehicle
    // 307 Tire squeal
    // 309 Race car, auto racing
    // 320 Motorcycle
    // 348 Door
    // 420 Explosion
    // 435 Glass
    // 454 Thump, thud
    // 462 Whack, thwack
    // 463 Smash, crash
    val KEPT = intArrayOf(0, 74, 104, 132, 281, 292, 294, 307, 309, 320, 348, 420, 435, 454, 462, 463)
    val WEIGHTS = floatArrayOf(-0.0627f, 0.1180f, 0.2577f, -0.0621f, 0.1635f, 0.0226f, 0.0588f, 0.2873f, 0.0437f, 0.0359f, 0.1757f, 0.1213f, 0.1670f, 0.0207f, 0.0123f, 0.0950f, 0.4222f, 0.0857f, 0.0000f, 0.0721f, 0.0000f, 6.7712f)
    // </model>
}
