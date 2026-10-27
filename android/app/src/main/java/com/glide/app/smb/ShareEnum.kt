package com.glide.app.smb

import com.hierynomus.msdtyp.AccessMask
import com.hierynomus.mssmb2.SMB2CreateDisposition
import com.hierynomus.mssmb2.SMB2ImpersonationLevel
import com.hierynomus.mssmb2.SMB2ShareAccess
import com.hierynomus.smbj.session.Session
import com.hierynomus.smbj.share.PipeShare
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.EnumSet

/**
 * A server's disk shares, by DCE/RPC NetrShareEnum (MS-SRVS 3.1.4.8, level 1) over the `srvsvc`
 * pipe. smbj does files only; this is the one RPC call we need, written out rather than pulling
 * smbj-rpc (built for smbj 0.12, plus Guava) for it.
 */
object ShareEnum {
    // srvsvc 3.0 over NDR 2.0.
    private val SRVSVC = guid("4b324fc8-1670-01d3-1278-5a47bf6ee188")
    private val NDR = guid("8a885d04-1ceb-11c9-9fe8-08002b104860")
    private const val BIND = 11
    private const val BIND_ACK = 12
    private const val REQUEST = 0
    private const val RESPONSE = 2
    private const val LAST_FRAG = 0x02
    private const val NET_SHARE_ENUM = 15

    fun list(session: Session): List<String> {
        val ipc = session.connectShare("IPC$") as PipeShare
        ipc.open(
            "srvsvc", SMB2ImpersonationLevel.Impersonation,
            EnumSet.of(AccessMask.MAXIMUM_ALLOWED), null, EnumSet.of(SMB2ShareAccess.FILE_SHARE_READ, SMB2ShareAccess.FILE_SHARE_WRITE),
            SMB2CreateDisposition.FILE_OPEN, null,
        ).use { pipe ->
            val ack = pipe.transact(bind())
            if (ack[2].toInt() != BIND_ACK) throw IOException("srvsvc bind refused")
            // A long list comes back in several fragments; the rest are read off the pipe.
            var pdu = pipe.transact(request())
            val stub = java.io.ByteArrayOutputStream()
            while (true) {
                if (pdu[2].toInt() != RESPONSE) throw IOException("NetrShareEnum failed: ${faultStatus(pdu)}")
                val len = le(pdu).getShort(8).toInt() and 0xffff
                stub.write(pdu, 24, len - 24)
                if (pdu[3].toInt() and LAST_FRAG != 0) break
                pdu = ByteArray(64 shl 10).let { it.copyOf(pipe.read(it)) }
            }
            return parse(stub.toByteArray())
        }
    }

    /** Disk shares from a NetrShareEnum response stub, admin (`$`) shares left out. */
    fun parse(stub: ByteArray): List<String> {
        val b = le(stub)
        b.position(12) // Level, union tag, container pointer
        val count = b.int
        if (b.int == 0) return emptyList() // null Buffer
        b.int // conformance
        val entries = List(count) { Triple(b.int, b.int, b.int) } // name ref, type, remark ref
        val out = ArrayList<String>()
        for ((nameRef, type, remarkRef) in entries) {
            val name = if (nameRef != 0) string(b) else ""
            if (remarkRef != 0) string(b)
            // STYPE_DISKTREE, not STYPE_SPECIAL (0x80000000) or temporary.
            if (type == 0 && name.isNotEmpty() && !name.endsWith("$")) out += name
        }
        return out
    }

    private fun string(b: ByteBuffer): String {
        b.int // max count
        b.int // offset
        val n = b.int
        val chars = CharArray(n) { b.char }
        b.position((b.position() + 3) and 3.inv())
        return String(chars).trimEnd('\u0000')
    }

    private fun bind(): ByteArray = pdu(BIND, 72) {
        putShort(4280); putShort(4280); putInt(0) // max xmit/recv frag, association group
        put(1); put(0); putShort(0) // one context
        putShort(0); put(1); put(0) // context 0, one transfer syntax
        put(SRVSVC); putShort(3); putShort(0)
        put(NDR); putInt(2)
    }

    private fun request(): ByteArray = pdu(REQUEST, 24 + 32) {
        putInt(32); putShort(0); putShort(NET_SHARE_ENUM.toShort()) // alloc hint, context, opnum
        putInt(0) // ServerName: null, the server itself
        putInt(1); putInt(1); putInt(0x20000) // Level 1, union tag, container pointer
        putInt(0); putInt(0) // container: no entries, null Buffer
        putInt(-1) // PreferedMaximumLength: all of them
        putInt(0) // ResumeHandle: null
    }

    private fun pdu(type: Int, length: Int, body: ByteBuffer.() -> Unit): ByteArray =
        ByteBuffer.allocate(length).order(ByteOrder.LITTLE_ENDIAN).apply {
            put(5); put(0); put(type.toByte()); put(0x03) // v5.0, first + last fragment
            putInt(0x10) // little-endian, ASCII, IEEE
            putShort(length.toShort()); putShort(0); putInt(1) // no auth, call id
            body()
        }.array()

    private fun faultStatus(pdu: ByteArray) =
        if (pdu.size >= 28) "0x%08x".format(le(pdu).getInt(24)) else "type ${pdu[2]}"

    private fun le(a: ByteArray) = ByteBuffer.wrap(a).order(ByteOrder.LITTLE_ENDIAN)

    /** A GUID as DCE/RPC puts it on the wire: the first three fields little-endian. */
    private fun guid(s: String): ByteArray {
        val h = s.replace("-", "").chunked(2).map { it.toInt(16).toByte() }
        return (h.subList(0, 4).reversed() + h.subList(4, 6).reversed() + h.subList(6, 8).reversed() + h.subList(8, 16)).toByteArray()
    }
}
