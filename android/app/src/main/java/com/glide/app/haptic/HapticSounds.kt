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

    // <model> written by HapticMomentTrain from frankenstein, together, us (lambda 0.003); don't edit by hand.
    // 0 Speech
    // 2 Conversation
    // 3 Narration, monologue
    // 27 Chant
    // 38 Snoring
    // 52 Stomach rumble
    // 67 Animal
    // 74 Growling
    // 82 Horse
    // 83 Clip-clop
    // 90 Goat
    // 100 Quack
    // 102 Honk
    // 104 Roaring cats (lions, tigers)
    // 113 Caw
    // 117 Canidae, dogs, wolves
    // 120 Patter
    // 128 Croak
    // 137 Bass guitar
    // 168 Wood block
    // 169 Tambourine
    // 171 Maraca
    // 179 Orchestra
    // 184 Bowed string instrument
    // 210 Scratching (performance technique)
    // 215 Heavy metal
    // 222 Soul music
    // 224 Country
    // 236 Techno
    // 241 Ambient music
    // 245 Flamenco
    // 249 Vocal music
    // 253 Christian music
    // 262 Background music
    // 264 Jingle (music)
    // 279 Wind noise (microphone)
    // 281 Thunder
    // 288 Ocean
    // 294 Vehicle
    // 303 Toot
    // 304 Car alarm
    // 307 Tire squeal
    // 314 Ice cream truck, ice cream van
    // 319 Fire engine, fire truck (siren)
    // 326 Railroad car, train wagon
    // 331 Jet engine
    // 341 Chainsaw
    // 345 Engine starting
    // 354 Tap
    // 362 Microwave oven
    // 381 Writing
    // 394 Fire alarm
    // 397 Steam whistle
    // 401 Tick
    // 415 Sawing
    // 420 Explosion
    // 426 Fireworks
    // 436 Chink, clink
    // 438 Liquid
    // 442 Drip
    // 459 Basketball bounce
    // 462 Whack, thwack
    // 463 Smash, crash
    // 473 Crumpling, crinkling
    // 475 Beep, bleep
    // 487 Rumble
    // 501 Inside, large room or hall
    // 502 Inside, public space
    // 506 Echo
    // 517 Vibration
    val KEPT = intArrayOf(0, 2, 3, 27, 38, 52, 67, 74, 82, 83, 90, 100, 102, 104, 113, 117, 120, 128, 137, 168, 169, 171, 179, 184, 210, 215, 222, 224, 236, 241, 245, 249, 253, 262, 264, 279, 281, 288, 294, 303, 304, 307, 314, 319, 326, 331, 341, 345, 354, 362, 381, 394, 397, 401, 415, 420, 426, 436, 438, 442, 459, 462, 463, 473, 475, 487, 501, 502, 506, 517)
    val WEIGHTS = floatArrayOf(-0.0068f, -0.1359f, -0.0244f, -0.0203f, 0.1189f, 0.0878f, 0.0540f, 0.0338f, 0.0782f, 0.0331f, -0.0095f, 0.0733f, 0.0120f, 0.1233f, 0.0605f, 0.1046f, -0.0110f, 0.3317f, 0.1498f, 0.0378f, 0.0564f, 0.0720f, -0.0902f, -0.0413f, 0.2441f, 0.3033f, -0.2599f, -0.0501f, 0.1304f, -0.1523f, 0.1306f, -0.0765f, -0.0575f, -0.2011f, -0.0006f, 0.0157f, 0.0159f, 0.0946f, 0.1426f, 0.0751f, -0.2180f, 0.1173f, -0.0000f, 0.0514f, 0.0283f, -0.1933f, 0.0797f, -0.0180f, 0.0858f, -0.2172f, -0.0924f, -0.0322f, 0.1031f, -0.0108f, -0.0957f, 0.1877f, 0.0051f, 0.2588f, -0.0771f, -0.0288f, -0.0603f, 0.1709f, 0.0281f, 0.0017f, -0.0915f, -0.0165f, 0.1612f, 0.0605f, -0.1583f, -0.1182f, 0.1855f, 0.0000f, 0.4190f, 0.0340f, -0.0000f, 5.6720f)
    // </model>
}
