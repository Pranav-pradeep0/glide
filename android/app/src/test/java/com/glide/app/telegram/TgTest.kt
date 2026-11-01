package com.glide.app.telegram

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TgTest {
    private fun ids(rows: List<Pair<Long, String>>) = rows.map { it.first }

    @Test
    fun pageStopsAtTheSearchThatStoppedHighest() {
        // Videos stopped at 50, documents at 30: videos below 50 aren.t fetched yet.
        val rows = listOf(90L to "v", 70L to "d", 50L to "v", 40L to "d", 35L to "d", 30L to "d")
        val (page, next) = Tg.page(rows, listOf(50L, 30L), 0L)
        assertEquals(listOf(90L, 70L, 50L), ids(page))
        assertEquals(50L, next)
    }

    @Test
    fun nextPageSkipsWhatTheLastOneShowed() {
        val rows = listOf(50L to "v", 40L to "d", 20L to "v")
        val (page, next) = Tg.page(rows, listOf(0L, 0L), 50L)
        assertEquals(listOf(40L, 20L), ids(page))
        assertEquals(0L, next)
    }

    @Test
    fun bothSearchesDoneReturnsEverything() {
        val (page, next) = Tg.page(listOf(3L to "a", 9L to "b", 9L to "b"), listOf(0L, 0L), 0L)
        assertEquals(listOf(9L, 3L), ids(page))
        assertEquals(0L, next)
    }

    @Test
    fun videoDocuments() {
        assertTrue(Tg.isVideo("application/octet-stream", "Film.2019.MKV"))
        assertTrue(Tg.isVideo("video/mp4", ""))
        assertFalse(Tg.isVideo("application/pdf", "notes.pdf"))
    }

    @Test
    fun reasons() {
        assertEquals("Too many tries. Try again in 2 minutes", Tg.reason(429, "Too Many Requests: retry after 61"))
        assertEquals("Too many tries. Try again in 1 minute", Tg.reason(429, "Too Many Requests: retry after 5"))
        assertEquals("Too many tries. Try again in 3 hours", Tg.reason(429, "Too Many Requests: retry after 9000"))
        assertEquals("Wrong code", Tg.reason(400, "PHONE_CODE_INVALID"))
        assertEquals("Wrong password", Tg.reason(400, "PASSWORD_HASH_INVALID"))
        assertEquals("something else", Tg.reason(500, "something else"))
    }
}
