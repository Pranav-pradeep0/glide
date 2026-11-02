package com.glide.app.telegram

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.InterruptedIOException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit

private const val MB = 1L shl 20
private const val SIZE = 2000 * MB

/** TDLib as the window sees it: ranges on disk, a download offset, updates on demand. */
private class FakeTd : TgWindow.Tdlib {
    val window = TgWindow(SIZE, this)
    val ranges = mutableListOf<LongRange>()
    val requests = mutableListOf<Pair<Long, Long>>()

    @Synchronized
    override fun prefixAt(pos: Long): Long = ranges.firstOrNull { pos in it }?.let { it.last + 1 - pos } ?: 0

    override fun download(offset: Long, limit: Long) {
        synchronized(this) { requests += offset to limit }
        update(offset)
    }

    /** Bytes [from, to) land on disk; TDLib reports its download at [offset]. */
    fun arrive(from: Long, to: Long, offset: Long = from) {
        synchronized(this) { ranges += from until to }
        update(offset)
    }

    fun update(offset: Long, active: Boolean = true) =
        window.onUpdate(Progress("/tdlib/film.mkv", offset, prefixAt(offset), active, false))

    fun requested(): List<Long> = synchronized(this) { requests.map { it.first } }

    fun limits(): List<Long> = synchronized(this) { requests.map { it.second } }
}

class TgWindowTest {
    private val pool = Executors.newCachedThreadPool()

    private fun FakeTd.awaitAsync(pos: Long): Future<Long> = pool.submit<Long> { window.await(pos) }

    /** Until the window has asked for [n] downloads (it does so from its own thread). */
    private fun FakeTd.untilRequests(n: Int) {
        val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (requested().size < n) {
            check(System.nanoTime() < end) { "only ${requested()} requested" }
            Thread.sleep(5)
        }
    }

    @Test
    fun readsWhatIsOnDiskAndAsksForOneWindowAhead() {
        val td = FakeTd()
        td.arrive(0, 10 * MB)
        assertEquals(5 * MB, td.window.await(5 * MB))
        assertEquals(listOf(5 * MB), td.requested())
        // size / 64: 2000 MB → 31.25 MB.
        assertEquals(listOf(SIZE / 64), td.limits())
    }

    @Test
    fun smallFilesGetTheMinimumWindow() {
        assertEquals(TgWindow.MIN_SPAN, TgWindow(100 * MB, FakeTd()).span)
    }

    @Test
    fun extendsBeforeReadsStarve() {
        val td = FakeTd()
        val span = td.window.span
        td.arrive(0, span)
        td.window.await(0)
        // Short of half a window from its end: nothing new.
        td.window.await(span / 2)
        assertEquals(listOf(0L), td.requested())
        // Within half a window: extended while bytes are still on disk ahead (await didn't block).
        assertEquals(span / 2 - 1, td.window.await(span / 2 + 1))
        assertEquals(listOf(0L, span / 2 + 1), td.requested())
    }

    @Test
    fun seekReAnchorsTheWindow() {
        val td = FakeTd()
        td.arrive(0, 10 * MB)
        td.window.await(0)
        val ahead = td.awaitAsync(1000 * MB)
        td.untilRequests(2)
        td.arrive(1000 * MB, 1001 * MB)
        ahead.get(5, TimeUnit.SECONDS)
        // Back into the watched part: on disk, read at once, and the window moves there too.
        assertEquals(5 * MB, td.window.await(5 * MB))
        assertEquals(listOf(0L, 1000 * MB, 5 * MB), td.requested())
    }

    @Test
    fun holesComeFromTdlibsNumbersNotTheFileLength() {
        val td = FakeTd()
        td.arrive(0, 10 * MB)
        td.arrive(1000 * MB, 1001 * MB)
        // Past a hole: readable only to the end of that range.
        assertEquals(MB / 2, td.window.await(1000 * MB + MB / 2))
        // In the hole: the download moves there and the read waits for it.
        val read = td.awaitAsync(20 * MB)
        td.untilRequests(2)
        assertEquals(20 * MB, td.requested().last())
        td.arrive(20 * MB, 21 * MB)
        assertEquals(MB, read.get(5, TimeUnit.SECONDS))
    }

    @Test
    fun waitsForARunningDownloadThatIsAboutToGetThere() {
        val td = FakeTd()
        td.arrive(0, 10 * MB)
        td.window.await(0)
        val read = td.awaitAsync(10 * MB + 100_000)
        Thread.sleep(50)
        td.arrive(10 * MB, 11 * MB, offset = 0)
        assertEquals(MB - 100_000, read.get(5, TimeUnit.SECONDS))
        assertEquals(listOf(0L), td.requested())
    }

    @Test
    fun seekFarAheadMovesTheDownload() {
        val td = FakeTd()
        td.arrive(0, 10 * MB)
        val read = td.awaitAsync(1500 * MB)
        td.untilRequests(1)
        td.arrive(1500 * MB, 1502 * MB)
        assertEquals(2 * MB, read.get(5, TimeUnit.SECONDS))
        assertEquals(listOf(1500 * MB), td.requested())
    }

    @Test
    fun downloadMovedElsewhereIsMovedBack() {
        val td = FakeTd()
        val read = td.awaitAsync(10 * MB)
        td.untilRequests(1)
        // Another reader of the same file (a thumbnail) took the download to 500 MB.
        td.update(500 * MB)
        td.untilRequests(2)
        assertEquals(listOf(10 * MB, 10 * MB), td.requested())
        td.arrive(10 * MB, 12 * MB)
        assertEquals(2 * MB, read.get(5, TimeUnit.SECONDS))
    }

    @Test
    fun staleUpdateFromTheOldOffsetDoesNotLoseTheRead() {
        val td = FakeTd()
        td.arrive(0, 10 * MB)
        val read = td.awaitAsync(1000 * MB)
        td.untilRequests(1)
        // An update about the old download, sent before TDLib took the new offset.
        td.update(0)
        td.arrive(1000 * MB, 1001 * MB)
        assertEquals(MB, read.get(5, TimeUnit.SECONDS))
        // At worst the same offset again (a no-op for TDLib), never somewhere else.
        assertTrue(td.requested().all { it == 1000 * MB })
    }

    @Test
    fun stoppedDownloadIsRestarted() {
        val td = FakeTd()
        val read = td.awaitAsync(0)
        td.untilRequests(1)
        td.update(0, active = false)
        td.untilRequests(2)
        td.arrive(0, MB)
        assertEquals(MB, read.get(5, TimeUnit.SECONDS))
    }

    @Test
    fun endOfFile() {
        val td = FakeTd()
        td.arrive(0, SIZE)
        assertEquals(0L, td.window.await(SIZE))
        td.window.await(SIZE - 10 * MB)
        td.window.await(SIZE - 5 * MB)
        assertEquals(10L, td.window.await(SIZE - 10))
        // One request, cut at the end of the file, not repeated as reading nears it.
        assertEquals(listOf(SIZE - 10 * MB), td.requested())
        assertEquals(listOf(10 * MB), td.limits())
    }

    @Test
    fun cancelledLoadStopsWaiting() {
        val td = FakeTd()
        val read = td.awaitAsync(0)
        td.untilRequests(1)
        read.cancel(true)
        // The interrupt wakes the wait; nothing is left blocked.
        pool.shutdown()
        assertTrue(pool.awaitTermination(5, TimeUnit.SECONDS))
    }

    @Test
    fun interruptedReadThrowsInterruptedIo() {
        val td = FakeTd()
        Thread.currentThread().interrupt()
        try {
            td.window.await(0)
            throw AssertionError("expected InterruptedIOException")
        } catch (_: InterruptedIOException) {
        } finally {
            Thread.interrupted()
        }
    }
}
