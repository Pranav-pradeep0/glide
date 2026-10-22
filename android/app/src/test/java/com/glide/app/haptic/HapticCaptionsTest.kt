package com.glide.app.haptic

import java.io.File
import kotlin.math.abs
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/** [HapticCaptions] puts a shifted subtitle back on the film's speech, and leaves a synced one be. */
class HapticCaptionsTest {
    @Test
    fun shiftedCaptionsComeBack() {
        val dir = File(HapticHarness.fixturesDir(), "films")
        val films = listOf("frankenstein", "us").filter { File(dir, "$it.mka").isFile && File(dir, "$it.sounds").isFile }
        assumeTrue("no films in .haptics-fixtures/films", films.isNotEmpty())
        for (name in films) {
            val ft = HapticFilmTest()
            val raw = ft.load(File(dir, "$name.mka")).raw.withSounds(ft.sounds(File(dir, "$name.sounds")).map(HapticSounds::features))
            val cues = HapticFilmTest.cues(File(dir, "$name.srt").readText())
            for (shift in listOf(0, 2000, -1500, 8000)) {
                // The first window sure of itself, as the Performer tries them.
                var from = 0
                var delay: Int? = null
                while (delay == null) {
                    val fit = HapticCaptions.fit(HapticCaptions.shifted(cues, shift), raw, from) ?: break
                    delay = fit.delayMs
                    from = fit.nextWindow
                }
                println("$name shifted $shift ms: fitted ${delay ?: "unsure"} (window from ${from - 625})")
                // In sync stays put; a shift comes back to within the fit's 0.1-0.3 s.
                assertTrue("$name $shift: $delay", delay != null && if (shift == 0) delay == 0 else abs(delay + shift) <= 400)
            }
        }
    }
}
