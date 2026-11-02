package com.glide.app.telegram

import android.net.Uri
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.DataSpec
import java.io.RandomAccessFile

/**
 * `tg://chatId/messageId` for media3: reads the file TDLib is downloading, waiting at the edge
 * of what's on disk ([TgWindow]). Reads go through a small buffer: Matroska reads its index a
 * byte or two at a time.
 */
@OptIn(UnstableApi::class)
class TelegramDataSource : BaseDataSource(/* isNetwork = */ true) {
    private var uri: Uri? = null
    private var window: TgWindow? = null
    /** A saved film's file, read directly; else the [window]'s. */
    private var path: String? = null
    private var size = 0L
    private var file: RandomAccessFile? = null
    private var pos = 0L
    private var remaining = 0L
    private val buf = ByteArray(BUFFER)
    private var bufStart = 0L
    private var bufLen = 0
    private var opened = false

    override fun open(dataSpec: DataSpec): Long {
        uri = dataSpec.uri
        transferInitializing(dataSpec)
        val chatId = dataSpec.uri.host?.toLongOrNull()
        val messageId = dataSpec.uri.pathSegments.firstOrNull()?.toLongOrNull()
        if (chatId == null || messageId == null || !Td.available) throw DataSourceException(PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND)
        // Saved for offline: the file, no network.
        val saved = TgSaves.file(chatId, messageId)
        val (w, size) = if (saved != null) null to saved.length() else try {
            Td.open(chatId, messageId)
        } catch (e: Td.TdException) {
            throw DataSourceException(e, if (e.code in 400..499) PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND else PlaybackException.ERROR_CODE_IO_UNSPECIFIED)
        }
        if (dataSpec.position > size) throw DataSourceException(PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE)
        Log.d("GlideTelegram", "open $chatId/$messageId @ ${dataSpec.position}${if (saved != null) " (saved)" else ""}")
        window = w
        path = saved?.path
        this.size = size
        pos = dataSpec.position
        remaining = if (dataSpec.length != C.LENGTH_UNSET.toLong()) dataSpec.length else size - pos
        bufLen = 0
        opened = true
        transferStarted(dataSpec)
        return remaining
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (remaining == 0L) return C.RESULT_END_OF_INPUT
        if (pos < bufStart || pos >= bufStart + bufLen) fill()
        if (bufLen == 0) return C.RESULT_END_OF_INPUT
        val n = minOf(length.toLong(), bufStart + bufLen - pos, remaining).toInt()
        System.arraycopy(buf, (pos - bufStart).toInt(), buffer, offset, n)
        pos += n
        remaining -= n
        bytesTransferred(n)
        return n
    }

    private fun fill() {
        val w = window
        val n = minOf(w?.await(pos) ?: (size - pos), BUFFER.toLong()).toInt()
        bufStart = pos
        bufLen = 0
        if (n <= 0) return
        val f = file ?: RandomAccessFile(path ?: w!!.path, "r").also { file = it }
        f.seek(pos)
        f.readFully(buf, 0, n)
        bufLen = n
    }

    override fun getUri(): Uri? = uri

    /** Nothing destructive: TDLib keeps downloading, and keeps what it has. */
    override fun close() {
        uri = null
        window = null
        path = null
        file?.let { runCatching { it.close() } }
        file = null
        bufLen = 0
        if (opened) {
            opened = false
            transferEnded()
        }
    }

    companion object {
        const val BUFFER = 64 shl 10
    }
}
