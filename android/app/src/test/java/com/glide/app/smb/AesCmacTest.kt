package com.glide.app.smb

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * SMB3 signs every packet with this; a wrong tag is a server that drops the connection. The
 * RFC 4493 vectors, fed whole and in awkward pieces, since smbj streams a packet in parts.
 */
class AesCmacTest {

    private fun hex(s: String) = s.replace(" ", "").chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }

    private val key = hex("2b7e1516 28aed2a6 abf71588 09cf4f3c")
    private val msg = hex(
        "6bc1bee2 2e409f96 e93d7e11 7393172a ae2d8a57 1e03ac9c 9eb76fac 45af8e51" +
            "30c81c46 a35ce411 e5fbc119 1a0a52ef f69f2445 df4f9b17 ad2b417b e66c3710"
    )
    private val vectors = mapOf(
        0 to "bb1d6929e95937287fa37d129b756746",
        16 to "070a16b46b4d4144f79bdd9dd04a287c",
        40 to "dfa66747de9ae63030ca32611497c827",
        64 to "51f0bebf7e3b9d92fc49741779363cfe",
    )

    @Test
    fun `RFC 4493 vectors, in one piece`() {
        val mac = AesCmac().apply { init(key) }
        for ((len, tag) in vectors) {
            mac.update(msg, 0, len)
            assertEquals("len $len", tag, mac.doFinal().hex())
        }
    }

    @Test
    fun `RFC 4493 vectors, in pieces of every size`() {
        val mac = AesCmac().apply { init(key) }
        for ((len, tag) in vectors) for (piece in 1..17) {
            var o = 0
            while (o < len) {
                val n = minOf(piece, len - o)
                if (n == 1) mac.update(msg[o]) else mac.update(msg, o, n)
                o += n
            }
            assertEquals("len $len piece $piece", tag, mac.doFinal().hex())
        }
    }
}
