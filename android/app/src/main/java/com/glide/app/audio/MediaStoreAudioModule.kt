package com.glide.app.audio

import android.content.ContentUris
import android.content.Context
import android.database.ContentObserver
import android.database.Cursor
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Size
import android.webkit.MimeTypeMap
import androidx.palette.graphics.Palette
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.glide.app.player.BackgroundWork
import java.io.File
import java.io.FileOutputStream

class MediaStoreAudioModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "MediaStoreAudioModule"

    data class ArtDetails(
        val uri: String?,
        val primaryColor: String?,
        val secondaryColor: String?,
        val onPrimaryColor: String? = null
    )

    data class PaletteColors(val primary: String?, val secondary: String?, val onPrimary: String?)

    data class SongRecord(
        val id: String,
        val title: String,
        val artist: String,
        val album: String,
        val albumId: String,
        val uri: String,
        val durationMs: Long,
        val artworkUri: String? = null
    )

    companion object {
        private const val TAG = "MediaStoreAudioModule"
        private val artExecutor = java.util.concurrent.Executors.newFixedThreadPool(2)
        private val songCache = java.util.concurrent.ConcurrentHashMap<String, SongRecord>()

        private val SONG_PROJECTION = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ARTIST_ID,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.ALBUM_ID,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.DATA,
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.TRACK,
            MediaStore.Audio.Media.YEAR,
            MediaStore.Audio.Media.DATE_ADDED
        )

        fun sanitizeMetadata(value: String?, fallback: String): String {
            if (value.isNullOrBlank() || value.equals("<unknown>", ignoreCase = true)) {
                return fallback
            }
            return value.trim()
        }

        fun extractPaletteColors(bitmap: Bitmap): PaletteColors {
            return try {
                val palette = Palette.from(bitmap).generate()
                val vibrant = palette.vibrantSwatch
                val dominant = palette.dominantSwatch
                val swatch = vibrant ?: dominant ?: palette.swatches.firstOrNull()
                val primaryInt = swatch?.rgb ?: palette.getVibrantColor(palette.getDominantColor(0))
                val darkInt = palette.darkVibrantSwatch?.rgb ?: palette.darkMutedSwatch?.rgb ?: palette.getDarkVibrantColor(palette.getDarkMutedColor(0))
                val titleTextColorInt = swatch?.titleTextColor ?: -1

                val primaryHex = if (primaryInt != 0) String.format("#%06X", 0xFFFFFF and primaryInt) else null
                val darkHex = if (darkInt != 0) String.format("#%06X", 0xFFFFFF and darkInt) else null
                val onPrimaryHex = if (swatch != null && titleTextColorInt != -1) String.format("#%06X", 0xFFFFFF and titleTextColorInt) else "#FFFFFF"
                PaletteColors(primaryHex, darkHex, onPrimaryHex)
            } catch (_: Exception) {
                PaletteColors(null, null, "#FFFFFF")
            }
        }

        fun savePalette(paletteFile: File, primary: String?, secondary: String?, onPrimary: String?) {
            try {
                paletteFile.writeText("${primary ?: ""}|${secondary ?: ""}|${onPrimary ?: ""}")
            } catch (_: Exception) {}
        }

        /**
         * Embedded covers run to 3000 px and more: decoded whole that is ~36 MB of ARGB, two
         * at once on the art pool, and OutOfMemoryError is not an Exception, so it killed the
         * process. Subsample to at least ART_SIZE on the short side instead.
         */
        private fun decodeArt(decode: (BitmapFactory.Options) -> Bitmap?): Bitmap? = try {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            decode(bounds)
            var sample = 1
            while (minOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= ART_SIZE) sample *= 2
            decode(BitmapFactory.Options().apply { inSampleSize = sample })
        } catch (e: OutOfMemoryError) {
            null
        }

        private const val ART_SIZE = 512

        fun getArtworkDetails(context: Context, albumId: Long, songUriStr: String?): ArtDetails {
            if (albumId <= 0 && songUriStr.isNullOrEmpty()) return ArtDetails(null, null, null, null)

            val cacheDir = File(context.cacheDir, "album_art")
            if (!cacheDir.exists()) {
                cacheDir.mkdirs()
            }
            val cacheFile = File(cacheDir, "$albumId.jpg")
            val paletteFile = File(cacheDir, "$albumId.palette")

            if (cacheFile.exists() && cacheFile.length() > 0) {
                val uri = "file://${cacheFile.absolutePath}"
                if (paletteFile.exists() && paletteFile.length() > 0) {
                    try {
                        val parts = paletteFile.readText().split("|")
                        val primary = parts.getOrNull(0)?.takeIf { it.isNotEmpty() }
                        val secondary = parts.getOrNull(1)?.takeIf { it.isNotEmpty() }
                        val onPrimary = parts.getOrNull(2)?.takeIf { it.isNotEmpty() } ?: "#FFFFFF"
                        return ArtDetails(uri, primary, secondary, onPrimary)
                    } catch (_: Exception) {}
                }
                try {
                    val bitmap = decodeArt { BitmapFactory.decodeFile(cacheFile.absolutePath, it) }
                    if (bitmap != null) {
                        val colors = extractPaletteColors(bitmap)
                        savePalette(paletteFile, colors.primary, colors.secondary, colors.onPrimary)
                        return ArtDetails(uri, colors.primary, colors.secondary, colors.onPrimary)
                    }
                } catch (_: Exception) {}
                return ArtDetails(uri, null, null, null)
            }

            try {
                var bitmap: Bitmap? = null

                // Strategy 1: ContentResolver loadThumbnail on API 29+ (Android 10+)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && albumId > 0) {
                    val albumUri = ContentUris.withAppendedId(
                        MediaStore.Audio.Albums.EXTERNAL_CONTENT_URI,
                        albumId
                    )
                    try {
                        bitmap = context.contentResolver.loadThumbnail(
                            albumUri,
                            Size(512, 512),
                            null
                        )
                    } catch (_: Exception) {}
                }

                // Strategy 2: MediaMetadataRetriever from songUri
                if (bitmap == null && !songUriStr.isNullOrEmpty()) {
                    val songUri = Uri.parse(songUriStr)
                    val retriever = MediaMetadataRetriever()
                    try {
                        retriever.setDataSource(context, songUri)
                        val rawBytes = retriever.embeddedPicture
                        if (rawBytes != null) {
                            bitmap = decodeArt { BitmapFactory.decodeByteArray(rawBytes, 0, rawBytes.size, it) }
                        }
                    } catch (_: Exception) {}
                    finally {
                        try {
                            retriever.release()
                        } catch (_: Exception) {}
                    }
                }

                if (bitmap != null) {
                    // Through a temp file: a kill mid-write would otherwise leave a truncated
                    // JPEG that the exists-and-non-empty check above serves forever.
                    val tmp = File(cacheDir, "$albumId.jpg.tmp")
                    FileOutputStream(tmp).use { out ->
                        bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)
                    }
                    tmp.renameTo(cacheFile)
                    val colors = extractPaletteColors(bitmap)
                    savePalette(paletteFile, colors.primary, colors.secondary, colors.onPrimary)
                    return ArtDetails("file://${cacheFile.absolutePath}", colors.primary, colors.secondary, colors.onPrimary)
                }
            } catch (_: Exception) {
                // ignore
            }

            return ArtDetails(null, null, null, null)
        }

        fun getArtworkUri(context: Context, albumId: Long, songUriStr: String?): String? {
            return getArtworkDetails(context, albumId, songUriStr).uri
        }

        private const val SONG_SELECTION =
            "${MediaStore.Audio.Media.IS_MUSIC} != 0 AND ${MediaStore.Audio.Media.DURATION} >= 10000"

        @Volatile private var observerRegistered = false

        /**
         * The cache is a copy of MediaStore, so any library change empties it: a deleted or
         * re-tagged song must not keep playing under its old record. It refills lazily.
         */
        private fun ensureObserver(context: Context) {
            if (observerRegistered) return
            synchronized(this) {
                if (observerRegistered) return
                context.applicationContext.contentResolver.registerContentObserver(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                    true,
                    object : ContentObserver(Handler(Looper.getMainLooper())) {
                        override fun onChange(selfChange: Boolean) = songCache.clear()
                    }
                )
                observerRegistered = true
            }
        }

        private fun readRecord(context: Context, c: Cursor): SongRecord {
            val songId = c.getLong(c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID))
            val albumId = c.getLong(c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID))
            val artFile = File(context.cacheDir, "album_art/$albumId.jpg")
            return SongRecord(
                id = songId.toString(),
                title = sanitizeMetadata(c.getString(c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)), "Unknown Track"),
                artist = sanitizeMetadata(c.getString(c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)), "Unknown Artist"),
                album = sanitizeMetadata(c.getString(c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)), "Unknown Album"),
                albumId = albumId.toString(),
                uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, songId).toString(),
                durationMs = c.getLong(c.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)),
                artworkUri = if (artFile.exists() && artFile.length() > 0) "file://${artFile.absolutePath}" else null
            )
        }

        /**
         * Records for these ids, from the cache or one batched `_ID IN (...)` query per 500
         * misses -- not a query per song, which made resuming a large queue take seconds on a
         * cold start. Ids MediaStore does not know (deleted songs, file paths from "open
         * with") are simply absent; nothing is invented for them, and a failure is not cached.
         */
        fun getSongsByIds(context: Context, ids: List<String>): Map<String, SongRecord> {
            ensureObserver(context)
            val found = HashMap<String, SongRecord>(ids.size)
            val misses = ArrayList<Long>()
            for (id in ids) {
                val cached = songCache[id]
                if (cached != null) found[id] = cached
                else id.toLongOrNull()?.let { misses.add(it) }
            }
            for (chunk in misses.distinct().chunked(500)) {
                try {
                    context.contentResolver.query(
                        MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                        SONG_PROJECTION,
                        "${MediaStore.Audio.Media._ID} IN (${chunk.joinToString(",")})",
                        null,
                        null
                    )?.use { c ->
                        while (c.moveToNext()) {
                            val record = readRecord(context, c)
                            songCache[record.id] = record
                            found[record.id] = record
                        }
                    }
                } catch (e: Exception) {
                    android.util.Log.w(TAG, "song lookup failed: ${e.message}")
                }
            }
            return found
        }

        fun getSongById(context: Context, id: String): SongRecord? = getSongsByIds(context, listOf(id))[id]

        /** Every song, as the library screen lists them. For browsers such as Android Auto. */
        fun queryAllSongs(context: Context): List<SongRecord> {
            ensureObserver(context)
            val songs = ArrayList<SongRecord>()
            try {
                context.contentResolver.query(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                    SONG_PROJECTION,
                    SONG_SELECTION,
                    null,
                    "${MediaStore.Audio.Media.TITLE} COLLATE NOCASE ASC"
                )?.use { c ->
                    while (c.moveToNext()) {
                        val record = readRecord(context, c)
                        songCache[record.id] = record
                        songs.add(record)
                    }
                }
            } catch (e: Exception) {
                android.util.Log.w(TAG, "song scan failed: ${e.message}")
            }
            return songs
        }
    }

    @ReactMethod
    fun getSongs(promise: Promise) {
        BackgroundWork.submit(promise) {
            try {
                ensureObserver(reactContext)
                // A full scan is the fresh truth; drop records for songs that are gone.
                songCache.clear()
                val resolver = reactContext.contentResolver
                val selection = SONG_SELECTION
                val sortOrder = "${MediaStore.Audio.Media.TITLE} COLLATE NOCASE ASC"

                val cursor = resolver.query(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                    SONG_PROJECTION,
                    selection,
                    null,
                    sortOrder
                )

                val resultList = Arguments.createArray()
                cursor?.use { c ->
                    val idCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                    val titleCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
                    val artistCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
                    val artistIdCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST_ID)
                    val albumCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
                    val albumIdCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
                    val durationCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
                    val dataCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATA)
                    val sizeCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)
                    val trackCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TRACK)
                    val yearCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.YEAR)
                    val dateAddedCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED)

                    while (c.moveToNext()) {
                        val songId = c.getLong(idCol)
                        val albumId = c.getLong(albumIdCol)
                        val durationMs = c.getLong(durationCol)
                        val contentUri = ContentUris.withAppendedId(
                            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                            songId
                        ).toString()

                        val title = sanitizeMetadata(c.getString(titleCol), "Unknown Track")
                        val artist = sanitizeMetadata(c.getString(artistCol), "Unknown Artist")
                        val album = sanitizeMetadata(c.getString(albumCol), "Unknown Album")

                        val artFile = File(reactContext.cacheDir, "album_art/$albumId.jpg")
                        val artworkUri = if (artFile.exists() && artFile.length() > 0) {
                            "file://${artFile.absolutePath}"
                        } else null

                        songCache[songId.toString()] = SongRecord(
                            id = songId.toString(),
                            title = title,
                            artist = artist,
                            album = album,
                            albumId = albumId.toString(),
                            uri = contentUri,
                            durationMs = durationMs,
                            artworkUri = artworkUri
                        )

                        val map = Arguments.createMap().apply {
                            putString("id", songId.toString())
                            putString("title", title)
                            putString("artist", artist)
                            putString("artistId", c.getLong(artistIdCol).toString())
                            putString("album", album)
                            putString("albumId", albumId.toString())
                            putDouble("duration", durationMs / 1000.0) // seconds
                            putString("path", c.getString(dataCol) ?: "")
                            putString("uri", contentUri)
                            putDouble("size", c.getLong(sizeCol).toDouble())
                            putInt("trackNumber", c.getInt(trackCol))
                            putInt("year", c.getInt(yearCol))
                            putDouble("dateAdded", c.getLong(dateAddedCol).toDouble())

                            if (artworkUri != null) {
                                putString("artworkUri", artworkUri)
                                val paletteFile = File(reactContext.cacheDir, "album_art/$albumId.palette")
                                if (paletteFile.exists() && paletteFile.length() > 0) {
                                    try {
                                        val parts = paletteFile.readText().split("|")
                                        val primary = parts.getOrNull(0)?.takeIf { it.isNotEmpty() }
                                        if (primary != null) {
                                            putString("primaryColor", primary)
                                        }
                                    } catch (_: Exception) {}
                                }
                            } else {
                                putNull("artworkUri")
                            }
                        }
                        resultList.pushMap(map)
                    }
                }
                promise.resolve(resultList)
            } catch (e: Exception) {
                promise.reject("E_MEDIASTORE_SONGS", e.message, e)
            }
        }
    }

    @ReactMethod
    fun getAlbumArt(albumId: String, songUriStr: String?, promise: Promise) {
        artExecutor.execute {
            try {
                val uri = getArtworkUri(reactContext, albumId.toLongOrNull() ?: 0L, songUriStr)
                promise.resolve(uri)
            } catch (e: Exception) {
                promise.resolve(null)
            }
        }
    }

    @ReactMethod
    fun getAlbumArtWithPalette(albumId: String, songUriStr: String?, promise: Promise) {
        artExecutor.execute {
            try {
                val details = getArtworkDetails(reactContext, albumId.toLongOrNull() ?: 0L, songUriStr)
                val map = Arguments.createMap().apply {
                    putString("artworkUri", details.uri)
                    putString("primaryColor", details.primaryColor)
                    putString("secondaryColor", details.secondaryColor)
                    putString("onPrimaryColor", details.onPrimaryColor)
                }
                promise.resolve(map)
            } catch (e: Exception) {
                promise.resolve(Arguments.createMap())
            }
        }
    }

    /**
     * The MIME type the system has for a URI, so "Open with" never has to guess a file's
     * kind from its name. Null when the provider will not say, which leaves the caller to
     * fall back to the extension.
     */
    @ReactMethod
    fun getMimeType(uriStr: String?, promise: Promise) {
        if (uriStr.isNullOrBlank()) {
            promise.resolve(null)
            return
        }
        artExecutor.execute {
            val type = try {
                val uri = Uri.parse(uriStr)
                if (uri.scheme == "content") {
                    reactContext.contentResolver.getType(uri)
                } else {
                    val extension = MimeTypeMap.getFileExtensionFromUrl(uriStr)?.lowercase()
                    if (extension.isNullOrEmpty()) null
                    else MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
                }
            } catch (e: Exception) {
                null
            }
            promise.resolve(type)
        }
    }

    @ReactMethod
    fun getEmbeddedLyrics(songUriStr: String?, filePath: String?, promise: Promise) {
        artExecutor.execute {
            try {
                val lyrics = EmbeddedLyricsReader.extractLyrics(reactContext, songUriStr, filePath)
                promise.resolve(lyrics)
            } catch (e: Exception) {
                promise.resolve(null)
            }
        }
    }
}
