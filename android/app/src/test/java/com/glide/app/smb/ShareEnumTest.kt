package com.glide.app.smb

import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** A NetrShareEnum level-1 reply laid out as NDR puts it: a disk share, IPC$ and an admin share. */
class ShareEnumTest {

    private fun ByteBuffer.string(s: String) {
        val n = s.length + 1
        putInt(n); putInt(0); putInt(n)
        (s + '\u0000').forEach { putChar(it) }
        position((position() + 3) and 3.inv())
    }

    @Test
    fun keepsDiskSharesOnly() {
        val shares = listOf(Triple("Movies", 0, ""), Triple("IPC$", 0x80000003.toInt(), "Remote IPC"), Triple("C$", 0x80000000.toInt(), "Default share"))
        val b = ByteBuffer.allocate(512).order(ByteOrder.LITTLE_ENDIAN)
        b.putInt(1); b.putInt(1); b.putInt(0x20000) // level, tag, container
        b.putInt(shares.size); b.putInt(0x20004); b.putInt(shares.size) // count, buffer, conformance
        shares.forEach { (_, type, _) -> b.putInt(0x20008); b.putInt(type); b.putInt(0x2000c) }
        shares.forEach { (name, _, remark) -> b.string(name); b.string(remark) }
        b.putInt(shares.size); b.putInt(0); b.putInt(0) // total, resume handle, status
        assertEquals(listOf("Movies"), ShareEnum.parse(b.array().copyOf(b.position())))
    }
}
