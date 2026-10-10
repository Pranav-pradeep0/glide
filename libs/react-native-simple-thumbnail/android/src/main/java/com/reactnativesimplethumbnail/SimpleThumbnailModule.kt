package com.reactnativesimplethumbnail

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import com.facebook.react.bridge.*
import java.io.File
import java.io.FileDescriptor
import java.io.FileOutputStream
import java.io.IOException
import java.util.*
import java.net.URLDecoder

class SimpleThumbnailModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "SimpleThumbnail"
    }

    @ReactMethod
    fun generate(options: ReadableMap, promise: Promise) {
        val source = options.getString("source")
        val dest = options.getString("dest")
        val time = if (options.hasKey("time")) options.getInt("time") else 0
        val width = if (options.hasKey("width")) options.getInt("width").coerceAtLeast(0) else 0
        val height = if (options.hasKey("height")) options.getInt("height").coerceAtLeast(0) else 0
        val quality = if (options.hasKey("quality")) options.getInt("quality").coerceIn(0, 100) else 80
        val format = if (options.hasKey("format")) options.getString("format") else "jpeg"

        if (source == null || dest == null) {
            promise.reject("INVALID_ARGS", "Source and destination are required")
            return
        }

        var retriever: MediaMetadataRetriever? = null
        var pfd: ParcelFileDescriptor? = null

        try {
            retriever = MediaMetadataRetriever()
            val context = reactApplicationContext

            if (source.startsWith("content://")) {
                val uri = Uri.parse(source)
                try {
                    pfd = context.contentResolver.openFileDescriptor(uri, "r")
                    if (pfd != null) {
                        retriever.setDataSource(pfd.fileDescriptor)
                    } else {
                        promise.reject("FILE_ERROR", "Could not open file descriptor for $source")
                        return
                    }
                } catch (e: SecurityException) {
                    // Permission denied - external app (like Telegram) didn't grant access
                    promise.reject("PERMISSION_ERROR", "No access to content provider: ${e.message}")
                    return
                } catch (e: IllegalArgumentException) {
                    // No content provider found for this URI
                    promise.reject("PROVIDER_ERROR", "No content provider: $source")
                    return
                } catch (e: Exception) {
                    promise.reject("CONTENT_ERROR", "Failed to access content: ${e.message}")
                    return
                }
            } else {
                var path = if (source.startsWith("file://")) source.substring(7) else source
                try {
                    path = URLDecoder.decode(path, "UTF-8")
                } catch (e: Exception) {
                    // Ignore decode errors, try original path
                }
                retriever.setDataSource(path)
            }
            
            // Smart Timestamp Logic
            var timeUs = time * 1000L
            if (timeUs == 0L) {
                // If user didn't specify a time, try to find a "good" time (avoid 0:00 black frame)
                try {
                   val durationStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                   if (durationStr != null) {
                       val durationMs = durationStr.toLong()
                       
                       // Research-based heuristics for "Visible Frame":
                       // 1. Movies often have black screens/logos for first 0-30s.
                       // 2. Short clips might have fade-ins.
                       // Logic: Aim for 10% of duration, but ensure at least 5s (5000ms).
                       
                       var targetMs = (durationMs * 0.10).toLong()
                       
                       // Minimum 5 seconds to skip slow intros/logos
                       if (targetMs < 5000) {
                           targetMs = 5000
                       }
                       
                       // Safety: Don't exceed video duration (leave 1s buffer)
                       if (targetMs >= durationMs) {
                           targetMs = durationMs / 2 // Fallback to middle
                       }
                       
                       timeUs = targetMs * 1000L
                   }
                } catch (e: Exception) {
                    // Ignore metadata errors, fallback to 0
                }
            }
            
            // Extract frame at specified time
            // OPTION_CLOSEST_SYNC is faster than OPTION_CLOSEST
            var bitmap = retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)

            if (bitmap == null) {
                 // Fallback to any frame if specific time fails
                 bitmap = retriever.frameAtTime
            }

            if (bitmap == null) {
                promise.reject("GEN_ERROR", "Failed to retrieve frame")
                return
            }

            // Scale if requested
            if (width > 0 && height > 0) {
                val originalWidth = bitmap.width
                val originalHeight = bitmap.height
                
                // Calculate scale to maintain aspect ratio while fitting within bounds
                val scale = Math.min(
                    width.toFloat() / originalWidth,
                    height.toFloat() / originalHeight
                )
                
                if (scale < 1.0f) {
                    val newWidth = (originalWidth * scale).toInt()
                    val newHeight = (originalHeight * scale).toInt()
                    val scaledBitmap = Bitmap.createScaledBitmap(bitmap, newWidth, newHeight, true)
                    bitmap.recycle() // Recycle original
                    bitmap = scaledBitmap
                }
            }

            // Save to file
            val compressFormat = if (format == "png") Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG
            val destFile = File(dest.replace("file://", ""))
            
            // Ensure parent dir exists
            destFile.parentFile?.mkdirs()

            val fos = FileOutputStream(destFile)
            bitmap.compress(compressFormat, quality, fos)
            fos.flush()
            fos.close()
            bitmap.recycle()

            val result = Arguments.createMap()
            result.putString("path", "file://" + destFile.absolutePath)
            result.putInt("width", bitmap.width)
            result.putInt("height", bitmap.height)
            
            promise.resolve(result)

        } catch (e: Exception) {
            promise.reject("GEN_ERROR", e.message)
            e.printStackTrace()
        } finally {
            try {
                retriever?.release()
                pfd?.close()
            } catch (e: IOException) {
                // Ignore close errors
            }
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
                    val cursor = context.contentResolver.query(uri, projection, null, null, null)
                    
                    if (cursor != null && cursor.moveToFirst()) {
                        val columnIndex = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATA)
                        val path = cursor.getString(columnIndex)
                        cursor.close()
                        if (path != null) {
                            promise.resolve(path)
                            return
                        }
                    }
                    cursor?.close()
                } catch (e: Exception) {
                    // Ignore query failures, fall through to fallback
                }
            }

            // 3. Fallback: Return original URI (Best effort)
            // The service can handle content:// URIs directly using our generate() method
            // so strict path resolution isn't always fatal.
            promise.resolve(uriString)

        } catch (e: Exception) {
            promise.reject("PATH_ERROR", e.message)
        }
    }

    /**
     * Probe subtitle tracks from a content:// URI using FFprobe with file descriptor.
     * This works even when the minimal FFmpeg build lacks SAF protocol support.
     * @param contentUri The content:// URI to probe
     * @returns Promise<String> JSON string with subtitle track information
     */
    @ReactMethod
    fun probeSubtitleTracks(contentUri: String, promise: Promise) {
        Thread {
            var pfd: ParcelFileDescriptor? = null
            try {
                val context = reactApplicationContext
                val uri = Uri.parse(contentUri)
                
                // For non-content URIs, return empty - caller should use FFprobeKit directly
                if (!contentUri.startsWith("content://")) {
                    promise.resolve("{\"streams\":[]}")
                    return@Thread
                }
                
                // Open file descriptor from content resolver
                pfd = context.contentResolver.openFileDescriptor(uri, "r")
                if (pfd == null) {
                    promise.reject("FD_ERROR", "Could not open file descriptor for $contentUri")
                    return@Thread
                }
                
                val fd = pfd.fd
                
                // Use pipe: protocol with file descriptor
                // -v quiet: suppress logs
                // -print_format json: output as JSON
                // -show_streams: show stream information
                // -select_streams s: select only subtitle streams
                val command = "-v quiet -print_format json -show_streams -select_streams s pipe:$fd"
                
                // Execute FFprobe using the FFmpegKit library
                val ffprobeKitClass = Class.forName("com.arthenica.ffmpegkit.FFprobeKit")
                val executeMethod = ffprobeKitClass.getMethod("execute", String::class.java)
                val session = executeMethod.invoke(null, command)
                
                // Get return code
                val getReturnCodeMethod = session.javaClass.getMethod("getReturnCode")
                val returnCode = getReturnCodeMethod.invoke(session)
                val getValueMethod = returnCode.javaClass.getMethod("getValue")
                val codeValue = getValueMethod.invoke(returnCode) as Int
                
                // Get output
                val getOutputMethod = session.javaClass.getMethod("getOutput")
                val output = getOutputMethod.invoke(session) as? String ?: "{\"streams\":[]}"
                
                if (codeValue == 0) {
                    promise.resolve(output)
                } else {
                    // Return empty streams on error rather than rejecting
                    // This allows the app to continue gracefully
                    promise.resolve("{\"streams\":[]}")
                }
                
            } catch (e: ClassNotFoundException) {
                // FFmpegKit not available - caller should handle this
                promise.reject("FFMPEG_NOT_AVAILABLE", "FFmpegKit library not available: ${e.message}")
            } catch (e: Exception) {
                promise.reject("PROBE_ERROR", e.message)
                e.printStackTrace()
            } finally {
                try {
                    pfd?.close()
                } catch (e: IOException) {
                    // Ignore close errors
                }
            }
        }.start()
    }

    /**
     * Extract a subtitle track from a content:// URI using FFmpeg with file descriptor.
     * This works even when the minimal FFmpeg build lacks SAF protocol support.
     * @param contentUri The content:// URI of the video
     * @param subtitleIndex The index of the subtitle stream to extract
     * @param outputPath The path to write the extracted subtitle file
     * @param outputFormat The output format (srt, vtt, ass)
     * @returns Promise<String> The path to the extracted subtitle file, or null on error
     */
    @ReactMethod
    fun extractSubtitle(contentUri: String, subtitleIndex: Int, outputPath: String, outputFormat: String, promise: Promise) {
        Thread {
            var pfd: ParcelFileDescriptor? = null
            try {
                val context = reactApplicationContext
                val uri = Uri.parse(contentUri)
                
                // For non-content URIs, reject - caller should use FFmpegKit directly
                if (!contentUri.startsWith("content://")) {
                    promise.reject("INVALID_URI", "extractSubtitle only handles content:// URIs")
                    return@Thread
                }
                
                // Open file descriptor from content resolver
                pfd = context.contentResolver.openFileDescriptor(uri, "r")
                if (pfd == null) {
                    promise.reject("FD_ERROR", "Could not open file descriptor for $contentUri")
                    return@Thread
                }
                
                val fd = pfd.fd
                
                // Map output format to FFmpeg codec
                val codec = when (outputFormat.lowercase()) {
                    "srt" -> "srt"
                    "vtt" -> "webvtt"
                    "ass" -> "ass"
                    else -> "srt"
                }
                
                // Build FFmpeg command
                // -v quiet: suppress logs
                // -i pipe:fd: read from file descriptor
                // -map 0:subtitleIndex: select the specific subtitle stream
                // -c:s codec: set output codec
                val command = "-v quiet -i pipe:$fd -map 0:$subtitleIndex -c:s $codec \"$outputPath\""
                
                // Execute FFmpeg using the FFmpegKit library
                val ffmpegKitClass = Class.forName("com.arthenica.ffmpegkit.FFmpegKit")
                val executeMethod = ffmpegKitClass.getMethod("execute", String::class.java)
                val session = executeMethod.invoke(null, command)
                
                // Get return code
                val getReturnCodeMethod = session.javaClass.getMethod("getReturnCode")
                val returnCode = getReturnCodeMethod.invoke(session)
                val getValueMethod = returnCode.javaClass.getMethod("getValue")
                val codeValue = getValueMethod.invoke(returnCode) as Int
                
                if (codeValue == 0) {
                    // Check if file was created
                    val outputFile = File(outputPath)
                    if (outputFile.exists() && outputFile.length() > 0) {
                        promise.resolve(outputPath)
                    } else {
                        promise.resolve(null)
                    }
                } else {
                    promise.resolve(null)
                }
                
            } catch (e: ClassNotFoundException) {
                promise.reject("FFMPEG_NOT_AVAILABLE", "FFmpegKit library not available: ${e.message}")
            } catch (e: Exception) {
                promise.reject("EXTRACT_ERROR", e.message)
                e.printStackTrace()
            } finally {
                try {
                    pfd?.close()
                } catch (e: IOException) {
                    // Ignore close errors
                }
            }
        }.start()
    }
}
