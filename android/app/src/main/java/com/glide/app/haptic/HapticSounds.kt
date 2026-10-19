package com.glide.app.haptic

import com.glide.app.haptic.HapticMeaning.Kind
import com.glide.app.haptic.HapticMeaning.Tag

/**
 * Sound recognition (docs/haptics-decisions.md): YAMNet's scores for 521 AudioSet sounds, one
 * 0.975 s window every 0.48 s, as the same tags SDH gives [HapticMeaning]. A film with no
 * subtitles, or with ♪ only while a caption is up, is understood the same way.
 */
object HapticSounds {
    const val CLASSES = 521
    const val HOP_MS = 480
    const val WINDOW_MS = 975

    /** A group of YAMNet classes (indices into yamnet_class_map.csv) read as one kind of sound. */
    enum class Group(val kind: Kind, val threshold: Float, val classes: IntArray) {
        MUSIC(Kind.MUSIC, 0.2f, intArrayOf(132)),
        SPEECH(Kind.SPEECH, 0.5f, intArrayOf(0)),
        // Vehicle, motor vehicle, car, skidding, tire squeal, car passing, race car, truck, motorcycle,
        // engine, light/medium/heavy engine, engine starting, idling, revving.
        ENGINE(Kind.ENGINE, 0.2f, intArrayOf(294, 300, 301, 306, 307, 308, 309, 310, 320, 337, 338, 342, 343, 345, 346, 347)),
        // Glass, shatter, smash, breaking. Not "chink, clink": a lab's instruments and chains, not a hit.
        GLASS(Kind.SHARP, 0.3f, intArrayOf(435, 437, 463, 464)),
        // Thunder, explosion, gunshot, machine gun, fusillade, artillery, burst, eruption, boom.
        BOOM(Kind.HEAVY, 0.3f, intArrayOf(281, 420, 421, 422, 423, 424, 428, 429, 430)),
        // Slam, knock, hammer, crack, thump, thunk, bang, slap, whack, clang, rumble, crunch.
        IMPACT(Kind.HEAVY, 0.3f, intArrayOf(352, 353, 413, 434, 454, 455, 460, 461, 462, 478, 487, 493)),
    }

    /** Each group's score in one window: the best of its classes. [scores] holds [CLASSES] values 0..1. */
    fun groups(scores: FloatArray): FloatArray = FloatArray(Group.entries.size) { g -> Group.entries[g].classes.maxOf { scores[it] } }

    /**
     * Runs of windows over a group's threshold, as tags over the time the windows heard. One window
     * under it between two over it doesn't end a run: a logo's music dips for a moment.
     */
    fun tags(groups: List<FloatArray>): List<Tag> = Group.entries.flatMap { g ->
        fun over(k: Int) = k in groups.indices && groups[k][g.ordinal] > g.threshold
        val out = mutableListOf<Tag>()
        var from = -1
        for (k in 0..groups.size) {
            val on = over(k) || (from >= 0 && over(k + 1))
            if (on && from < 0) from = k
            if (!on && from >= 0) {
                out += Tag(from * HOP_MS, (k - 1) * HOP_MS + WINDOW_MS, g.kind, exact = true)
                from = -1
            }
        }
        out
    }
}
