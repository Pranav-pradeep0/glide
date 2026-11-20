package com.glide.app.audio

import org.junit.Assert.assertEquals
import org.junit.Test

class ShuffleOrderTest {
    @Test
    fun currentSongPlaysFirstAndEverySongPlays() {
        repeat(20) {
            val order = currentFirstShuffle(10, 7)
            assertEquals(7, order[0])
            assertEquals((0 until 10).toList(), order.sorted())
        }
        assertEquals(listOf(0), currentFirstShuffle(1, 0).toList())
    }
}
