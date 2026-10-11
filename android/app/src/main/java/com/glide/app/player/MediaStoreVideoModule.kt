package com.glide.app.player

import android.app.Activity
import android.content.ClipData
import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.database.ContentObserver
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Log
import android.util.Size
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileOutputStream

@ReactModule(name = MediaStoreVideoModule.NAME)
class MediaStoreVideoModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    private var deletePromise: Promise? = null
    private var pendingDeleteUris: List<Uri>? = null

    init {
        reactContext.addActivityEventListener(object : BaseActivityEventListener() {
            override fun onActivityResult(
                activity: Activity,
                requestCode: Int,
                resultCode: Int,
                data: Intent?
            ) {
                if (requestCode == DELETE_REQUEST_CODE) {
                    val p = deletePromise
                    val urisToRetry = pendingDeleteUris
                    deletePromise = null
                    pendingDeleteUris = null
                    if (p != null) {
                        if (resultCode == Activity.RESULT_OK) {
                            if (urisToRetry != null && Build.VERSION.SDK_INT == Build.VERSION_CODES.Q) {
                                // On Android 10, user approval only grants permission. Re-run deletion.
                                try {
                                    for (uri in urisToRetry) {
                                        if (uri.scheme == "content") {
                                            val rows = reactContext.contentResolver.delete(uri, null, null)
                                            if (rows <= 0) {
                                                p.reject("E_DELETE_FAILED", "Could not delete media store item")
                                                return
                                            }
                                        } else if (uri.scheme == "file") {
                                            val file = File(uri.path ?: "")
                                            if (file.exists() && !file.delete()) {
                                                p.reject("E_DELETE_FAILED", "Could not delete file: ${file.name}")
                                                return
                                            }
                                        }
                                    }
                                    p.resolve(true)
                                } catch (e: Exception) {
                                    p.reject("E_DELETE_FAILED", e.message, e)
                                }
                            } else {
                                p.resolve(true)
                            }
                        } else {
                            // The user said no: an answer, not a failure.
                            p.resolve(false)
                        }
                    }
                }
            }
        })
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    /** Debounced: a copy or a scan fires onChange once per file, often dozens in a burst. */
    private val announceLibraryChange = Runnable {
        if (reactContext.hasActiveReactInstance()) {
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(EVENT_LIBRARY_CHANGED, null)
        }
    }

    /**
     * A video added, deleted or renamed outside Glide. JS drops its library cache on this, so
     * the next screen shows it instead of waiting out the five-minute cache.
     */
    private val libraryObserver = object : ContentObserver(mainHandler) {
        override fun onChange(selfChange: Boolean) {
            mainHandler.removeCallbacks(announceLibraryChange)
            mainHandler.postDelayed(announceLibraryChange, LIBRARY_CHANGE_DEBOUNCE_MS)
        }
    }

    // A second init, after the observer: Kotlin initialises in source order, so registering
    // from the first one passed a null observer and crashed the module on construction.
    init {
        reactContext.contentResolver.registerContentObserver(
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true, libraryObserver
        )
    }

    override fun invalidate() {
        reactContext.contentResolver.unregisterContentObserver(libraryObserver)
        mainHandler.removeCallbacks(announceLibraryChange)
        super.invalidate()
    }

    private data class FolderBucketData(
        val id: String,
        val title: String,
        var count: Int,
        var newestTimestamp: Long,
        var firstVideoUri: String,
        var firstVideoPath: String
    )

    companion object {
        const val NAME = "MediaStoreVideoModule"
        const val EVENT_LIBRARY_CHANGED = "onVideoLibraryChanged"
        private const val LIBRARY_CHANGE_DEBOUNCE_MS = 1500L
        private const val TAG = "MediaStoreVideoModule"
        private const val DELETE_REQUEST_CODE = 42001
        private val thumbExecutor = java.util.concurrent.Executors.newFixedThreadPool(4)

        private val VIDEO_PROJECTION = arrayOf(
            MediaStore.Video.Media._ID,
            MediaStore.Video.Media.TITLE,
            MediaStore.Video.Media.DISPLAY_NAME,
            MediaStore.Video.Media.DATA,
            MediaStore.Video.Media.DURATION,
            MediaStore.Video.Media.SIZE,
            MediaStore.Video.Media.DATE_MODIFIED,
            MediaStore.Video.Media.WIDTH,
            MediaStore.Video.Media.HEIGHT,
            MediaStore.Video.Media.BUCKET_ID,
            MediaStore.Video.Media.BUCKET_DISPLAY_NAME
        )

        fun resolveContentUri(resolver: ContentResolver, pathOrUri: String): Uri? {
            val path = if (pathOrUri.startsWith("file://")) {
                Uri.parse(pathOrUri).path ?: pathOrUri.removePrefix("file://")
            } else {
                pathOrUri
            }
            return try {
                val proj = arrayOf(MediaStore.Video.Media._ID)
                val sel = "${MediaStore.Video.Media.DATA} = ?"
                val args = arrayOf(path)
                resolver.query(
                    MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                    proj,
                    sel,
                    args,
                    null
                )?.use { c ->
                    if (c.moveToFirst()) {
                        val id = c.getLong(0)
                        ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id)
                    } else {
                        null
                    }
                }
            } catch (_: Throwable) {
                null
            }
        }

        fun loadThumbnailSync(context: Context, videoUriOrPath: String, width: Int, height: Int): String? {
            return try {
                val cacheDir = File(context.cacheDir, "video_thumbs")
                if (!cacheDir.exists()) {
                    cacheDir.mkdirs()
                }

                var contentUri: Uri? = null
                var videoId: Long? = null
                var dateModified: Long = 0L
                var fileSize: Long = 0L

                if (videoUriOrPath.startsWith("content://")) {
                    val parsed = Uri.parse(videoUriOrPath)
                    contentUri = parsed
                    videoId = try { ContentUris.parseId(parsed) } catch (_: Throwable) { null }
                    try {
                        val proj = arrayOf(
                            MediaStore.Video.Media._ID,
                            MediaStore.Video.Media.DATE_MODIFIED,
                            MediaStore.Video.Media.SIZE
                        )
                        context.contentResolver.query(parsed, proj, null, null, null)?.use { c ->
                            if (c.moveToFirst()) {
                                if (videoId == null) videoId = c.getLong(0)
                                dateModified = c.getLong(1)
                                fileSize = c.getLong(2)
                            }
                        }
                    } catch (_: Throwable) {}
                } else if (videoUriOrPath.toLongOrNull() != null) {
                    val id = videoUriOrPath.toLong()
                    videoId = id
                    contentUri = ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id)
                    try {
                        val proj = arrayOf(
                            MediaStore.Video.Media.DATE_MODIFIED,
                            MediaStore.Video.Media.SIZE
                        )
                        context.contentResolver.query(contentUri, proj, null, null, null)?.use { c ->
                            if (c.moveToFirst()) {
                                dateModified = c.getLong(0)
                                fileSize = c.getLong(1)
                            }
                        }
                    } catch (_: Throwable) {}
                } else {
                    try {
                        val proj = arrayOf(
                            MediaStore.Video.Media._ID,
                            MediaStore.Video.Media.DATE_MODIFIED,
                            MediaStore.Video.Media.SIZE
                        )
                        val sel = "${MediaStore.Video.Media.DATA} = ?"
                        val args = arrayOf(videoUriOrPath)
                        context.contentResolver.query(
                            MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                            proj,
                            sel,
                            args,
                            null
                        )?.use { c ->
                            if (c.moveToFirst()) {
                                videoId = c.getLong(0)
                                dateModified = c.getLong(1)
                                fileSize = c.getLong(2)
                                contentUri = ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, videoId!!)
                            }
                        }
                    } catch (_: Throwable) {}

                    if (videoId == null) {
                        val f = File(videoUriOrPath)
                        if (f.exists()) {
                            dateModified = f.lastModified()
                            fileSize = f.length()
                        }
                    }
                }

                val safeId = videoId?.toString() ?: Math.abs(videoUriOrPath.hashCode()).toString()
                val cacheKey = "${safeId}_${dateModified}_${fileSize}_${width}x${height}.jpg"
                val cacheFile = File(cacheDir, cacheKey)
                if (cacheFile.exists() && cacheFile.length() > 0) {
                    return "file://${cacheFile.absolutePath}"
                }

                var bitmap: Bitmap? = null

                // 1. API 29+ contentResolver.loadThumbnail
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && contentUri != null) {
                    try {
                        bitmap = context.contentResolver.loadThumbnail(contentUri, Size(width, height), null)
                    } catch (_: Throwable) {}
                }

                // 2. Legacy MediaStore.Video.Thumbnails for API < 29
                if (bitmap == null && videoId != null && videoId > 0) {
                    try {
                        @Suppress("DEPRECATION")
                        bitmap = MediaStore.Video.Thumbnails.getThumbnail(
                            context.contentResolver,
                            videoId,
                            MediaStore.Video.Thumbnails.MINI_KIND,
                            null
                        )
                    } catch (_: Throwable) {}
                }

                // No system thumbnail (a file MediaStore has not indexed): return null and let
                // ThumbnailService pick a frame. Its scan skips black opening frames; grabbing
                // frame 0 here would short-circuit that and cache a black thumbnail forever.
                if (bitmap != null) {
                    val tempFile = File(cacheDir, "${cacheKey}.tmp_${System.nanoTime()}")
                    try {
                        FileOutputStream(tempFile).use { out ->
                            bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)
                        }
                        if (tempFile.renameTo(cacheFile)) {
                            return "file://${cacheFile.absolutePath}"
                        } else if (cacheFile.exists() && cacheFile.length() > 0) {
                            return "file://${cacheFile.absolutePath}"
                        }
                    } catch (t: Throwable) {
                        Log.e(TAG, "Error writing thumbnail to cache", t)
                    } finally {
                        try { tempFile.delete() } catch (_: Throwable) {}
                        try { bitmap.recycle() } catch (_: Throwable) {}
                    }
                }

                null
            } catch (t: Throwable) {
                Log.e(TAG, "Error in loadThumbnailSync", t)
                null
            }
        }
    }

    @ReactMethod
    fun getLibrary(promise: Promise) {
        BackgroundWork.submit(promise) {
            try {
                val resolver = reactContext.contentResolver
                val selection = "${MediaStore.Video.Media.SIZE} > 0"
                val sortOrder = "${MediaStore.Video.Media.DATE_MODIFIED} DESC"

                val cursor = resolver.query(
                    MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                    VIDEO_PROJECTION,
                    selection,
                    null,
                    sortOrder
                )

                val videosArray = Arguments.createArray()
                val bucketsMap = LinkedHashMap<String, FolderBucketData>()

                cursor?.use { c ->
                    val idCol = c.getColumnIndex(MediaStore.Video.Media._ID)
                    val titleCol = c.getColumnIndex(MediaStore.Video.Media.TITLE)
                    val displayNameCol = c.getColumnIndex(MediaStore.Video.Media.DISPLAY_NAME)
                    val dataCol = c.getColumnIndex(MediaStore.Video.Media.DATA)
                    val durationCol = c.getColumnIndex(MediaStore.Video.Media.DURATION)
                    val sizeCol = c.getColumnIndex(MediaStore.Video.Media.SIZE)
                    val dateModifiedCol = c.getColumnIndex(MediaStore.Video.Media.DATE_MODIFIED)
                    val widthCol = c.getColumnIndex(MediaStore.Video.Media.WIDTH)
                    val heightCol = c.getColumnIndex(MediaStore.Video.Media.HEIGHT)
                    val bucketIdCol = c.getColumnIndex(MediaStore.Video.Media.BUCKET_ID)
                    val bucketDisplayNameCol = c.getColumnIndex(MediaStore.Video.Media.BUCKET_DISPLAY_NAME)

                    while (c.moveToNext()) {
                        val videoId = if (idCol >= 0) c.getLong(idCol) else 0L
                        val title = if (titleCol >= 0) c.getString(titleCol) else null
                        val displayName = if (displayNameCol >= 0) c.getString(displayNameCol) else null
                        val dataPath = if (dataCol >= 0) c.getString(dataCol) ?: "" else ""
                        val durationMs = if (durationCol >= 0) c.getLong(durationCol) else 0L
                        val sizeBytes = if (sizeCol >= 0) c.getLong(sizeCol) else 0L
                        val dateModifiedSec = if (dateModifiedCol >= 0) c.getLong(dateModifiedCol) else 0L
                        val width = if (widthCol >= 0) c.getInt(widthCol) else 0
                        val height = if (heightCol >= 0) c.getInt(heightCol) else 0
                        val rawBucketId = if (bucketIdCol >= 0) c.getString(bucketIdCol) else null
                        val rawBucketName = if (bucketDisplayNameCol >= 0) c.getString(bucketDisplayNameCol) else null

                        val contentUri = ContentUris.withAppendedId(
                            MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                            videoId
                        ).toString()

                        val videoName = when {
                            !displayName.isNullOrBlank() -> displayName
                            !title.isNullOrBlank() -> title
                            dataPath.isNotBlank() -> File(dataPath).name
                            else -> "Unknown Video"
                        }

                        val bucketTitle = when {
                            !rawBucketName.isNullOrBlank() -> rawBucketName
                            dataPath.isNotBlank() -> {
                                val parent = File(dataPath).parentFile
                                parent?.name ?: "Videos"
                            }
                            else -> "Videos"
                        }

                        val bucketId = when {
                            !rawBucketId.isNullOrBlank() -> rawBucketId
                            dataPath.isNotBlank() -> {
                                val parent = File(dataPath).parentFile
                                parent?.absolutePath?.hashCode()?.toString() ?: "0"
                            }
                            else -> "0"
                        }

                        val dateModifiedMs = if (dateModifiedSec > 0) dateModifiedSec * 1000L else 0L

                        // Update or insert bucket
                        val bucket = bucketsMap[bucketId]
                        if (bucket == null) {
                            bucketsMap[bucketId] = FolderBucketData(
                                id = bucketId,
                                title = bucketTitle,
                                count = 1,
                                newestTimestamp = dateModifiedMs,
                                firstVideoUri = contentUri,
                                firstVideoPath = dataPath
                            )
                        } else {
                            bucket.count++
                            if (dateModifiedMs > bucket.newestTimestamp) {
                                bucket.newestTimestamp = dateModifiedMs
                                bucket.firstVideoUri = contentUri
                                bucket.firstVideoPath = dataPath
                            }
                        }

                        val videoMap = Arguments.createMap().apply {
                            putString("id", videoId.toString())
                            putString("name", videoName)
                            putString("path", dataPath)
                            putString("uri", contentUri)
                            putDouble("size", sizeBytes.toDouble())
                            putDouble("modifiedDate", dateModifiedMs.toDouble())
                            putDouble("duration", durationMs / 1000.0) // seconds
                            putInt("width", width)
                            putInt("height", height)
                            putBoolean("isDirectory", false)
                            putString("album", bucketTitle)
                            putString("bucketId", bucketId)
                        }
                        videosArray.pushMap(videoMap)
                    }
                }

                val foldersArray = Arguments.createArray()
                for (bucket in bucketsMap.values) {
                    val folderMap = Arguments.createMap().apply {
                        putString("id", bucket.id)
                        putString("title", bucket.title)
                        putInt("count", bucket.count)
                        putDouble("newestTimestamp", bucket.newestTimestamp.toDouble())
                        putString("firstVideoUri", bucket.firstVideoUri)
                        putString("firstVideoPath", bucket.firstVideoPath)
                    }
                    foldersArray.pushMap(folderMap)
                }

                val result = Arguments.createMap().apply {
                    putArray("videos", videosArray)
                    putArray("folders", foldersArray)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("E_MEDIASTORE_VIDEOS", e.message, e)
            }
        }
    }

    @ReactMethod
    fun getVideos(bucketId: String?, promise: Promise) {
        BackgroundWork.submit(promise) {
            try {
                val resolver = reactContext.contentResolver
                val selection = if (!bucketId.isNullOrEmpty()) {
                    "${MediaStore.Video.Media.SIZE} > 0 AND (${MediaStore.Video.Media.BUCKET_ID} = ? OR ${MediaStore.Video.Media.BUCKET_DISPLAY_NAME} = ?)"
                } else {
                    "${MediaStore.Video.Media.SIZE} > 0"
                }
                val selectionArgs = if (!bucketId.isNullOrEmpty()) {
                    arrayOf(bucketId, bucketId)
                } else {
                    null
                }
                val sortOrder = "${MediaStore.Video.Media.DATE_MODIFIED} DESC"

                val cursor = resolver.query(
                    MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                    VIDEO_PROJECTION,
                    selection,
                    selectionArgs,
                    sortOrder
                )

                val videosArray = Arguments.createArray()
                cursor?.use { c ->
                    val idCol = c.getColumnIndex(MediaStore.Video.Media._ID)
                    val titleCol = c.getColumnIndex(MediaStore.Video.Media.TITLE)
                    val displayNameCol = c.getColumnIndex(MediaStore.Video.Media.DISPLAY_NAME)
                    val dataCol = c.getColumnIndex(MediaStore.Video.Media.DATA)
                    val durationCol = c.getColumnIndex(MediaStore.Video.Media.DURATION)
                    val sizeCol = c.getColumnIndex(MediaStore.Video.Media.SIZE)
                    val dateModifiedCol = c.getColumnIndex(MediaStore.Video.Media.DATE_MODIFIED)
                    val widthCol = c.getColumnIndex(MediaStore.Video.Media.WIDTH)
                    val heightCol = c.getColumnIndex(MediaStore.Video.Media.HEIGHT)
                    val bucketDisplayNameCol = c.getColumnIndex(MediaStore.Video.Media.BUCKET_DISPLAY_NAME)
                    val bucketIdCol = c.getColumnIndex(MediaStore.Video.Media.BUCKET_ID)

                    while (c.moveToNext()) {
                        val videoId = if (idCol >= 0) c.getLong(idCol) else 0L
                        val title = if (titleCol >= 0) c.getString(titleCol) else null
                        val displayName = if (displayNameCol >= 0) c.getString(displayNameCol) else null
                        val dataPath = if (dataCol >= 0) c.getString(dataCol) ?: "" else ""
                        val durationMs = if (durationCol >= 0) c.getLong(durationCol) else 0L
                        val sizeBytes = if (sizeCol >= 0) c.getLong(sizeCol) else 0L
                        val dateModifiedSec = if (dateModifiedCol >= 0) c.getLong(dateModifiedCol) else 0L
                        val width = if (widthCol >= 0) c.getInt(widthCol) else 0
                        val height = if (heightCol >= 0) c.getInt(heightCol) else 0
                        val rawBucketId = if (bucketIdCol >= 0) c.getString(bucketIdCol) else null
                        val rawBucketName = if (bucketDisplayNameCol >= 0) c.getString(bucketDisplayNameCol) else null

                        val contentUri = ContentUris.withAppendedId(
                            MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                            videoId
                        ).toString()

                        val videoName = when {
                            !displayName.isNullOrBlank() -> displayName
                            !title.isNullOrBlank() -> title
                            dataPath.isNotBlank() -> File(dataPath).name
                            else -> "Unknown Video"
                        }

                        val bucketTitle = when {
                            !rawBucketName.isNullOrBlank() -> rawBucketName
                            dataPath.isNotBlank() -> {
                                val parent = File(dataPath).parentFile
                                parent?.name ?: "Videos"
                            }
                            else -> "Videos"
                        }

                        val dateModifiedMs = if (dateModifiedSec > 0) dateModifiedSec * 1000L else 0L

                        val videoMap = Arguments.createMap().apply {
                            putString("id", videoId.toString())
                            putString("name", videoName)
                            putString("path", dataPath)
                            putString("uri", contentUri)
                            putDouble("size", sizeBytes.toDouble())
                            putDouble("modifiedDate", dateModifiedMs.toDouble())
                            putDouble("duration", durationMs / 1000.0)
                            putInt("width", width)
                            putInt("height", height)
                            putBoolean("isDirectory", false)
                            putString("album", bucketTitle)
                            if (!rawBucketId.isNullOrBlank()) {
                                putString("bucketId", rawBucketId)
                            }
                        }
                        videosArray.pushMap(videoMap)
                    }
                }
                promise.resolve(videosArray)
            } catch (e: Exception) {
                promise.reject("E_MEDIASTORE_VIDEOS", e.message, e)
            }
        }
    }

    @ReactMethod
    fun getThumbnail(videoUriOrPath: String?, promise: Promise) {
        getThumbnailWithSize(videoUriOrPath, 512, 512, promise)
    }

    @ReactMethod
    fun getThumbnailWithSize(videoUriOrPath: String?, width: Int, height: Int, promise: Promise) {
        if (videoUriOrPath.isNullOrBlank()) {
            promise.resolve(null)
            return
        }

        thumbExecutor.execute {
            try {
                val targetW = if (width > 0) width else 512
                val targetH = if (height > 0) height else 512
                val thumbUri = loadThumbnailSync(reactContext, videoUriOrPath, targetW, targetH)
                promise.resolve(thumbUri)
            } catch (e: Exception) {
                promise.resolve(null)
            }
        }
    }

    /**
     * Opens the share sheet for one video, sent as its own MediaStore link with a read grant
     * for the receiving app only. No FileProvider: nothing outside the media library is
     * reachable. Rejects E_NOT_FOUND for a file MediaStore hasn't indexed, and E_NO_ACCESS
     * for another app's link whose "Open with" grant has expired.
     */
    @ReactMethod
    fun shareVideo(pathOrUri: String, promise: Promise) {
        val resolver = reactContext.contentResolver
        val uri = if (pathOrUri.startsWith("content://")) Uri.parse(pathOrUri) else resolveContentUri(resolver, pathOrUri)
        if (uri == null) {
            promise.reject("E_NOT_FOUND", "Video is not in the media library")
            return
        }
        val activity = reactContext.currentActivity
        if (activity == null) {
            promise.reject("E_NO_ACTIVITY", "Cannot share without an active window")
            return
        }
        val send = Intent(Intent.ACTION_SEND).apply {
            type = resolver.getType(uri) ?: "video/*"
            putExtra(Intent.EXTRA_STREAM, uri)
            // ClipData carries the grant through the chooser and gives the sheet its preview.
            clipData = ClipData.newRawUri(null, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            activity.startActivity(Intent.createChooser(send, null))
            promise.resolve(null)
        } catch (e: SecurityException) {
            promise.reject("E_NO_ACCESS", "No longer allowed to read this video", e)
        }
    }

    @ReactMethod
    fun deleteVideos(uriStrings: ReadableArray, promise: Promise) {
        if (deletePromise != null) {
            promise.reject("E_BUSY", "Another delete operation is in progress")
            return
        }

        if (uriStrings.size() == 0) {
            promise.resolve(true)
            return
        }

        val contentResolver = reactContext.contentResolver
        val contentUris = ArrayList<Uri>()
        val fileUris = ArrayList<Uri>()

        for (i in 0 until uriStrings.size()) {
            val s = uriStrings.getString(i) ?: continue
            if (s.startsWith("content://")) {
                contentUris.add(Uri.parse(s))
            } else {
                val resolvedUri = resolveContentUri(contentResolver, s)
                if (resolvedUri != null) {
                    contentUris.add(resolvedUri)
                } else {
                    val fileUri = if (s.startsWith("file://")) Uri.parse(s) else Uri.fromFile(File(s))
                    fileUris.add(fileUri)
                }
            }
        }

        if (contentUris.isEmpty() && fileUris.isEmpty()) {
            promise.resolve(true)
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            for (fileUri in fileUris) {
                val file = File(fileUri.path ?: "")
                if (file.exists() && !file.delete()) {
                    promise.reject("E_DELETE_FAILED", "Could not delete file: ${file.name}")
                    return
                }
            }

            if (contentUris.isNotEmpty()) {
                val activity = reactContext.currentActivity
                if (activity == null) {
                    promise.reject("E_NO_ACTIVITY", "Cannot show delete dialog without an active window")
                    return
                }
                try {
                    val pendingIntent = MediaStore.createDeleteRequest(contentResolver, contentUris)
                    pendingDeleteUris = null
                    deletePromise = promise
                    activity.startIntentSenderForResult(
                        pendingIntent.intentSender,
                        DELETE_REQUEST_CODE,
                        null,
                        0,
                        0,
                        0
                    )
                } catch (e: Exception) {
                    deletePromise = null
                    pendingDeleteUris = null
                    promise.reject("E_DELETE_REQUEST_FAILED", e.message, e)
                }
            } else {
                promise.resolve(true)
            }
        } else {
            val allUris = ArrayList<Uri>().apply {
                addAll(contentUris)
                addAll(fileUris)
            }
            for (i in 0 until allUris.size) {
                val uri = allUris[i]
                try {
                    if (uri.scheme == "content") {
                        val rows = contentResolver.delete(uri, null, null)
                        if (rows <= 0) {
                            promise.reject("E_DELETE_FAILED", "Could not delete media store item")
                            return
                        }
                    } else if (uri.scheme == "file") {
                        val file = File(uri.path ?: "")
                        if (file.exists() && !file.delete()) {
                            promise.reject("E_DELETE_FAILED", "Could not delete file: ${file.name}")
                            return
                        }
                    }
                } catch (e: Exception) {
                    // ponytail: Android 10 RecoverableSecurityException only prompts for one URI at a time; bulk deletes would need chained prompts.
                    if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q && e is android.app.RecoverableSecurityException) {
                        val activity = reactContext.currentActivity
                        if (activity != null) {
                            try {
                                pendingDeleteUris = allUris.subList(i, allUris.size)
                                deletePromise = promise
                                activity.startIntentSenderForResult(
                                    e.userAction.actionIntent.intentSender,
                                    DELETE_REQUEST_CODE,
                                    null,
                                    0,
                                    0,
                                    0
                                )
                                return
                            } catch (t: Throwable) {
                                deletePromise = null
                                pendingDeleteUris = null
                                promise.reject("E_DELETE_FAILED", t.message, t)
                                return
                            }
                        }
                    }
                    promise.reject("E_DELETE_FAILED", e.message, e)
                    return
                }
            }
            promise.resolve(true)
        }
    }
}
