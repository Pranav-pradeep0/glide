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
    // 28 Mantra
    // 38 Snoring
    // 52 Stomach rumble
    // 67 Animal
    // 70 Bark
    // 71 Yip
    // 73 Bow-wow
    // 74 Growling
    // 82 Horse
    // 83 Clip-clop
    // 90 Goat
    // 102 Honk
    // 104 Roaring cats (lions, tigers)
    // 113 Caw
    // 119 Mouse
    // 128 Croak
    // 132 Music
    // 137 Bass guitar
    // 156 Percussion
    // 168 Wood block
    // 169 Tambourine
    // 179 Orchestra
    // 210 Scratching (performance technique)
    // 215 Heavy metal
    // 222 Soul music
    // 232 Classical music
    // 236 Techno
    // 241 Ambient music
    // 245 Flamenco
    // 253 Christian music
    // 262 Background music
    // 263 Theme music
    // 271 Happy music
    // 273 Tender music
    // 279 Wind noise (microphone)
    // 281 Thunder
    // 288 Ocean
    // 294 Vehicle
    // 303 Toot
    // 304 Car alarm
    // 307 Tire squeal
    // 309 Race car, auto racing
    // 319 Fire engine, fire truck (siren)
    // 325 Train horn
    // 331 Jet engine
    // 341 Chainsaw
    // 345 Engine starting
    // 354 Tap
    // 362 Microwave oven
    // 381 Writing
    // 397 Steam whistle
    // 415 Sawing
    // 420 Explosion
    // 436 Chink, clink
    // 438 Liquid
    // 459 Basketball bounce
    // 462 Whack, thwack
    // 473 Crumpling, crinkling
    // 475 Beep, bleep
    // 487 Rumble
    // 501 Inside, large room or hall
    // 503 Outside, urban or manmade
    // 506 Echo
    // 516 Throbbing
    // 517 Vibration
    val KEPT = intArrayOf(0, 2, 28, 38, 52, 67, 70, 71, 73, 74, 82, 83, 90, 102, 104, 113, 119, 128, 132, 137, 156, 168, 169, 179, 210, 215, 222, 232, 236, 241, 245, 253, 262, 263, 271, 273, 279, 281, 288, 294, 303, 304, 307, 309, 319, 325, 331, 341, 345, 354, 362, 381, 397, 415, 420, 436, 438, 459, 462, 473, 475, 487, 501, 503, 506, 516, 517)
    val WEIGHTS = floatArrayOf(-0.0000f, -0.1464f, -0.0028f, 0.1335f, 0.0641f, 0.0751f, 0.0108f, 0.0060f, 0.0704f, 0.0390f, 0.0908f, 0.0002f, -0.0321f, 0.0611f, 0.1263f, 0.0506f, -0.0161f, 0.3951f, -0.0011f, 0.3854f, 0.0164f, 0.0230f, 0.0049f, -0.0344f, 0.0592f, 0.0828f, -0.0585f, -0.0749f, 0.0684f, -0.1259f, 0.0317f, -0.2246f, -0.0505f, -0.0833f, -0.0731f, -0.1017f, 0.0334f, 0.0321f, 0.0838f, 0.1513f, 0.1187f, -0.2643f, 0.0284f, 0.0039f, 0.0895f, 0.0100f, -0.0792f, 0.1383f, -0.0000f, 0.1296f, -0.1634f, -0.0337f, 0.0798f, -0.0394f, 0.1968f, 0.2278f, -0.0957f, -0.0581f, 0.2058f, 0.0386f, -0.1119f, -0.0032f, 0.1049f, 0.0137f, -0.1188f, 0.0459f, -0.1989f, 0.1519f, 0.0000f, 0.4899f, 0.0558f, -0.0000f, 5.5139f)
    // </model>
}
