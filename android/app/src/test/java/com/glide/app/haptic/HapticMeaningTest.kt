package com.glide.app.haptic

import com.glide.app.haptic.HapticMeaning.Cue
import com.glide.app.haptic.HapticMeaning.Kind
import com.glide.app.haptic.HapticMeaning.Tag
import org.junit.Assert.assertEquals
import org.junit.Test

/** Phase 5: subtitle tags as data, and what the Director does with them. */
class HapticMeaningTest {
    @Test
    fun tags() {
        val tags = HapticMeaning.tags(
            listOf(
                Cue(0, 1000, "[VICTOR] Stay back!"),
                Cue(1000, 2000, "<i>[gunshot]</i> [man screams]"),
                Cue(2000, 3000, "[thunderclap]"),
                Cue(3000, 4000, "♪ I got five on it ♪"),
                Cue(4000, 5000, "(breathing heavily)")
            )
        )
        assertEquals(
            listOf(Tag(1000, 2000, Kind.SHARP), Tag(1000, 2000, Kind.VOICE), Tag(2000, 3000, Kind.HEAVY), Tag(3000, 4000, Kind.MUSIC), Tag(4000, 5000, Kind.VOICE)),
            tags
        )
    }

    @Test
    fun directorUsesTags() {
        fun hit(ms: Int, intensity: Float, light: Boolean = false) =
            HapticTrack.Event(ms, intensity, 0.5f, 55, 75, HapticTrack.SOURCE_AUDIO or if (light) HapticTrack.LIGHT else 0)
        val frames = 1000 // 10 s
        val raw = HapticTrack(
            HapticListener.VERSION, HapticTrack.Fingerprint("", 0, 0), FloatArray(frames), FloatArray(frames),
            listOf(hit(1000, 0.9f), hit(3000, 0.4f, light = true), hit(5000, 0.4f, light = true), hit(7000, 0.9f))
        )
        val tags = listOf(Tag(2900, 3500, Kind.SHARP), Tag(6500, 8000, Kind.MUSIC))
        assertEquals(listOf(1000, 7000), HapticDirector.direct(raw).events.map { it.timeMs }) // audio only
        val e = HapticDirector.direct(raw, tags).events
        // The tagged light onset is kept, sharp and short; the untagged one isn't; music drops the hit under it.
        assertEquals(listOf(1000, 3000), e.map { it.timeMs })
        assertEquals(HapticTrack.SOURCE_AUDIO or HapticTrack.SOURCE_SUBTITLE, e[1].sources)
        assertEquals(0.8f, e[1].sharpness)
    }
}
