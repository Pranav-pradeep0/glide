package com.glide.app.telegram

import java.io.InterruptedIOException

/** What TDLib last said about a file's download (`updateFile`, or `downloadFile`'s answer). */
data class Progress(val path: String, val offset: Long, val prefix: Long, val active: Boolean, val complete: Boolean)

/**
 * The download side of [TelegramDataSource], free of TDLib types so a unit test can drive it.
 * How much is readable comes only from TDLib's numbers, never the file's length on disk: a
 * partial file has holes (tdlib/td#3262).
 */
class TgWindow(private val size: Long, private val td: Tdlib, private val slack: Long = SLACK) {
    interface Tdlib {
        /** Bytes on disk from [pos] on (`getFileDownloadedPrefixSize`). */
        fun prefixAt(pos: Long): Long

        /** `downloadFile(offset = [offset])`. Its answer reaches [onUpdate] before this returns. */
        fun download(offset: Long)
    }

    private val lock = Object()
    private var last: Progress? = null
    private var seq = 0

    /** Called on TDLib's thread, in order, for this file's `updateFile` and `downloadFile` answers. */
    fun onUpdate(p: Progress) = synchronized(lock) {
        last = p
        seq++
        lock.notifyAll()
    }

    val path: String get() = synchronized(lock) { last?.path.orEmpty() }

    /**
     * Bytes readable on disk at [pos], blocking until TDLib has at least one; 0 at the end.
     * If no running download will reach [pos] soon, moves the download there (the latest
     * `downloadFile` wins, so a seek needs no debounce).
     */
    fun await(pos: Long): Long {
        if (pos >= size) return 0
        while (true) {
            val seen = synchronized(lock) { seq }
            val n = td.prefixAt(pos)
            if (n > 0) return minOf(n, size - pos)
            if (!coming(pos)) td.download(pos)
            try {
                synchronized(lock) { if (seq == seen) lock.wait(POLL_MS) }
            } catch (e: InterruptedException) {
                // media3's Loader interrupts a cancelled load (seek, release).
                Thread.currentThread().interrupt()
                throw InterruptedIOException()
            }
        }
    }

    /** A running download started at or before [pos] and has got, or nearly got, there. */
    private fun coming(pos: Long): Boolean = synchronized(lock) {
        val p = last ?: return false
        p.active && pos >= p.offset && pos <= p.offset + p.prefix + slack
    }

    companion object {
        /** A seek this close ahead of the download is cheaper to wait for than to restart. */
        const val SLACK = 1L shl 20
        // ponytail: no give-up timeout; TDLib reconnects itself. Add one if step (d)'s network-cut case needs it.
        private const val POLL_MS = 1000L
    }
}
