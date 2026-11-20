package com.glide.app.smb

import org.junit.Assert.assertArrayEquals
import org.junit.Test
import java.io.IOException

class SmbReadFullyTest {

    /** A file of [size] bytes whose server answers at most 3 bytes per read. */
    private fun server(size: Int) = { buf: ByteArray, at: Long, off: Int, len: Int ->
        val n = minOf(len, 3, (size - at).toInt())
        for (i in 0 until n) buf[off + i] = (at + i).toByte()
        if (n <= 0) -1 else n
    }

    @Test
    fun joinsShortReads() {
        assertArrayEquals(ByteArray(8) { (4 + it).toByte() }, SmbDataSource.readFully(4, 8, server(20)))
    }

    @Test(expected = IOException::class)
    fun failsWhenTheFileEndsEarly() {
        SmbDataSource.readFully(4, 8, server(10))
    }
}
