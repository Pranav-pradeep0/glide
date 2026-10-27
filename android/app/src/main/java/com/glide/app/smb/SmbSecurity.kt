package com.glide.app.smb

import com.hierynomus.security.Mac
import com.hierynomus.security.jce.JceSecurityProvider
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlin.experimental.xor

/**
 * smbj's crypto on the platform provider. smbj's own default is BouncyCastle, whose AES is
 * pure Java: it signs every SMB3 packet without the CPU's AES instructions, which capped a
 * Cortex-A55 box at ~2 MB/s. JceSecurityProvider already covers HMAC-SHA256 (SMB2 signing), the
 * key derivation, AES-GCM and MD4 (its own Java MD4 where the platform has none). Only AES-CMAC,
 * SMB3's signature, has no platform provider on older Android, so it is built here on AES/CBC.
 */
object SmbSecurity : JceSecurityProvider() {
    override fun getMac(name: String): Mac =
        if (name.equals("AesCmac", ignoreCase = true)) AesCmac() else super.getMac(name)
}

/**
 * AES-CMAC (RFC 4493): the last block of AES-CBC under a zero IV, with the final block masked
 * by a subkey. Streams: whole blocks go to the cipher as they arrive, and the last block,
 * partial or not, is held back for [doFinal].
 */
class AesCmac : Mac {
    private val cbc = Cipher.getInstance("AES/CBC/NoPadding")
    private lateinit var key: SecretKeySpec
    private val k1 = ByteArray(16)
    private val k2 = ByteArray(16)
    private val last = ByteArray(16)
    private var lastLen = 0
    private var scratch = ByteArray(0)

    override fun init(key: ByteArray) {
        this.key = SecretKeySpec(key, "AES")
        reset()
        val l = cbc.doFinal(ByteArray(16))
        subkey(l, k1)
        subkey(k1, k2)
        reset()
    }

    /** One bit left, and the RFC's 0x87 into the last byte when the top bit fell off. */
    private fun subkey(src: ByteArray, dst: ByteArray) {
        for (i in 0 until 16) {
            val next = if (i < 15) (src[i + 1].toInt() and 0xff) ushr 7 else 0
            dst[i] = ((src[i].toInt() shl 1) or next).toByte()
        }
        if (src[0].toInt() and 0x80 != 0) dst[15] = dst[15] xor 0x87.toByte()
    }

    override fun update(b: Byte) = update(byteArrayOf(b), 0, 1)

    override fun update(b: ByteArray) = update(b, 0, b.size)

    override fun update(b: ByteArray, off: Int, len: Int) {
        if (lastLen + len <= 16) {
            System.arraycopy(b, off, last, lastLen, len)
            lastLen += len
            return
        }
        var o = off
        var n = len
        // More is coming, so the held block is not the last one.
        val fill = 16 - lastLen
        System.arraycopy(b, o, last, lastLen, fill)
        o += fill
        n -= fill
        encrypt(last, 0, 16)
        val keep = if (n % 16 == 0) 16 else n % 16
        if (n > keep) encrypt(b, o, n - keep)
        System.arraycopy(b, o + n - keep, last, 0, keep)
        lastLen = keep
    }

    private fun encrypt(b: ByteArray, off: Int, len: Int) {
        if (scratch.size < len) scratch = ByteArray(len)
        cbc.update(b, off, len, scratch, 0)
    }

    override fun doFinal(): ByteArray {
        val block = last.copyOf()
        val mask = if (lastLen == 16) k1 else k2.also {
            block[lastLen] = 0x80.toByte()
            block.fill(0, lastLen + 1, 16)
        }
        for (i in 0 until 16) block[i] = block[i] xor mask[i]
        val tag = cbc.doFinal(block)
        reset()
        return tag
    }

    override fun reset() {
        cbc.init(Cipher.ENCRYPT_MODE, key, IvParameterSpec(ByteArray(16)))
        lastLen = 0
    }
}
