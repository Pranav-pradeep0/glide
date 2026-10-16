package com.glide.app.player

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

class CreditsDetectorTest {
    private val w = 320
    private val h = 180
    private val film = ByteArray(w * h) { i -> (60 + (i * 7919) % 120).toByte() }
    private val black = ByteArray(w * h) { 4 }
    private val text = ByteArray(w * h) { i -> if ((i / w) % 12 == 6 && (i % w) in 100..220 && i % 3 == 0) 230.toByte() else 4 }

    /** 20 minutes of film, then each (seconds, frame) section in turn, as [CreditsDetector.find] sees it. */
    private fun video(vararg sections: Pair<Int, ByteArray>): Pair<Long, (Long) -> CreditsDetector.Frame?> {
        var at = FILM_MS
        val ends = sections.map { (s, f) -> at += s * 1000L; at to f }
        return at to { t -> CreditsDetector.judge(if (t < FILM_MS) film else ends.first { t < it.first }.second, w, h) }
    }

    @Test
    fun frames() {
        assertEquals(CreditsDetector.Frame.BLACK, CreditsDetector.judge(black, w, h))
        assertEquals(CreditsDetector.Frame.TEXT, CreditsDetector.judge(text, w, h))
        assertEquals(CreditsDetector.Frame.FILM, CreditsDetector.judge(film, w, h))
    }

    @Test
    fun runs() {
        val step = CreditsDetector.STEP_MS
        // Credits to the end, with a bumper inside them and logos after.
        video(120 to text, 15 to film, 60 to black, 20 to film).let { (d, f) ->
            val start = CreditsDetector.find(d, f)!!
            assertTrue("$start", start in FILM_MS..FILM_MS + step)
        }
        // A dark last scene that cuts to black and back, then the credits: they start at the text.
        video(10 to black, 15 to film, 10 to black, 15 to film, 90 to text).let { (d, f) ->
            val start = CreditsDetector.find(d, f)!!
            assertTrue("$start", start in FILM_MS + 50_000..FILM_MS + 50_000 + step)
        }
        // A dark scene, then two more minutes of film: no credits.
        video(60 to black, 120 to film).let { (d, f) -> assertNull(CreditsDetector.find(d, f)) }
        // Too short to be credits.
        video(20 to text).let { (d, f) -> assertNull(CreditsDetector.find(d, f)) }
    }

    @Test
    fun chapters() {
        val d = 7_000_000L
        assertEquals(6_500_000L, CreditsDetector.fromChapters(listOf("Chapter 9" to 6_000_000L, "End Credits" to 6_500_000L), d))
        assertEquals(6_400_000L, CreditsDetector.fromChapters(listOf("ED" to 6_400_000L), d))
        // An "Ending" chapter in the first half is a story chapter.
        assertNull(CreditsDetector.fromChapters(listOf("The Ending" to 1_000_000L, "Credited" to 6_500_000L), d))
    }

    /**
     * Real films from scripts/credits-fixtures.js, sampled as the phone does (the keyframe at
     * or before each time). Where the file has a credits chapter, an answer must be no more
     * than a minute late, and early only by main-on-end titles (Frankenstein's start 130 s
     * before its chapter). No answer is a miss, not a failure: Up next keeps to the end (Anora's
     * credits text dissolves at 320 px; its chapter covers it). Skipped without fixtures.
     */
    @Test
    fun films() {
        val dir = File(System.getProperty("credits.fixtures") ?: "../../.credits-fixtures")
        val films = dir.listFiles { f -> f.name.endsWith(".tsv") }.orEmpty().sortedBy { it.name }
        assumeTrue("no films in $dir", films.isNotEmpty())
        val fails = films.mapNotNull { tsv ->
            val lines = tsv.readLines().map { it.split(' ') }
            val (fw, fh) = lines.first { it[0] == "size" }.drop(1).map { it.toInt() }
            val duration = lines.first { it[0] == "duration" }[1].toLong()
            val truth = lines.firstOrNull { it[0] == "truth" }?.get(1)?.toLong()
            val gray = File(tsv.path.removeSuffix(".tsv") + ".gray").readBytes()
            val keyframes = lines.filter { it[0] == "frame" }.mapIndexed { i, l ->
                l[1].toLong() to CreditsDetector.judge(gray.copyOfRange(i * fw * fh, (i + 1) * fw * fh), fw, fh)
            }.sortedBy { it.first }
            val start = CreditsDetector.find(duration) { t -> keyframes.lastOrNull { it.first <= t }?.second }
            println("${tsv.name}: start=${start?.div(1000)} truth=${truth?.div(1000)} duration=${duration / 1000}")
            if (truth != null && start != null && (start > truth + 60_000 || start < truth - 180_000)) "${tsv.name}: $start vs $truth" else null
        }
        assertTrue(fails.joinToString("\n"), fails.isEmpty())
    }

    private companion object {
        const val FILM_MS = 20 * 60_000L
    }
}
