package com.glide.app.audio

import org.junit.Assert.assertEquals
import org.junit.Test

/** Resuming after songs were deleted must never start on the wrong song or past the end. */
class MusicPlaybackTest {

    private val saved = MusicPlayback.SavedQueue(listOf("a", "b", "c"), index = 1, positionMs = 42_000)

    @Test
    fun `the saved song resumes at its position`() {
        assertEquals(1 to 42_000L, saved.startIn(listOf("a", "b", "c")))
    }

    @Test
    fun `an earlier deletion shifts the index, not the song`() {
        assertEquals(0 to 42_000L, saved.startIn(listOf("b", "c")))
    }

    @Test
    fun `a deleted current song starts from the top`() {
        assertEquals(0 to 0L, saved.startIn(listOf("a", "c")))
    }

    @Test
    fun `a corrupt saved index starts from the top`() {
        val bad = MusicPlayback.SavedQueue(listOf("a"), index = 7, positionMs = 1_000)
        assertEquals(0 to 0L, bad.startIn(listOf("a")))
    }
}
