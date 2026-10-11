package com.reactnativesimplethumbnail

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.Process
import android.provider.MediaStore
import com.facebook.react.bridge.*
import java.io.File
import java.io.FileOutputStream
import java.net.URLDecoder
import java.util.concurrent.Executors

class SimpleThumbnailModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "SimpleThumbnail"
    }

    @ReactMethod
    fun generate(options: ReadableMap, promise: Promise) {
        val source = options.getString("source")
        val dest = options.getString("dest")
        val time = if (options.hasKey("time")) options.getInt("time") else 0
        val askedWidth = if (options.hasKey("width")) options.getInt("width").coerceAtLeast(0) else 0
        val askedHeight = if (options.hasKey("height")) options.getInt("height").coerceAtLeast(0) else 0
        // One side alone bounds a square box. Scaling used to need both, and
        // ThumbnailService passes only a width, so every thumbnail was saved full-size.
        val width = if (askedWidth > 0) askedWidth else askedHeight
        val height = if (askedHeight > 0) askedHeight else askedWidth
        val quality = if (options.hasKey("quality")) options.getInt("quality").coerceIn(0, 100) else 80
        val format = if (options.hasKey("format")) options.getString("format") else "jpeg"

        if (source == null || dest == null) {
            promise.reject("INVALID_ARGS", "Source and destination are required")
            return
        }

        // Off the caller's thread: in bridgeless mode every legacy module's async methods
        // share one native-modules thread, so a slow decode here -- or a cloud content://
        // URI downloading the whole file -- stalled music controls, volume and PiP with it.
        executor.execute {
            try {
                generateBlocking(source, dest, time, width, height, quality, format, promise)
            } catch (t: Throwable) {
                // OutOfMemoryError included: a thumbnail is never worth the process.
                promise.reject("GEN_ERROR", t.message ?: t.javaClass.simpleName, t)
            }
        }
    }

    private fun generateBlocking(
        source: String, dest: String, time: Int, width: Int, height: Int,
        quality: Int, format: String?, promise: Promise
    ) {
        val retriever = MediaMetadataRetriever()
        var pfd: ParcelFileDescriptor? = null
        try {
            if (source.startsWith("content://")) {
                try {
                    pfd = reactApplicationContext.contentResolver.openFileDescriptor(Uri.parse(source), "r")
                } catch (e: SecurityException) {
                    // Permission denied - external app (like Telegram) didn't grant access
                    promise.reject("PERMISSION_ERROR", "No access to content provider: ${e.message}")
                    return
                } catch (e: IllegalArgumentException) {
                    promise.reject("PROVIDER_ERROR", "No content provider: $source")
                    return
                }
                val fd = pfd ?: run {
                    promise.reject("FILE_ERROR", "Could not open file descriptor for $source")
                    return
                }
                retriever.setDataSource(fd.fileDescriptor)
            } else if (source.startsWith("file://")) {
                // Callers send both encoded URIs and raw paths behind file://. The literal path
                // wins when it exists: decoding a raw one turned the `+` in
                // "Movie+Extras.mkv" into a space and failed to open it.
                val path = source.substring(7)
                retriever.setDataSource(
                    if (File(path).exists()) path
                    else try { URLDecoder.decode(path, "UTF-8") } catch (e: Exception) { path }
                )
            } else {
                retriever.setDataSource(source)
            }

            // Smart timestamp: with no time given, aim for 10% in, at least 5 s, to skip the
            // black frames and logos most videos open with; the middle for short clips.
            var timeUs = time * 1000L
            // An asked-for time means that exact frame (Recents shows where you stopped), so
            // decode on from the keyframe before it; the nearest keyframe can be seconds away.
            // The smart scan only needs a representative frame, and the keyframe is cheaper.
            val seek = if (timeUs == 0L) MediaMetadataRetriever.OPTION_CLOSEST_SYNC else MediaMetadataRetriever.OPTION_CLOSEST
            if (timeUs == 0L) {
                retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                    ?.toLongOrNull()
                    ?.let { durationMs ->
                        var targetMs = maxOf((durationMs * 0.10).toLong(), 5000L)
                        if (targetMs >= durationMs) targetMs = durationMs / 2
                        timeUs = targetMs * 1000L
                    }
            }

            // Scaled by the decoder where possible: a full 4K frame is 33 MB of ARGB, 8K four
            // times that, only to be shrunk to a list thumbnail.
            val scaled = width > 0 && height > 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1
            var bitmap = (if (scaled) {
                retriever.getScaledFrameAtTime(timeUs, seek, width, height)
            } else {
                retriever.getFrameAtTime(timeUs, seek)
            }) ?: retriever.frameAtTime // Fallback to any frame if the specific time fails

            if (bitmap == null) {
                promise.reject("GEN_ERROR", "Failed to retrieve frame")
                return
            }

            if (!scaled && width > 0 && height > 0) {
                val scale = minOf(width.toFloat() / bitmap.width, height.toFloat() / bitmap.height)
                if (scale < 1.0f) {
                    val scaledBitmap = Bitmap.createScaledBitmap(
                        bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true
                    )
                    bitmap.recycle()
                    bitmap = scaledBitmap
                }
            }

            // Through a temp file, renamed into place: JS trusts any existing file as a
            // finished thumbnail, so a kill mid-write would serve a truncated JPEG forever.
            val compressFormat = if (format == "png") Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG
            val destFile = File(dest.removePrefix("file://"))
            destFile.parentFile?.mkdirs()
            val tmpFile = File(destFile.path + ".tmp")
            FileOutputStream(tmpFile).use { bitmap.compress(compressFormat, quality, it) }
            if (!tmpFile.renameTo(destFile)) {
                tmpFile.delete()
                promise.reject("GEN_ERROR", "Could not write $destFile")
                return
            }

            val result = Arguments.createMap()
            result.putString("path", "file://" + destFile.absolutePath)
            result.putInt("width", bitmap.width)
            result.putInt("height", bitmap.height)
            bitmap.recycle()
            promise.resolve(result)
        } finally {
            // Separately, so a failing release cannot skip closing the descriptor.
            try { retriever.release() } catch (e: Exception) {}
            try { pfd?.close() } catch (e: Exception) {}
        }
    }

    @ReactMethod
    fun getRealPath(uriString: String, promise: Promise) {
        try {
            val context = reactApplicationContext
            val uri = Uri.parse(uriString)

            // 1. If it's already a file path, return it
            if (uri.scheme == null || uri.scheme == "file") {
                promise.resolve(if (uri.path != null) uri.path else uriString)
                return
            }

            // 2. Query MediaStore for _data column. Only MediaStore's own answer is trusted:
            // any other provider can return any path it likes, /data/data/com.glide.app
            // included, and Glide would then open that path with its own permissions.
            if (uri.scheme == "content" && uri.authority == MediaStore.AUTHORITY) {
                try {
                    val projection = arrayOf(MediaStore.MediaColumns.DATA)
                    context.contentResolver.query(uri, projection, null, null, null)?.use { cursor ->
                        if (cursor.moveToFirst()) {
                            val path = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATA))
                            if (path != null) {
                                promise.resolve(path)
                                return
                            }
                        }
                    }
                } catch (e: Exception) {
                    // Ignore query failures, fall through to fallback
                }
            }

            // 3. Fallback: Return original URI (Best effort)
            // generate() handles content:// URIs directly, so strict path resolution
            // isn't always fatal.
            promise.resolve(uriString)

        } catch (e: Exception) {
            promise.reject("PATH_ERROR", e.message)
        }
    }

    private companion object {
        /**
         * Two decodes at a time, at background priority so they never compete with the
         * playback decoder. ThumbnailService runs four workers; the rest queue here.
         */
        val executor = Executors.newFixedThreadPool(2) { runnable ->
            Thread({
                Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
                runnable.run()
            }, "simple-thumbnail")
        }
    }
}
