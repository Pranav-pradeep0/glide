package com.glide.app.smb

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import com.hierynomus.msdtyp.AccessMask
import com.hierynomus.mserref.NtStatus
import com.hierynomus.mssmb2.SMB2CreateDisposition
import com.hierynomus.mssmb2.SMB2ShareAccess
import com.hierynomus.mssmb2.SMBApiException
import com.hierynomus.smbj.share.File
import java.io.InterruptedIOException
import java.util.EnumSet
import java.util.concurrent.ExecutionException
import java.util.concurrent.Future

/**
 * `smb://host/share/path` for media3. Reads ahead: [depth] reads of [chunk] bytes in flight at
 * once. One read at a time waits a whole round trip per chunk with the link idle in between.
 * smbj 0.15's `readAsync` is package-private, but its blocking read waits only for its own
 * reply, so each read on its own thread is one more request on the wire.
 */
@OptIn(UnstableApi::class)
class SmbDataSource(private val chunk: Int = CHUNK, private val depth: Int = DEPTH) : BaseDataSource(/* isNetwork = */ true) {
    private var uri: Uri? = null
    private var host = ""
    private var file: File? = null
    private val inFlight = ArrayDeque<Future<ByteArray>>()
    private var next = 0L
    private var end = 0L
    private var current = EMPTY
    private var currentPos = 0
    private var remaining = 0L
    private var opened = false

    override fun open(dataSpec: DataSpec): Long {
        uri = dataSpec.uri
        transferInitializing(dataSpec)
        val path = dataSpec.uri.pathSegments
        host = dataSpec.uri.host.orEmpty()
        if (host.isEmpty() || path.size < 2) throw DataSourceException(PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND)
        try {
            val f = Smb.share(host, path[0]).openFile(
                path.drop(1).joinToString("\\"), EnumSet.of(AccessMask.GENERIC_READ), null,
                SMB2ShareAccess.ALL, SMB2CreateDisposition.FILE_OPEN, null,
            )
            file = f
            val size = f.fileInformation.standardInformation.endOfFile
            if (dataSpec.position > size) throw DataSourceException(PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE)
            remaining = if (dataSpec.length != C.LENGTH_UNSET.toLong()) dataSpec.length else size - dataSpec.position
            next = dataSpec.position
            end = dataSpec.position + remaining
        } catch (e: DataSourceException) {
            throw e
        } catch (e: Exception) {
            throw failed(e)
        }
        fill()
        opened = true
        transferStarted(dataSpec)
        return remaining
    }

    private fun fill() {
        val f = file ?: return
        while (inFlight.size < depth && next < end) {
            val at = next
            val n = minOf(chunk.toLong(), end - at).toInt()
            inFlight.addLast(Smb.readers.submit<ByteArray> { readFully(f, at, n) })
            next += n
        }
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (remaining == 0L) return C.RESULT_END_OF_INPUT
        if (currentPos == current.size) {
            val head = inFlight.removeFirstOrNull() ?: return C.RESULT_END_OF_INPUT
            current = try {
                head.get()
            } catch (e: ExecutionException) {
                throw failed(e.cause ?: e)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                throw InterruptedIOException()
            }
            currentPos = 0
            fill()
            if (current.isEmpty()) return C.RESULT_END_OF_INPUT
        }
        val n = minOf(length.toLong(), (current.size - currentPos).toLong(), remaining).toInt()
        System.arraycopy(current, currentPos, buffer, offset, n)
        currentPos += n
        remaining -= n
        bytesTransferred(n)
        return n
    }

    override fun getUri(): Uri? = uri

    override fun close() {
        uri = null
        inFlight.forEach { it.cancel(true) }
        inFlight.clear()
        current = EMPTY
        currentPos = 0
        file?.let { runCatching { it.close() } }
        file = null
        if (opened) {
            opened = false
            transferEnded()
        }
    }

    /** Missing and refused files are final; anything else drops the session so media3's retry reconnects. */
    private fun failed(e: Throwable): DataSourceException {
        val status = (e as? SMBApiException)?.status
        val reason = when (status) {
            NtStatus.STATUS_OBJECT_NAME_NOT_FOUND, NtStatus.STATUS_OBJECT_PATH_NOT_FOUND, NtStatus.STATUS_BAD_NETWORK_NAME ->
                PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND
            NtStatus.STATUS_ACCESS_DENIED, NtStatus.STATUS_LOGON_FAILURE -> PlaybackException.ERROR_CODE_IO_NO_PERMISSION
            else -> {
                Smb.drop(host)
                PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED
            }
        }
        return DataSourceException(e, reason)
    }

    companion object {
        /** Tuned by the speed test (docs/network-shares.md). The server's max read size still caps a chunk. */
        const val CHUNK = 1 shl 20
        const val DEPTH = 8
        private val EMPTY = ByteArray(0)

        /** [n] bytes at [at], or fewer at the end of the file. A server may answer a read short. */
        private fun readFully(f: File, at: Long, n: Int): ByteArray {
            val buf = ByteArray(n)
            var got = 0
            while (got < n) {
                val r = f.read(buf, at + got, got, n - got)
                if (r <= 0) return buf.copyOf(got)
                got += r
            }
            return buf
        }
    }
}

/** `smb://` to [SmbDataSource], everything else to [upstream]. */
@OptIn(UnstableApi::class)
class SmbAwareDataSource(private val upstream: DataSource) : DataSource {
    private val smb = SmbDataSource()
    private var active: DataSource? = null

    override fun addTransferListener(transferListener: TransferListener) {
        upstream.addTransferListener(transferListener)
        smb.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
        val source = if (dataSpec.uri.scheme == "smb") smb else upstream
        active = source
        return source.open(dataSpec)
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int = active!!.read(buffer, offset, length)

    override fun getUri(): Uri? = active?.uri

    override fun getResponseHeaders(): Map<String, List<String>> = active?.responseHeaders ?: emptyMap()

    override fun close() {
        active?.close()
        active = null
    }

    class Factory(private val upstream: DataSource.Factory) : DataSource.Factory {
        override fun createDataSource(): DataSource = SmbAwareDataSource(upstream.createDataSource())
    }
}
