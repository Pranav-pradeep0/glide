package com.glide.app.audio

import android.content.Context
import android.media.audiofx.Equalizer
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.glide.app.player.GlidePlayerHolder
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.abs

@UnstableApi
class GlideAudioPlayerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "GlideAudioPlayerModule"

    companion object {
        private const val TAG = "GlideAudioPlayerModule"
        private const val PROGRESS_INTERVAL_MS = 500L

        /**
         * One worker for every queue build, so builds finish in the order they were asked
         * for. Paired with [queueGeneration], which drops a build that a newer request has
         * already replaced: a slow 5,000-song "play all" can no longer land after the single
         * song tapped a moment later.
         */
        private val queueExecutor = Executors.newSingleThreadExecutor { Thread(it, "glide-audio-queue") }
        private val queueGeneration = AtomicInteger()
    }

    private var player: ExoPlayer? = null
    private var equalizer: Equalizer? = null
    private var currentBandLevels: FloatArray? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var consecutiveErrors = 0
    private var isProgressRunning = false
    private var sleepTimerRunnable: Runnable? = null

    private val progressRunnable = object : Runnable {
        override fun run() {
            val p = player
            if (p != null && p.isPlaying) {
                emitProgress(p.currentPosition / 1000.0, (if (p.duration > 0) p.duration else 0L) / 1000.0)
                mainHandler.postDelayed(this, PROGRESS_INTERVAL_MS)
            } else {
                isProgressRunning = false
            }
        }
    }

    init {
        mainHandler.post {
            ensurePlayer()
        }
    }

    private var playerListener: Player.Listener? = null

    private fun ensurePlayer(): ExoPlayer {
        val existing = player
        if (existing != null) {
            return existing
        }

        val p = GlidePlayerHolder.getOrCreateAudioPlayer(reactContext)
        player = p

        var listener = playerListener
        if (listener == null) {
            listener = object : Player.Listener {
                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    if (isPlaying) {
                        consecutiveErrors = 0
                    }
                    emitPlaybackState()
                    if (isPlaying) {
                        startProgressUpdates()
                    } else {
                        stopProgressUpdates()
                    }
                }

                override fun onPlaybackStateChanged(playbackState: Int) {
                    emitPlaybackState()
                }

                override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                    if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) {
                        player?.pauseAtEndOfMediaItems = false
                        emitDeviceEvent("onSleepTimerFired", Arguments.createMap())
                    }
                }

                override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                    emitTrackChanged()
                }

                override fun onAudioSessionIdChanged(audioSessionId: Int) {
                    equalizer?.release()
                    equalizer = null
                    applyEqualizer()
                }

                override fun onPlayerError(error: PlaybackException) {
                    Log.w(TAG, "audio player error: ${error.errorCodeName} (${error.errorCode}): ${error.message}")
                    consecutiveErrors++
                    val count = p.mediaItemCount
                    if (consecutiveErrors < count && p.hasNextMediaItem()) {
                        p.seekToNextMediaItem()
                        p.prepare()
                        p.play()
                    } else {
                        consecutiveErrors = 0
                        p.stop()
                    }
                    val map = Arguments.createMap().apply {
                        putString("error", error.message ?: "Playback error")
                        putInt("errorCode", error.errorCode)
                    }
                    emitDeviceEvent("onAudioError", map)
                    emitPlaybackState()
                }
            }
            playerListener = listener
        }

        p.removeListener(listener)
        p.addListener(listener)

        if (p.isPlaying) {
            startProgressUpdates()
        }

        return p
    }

    private fun startProgressUpdates() {
        if (!isProgressRunning) {
            isProgressRunning = true
            mainHandler.post(progressRunnable)
        }
    }

    private fun stopProgressUpdates() {
        isProgressRunning = false
        mainHandler.removeCallbacks(progressRunnable)
    }

    private fun applyEqualizer() {
        val sessionId = player?.audioSessionId ?: C.AUDIO_SESSION_ID_UNSET
        if (sessionId == C.AUDIO_SESSION_ID_UNSET && currentBandLevels != null) return
        equalizer = GlideEqualizer.apply(equalizer, currentBandLevels, sessionId)
    }

    private fun getQueueIndices(): WritableArray {
        val array = Arguments.createArray()
        val p = player ?: return array
        val timeline = p.currentTimeline
        if (timeline.isEmpty || !p.shuffleModeEnabled) {
            for (i in 0 until p.mediaItemCount) {
                array.pushInt(i)
            }
            return array
        }
        var idx = timeline.getFirstWindowIndex(true)
        while (idx != C.INDEX_UNSET) {
            array.pushInt(idx)
            idx = timeline.getNextWindowIndex(idx, Player.REPEAT_MODE_OFF, true)
        }
        return array
    }

    private fun emitDeviceEvent(eventName: String, params: WritableMap) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        }
    }

    private fun emitPlaybackState() {
        val p = player ?: return
        val map = Arguments.createMap().apply {
            putBoolean("isPlaying", p.isPlaying)
            putBoolean("isBuffering", p.playbackState == Player.STATE_BUFFERING)
            putBoolean("isEnded", p.playbackState == Player.STATE_ENDED)
            putInt("currentIndex", p.currentMediaItemIndex)
            putDouble("position", p.currentPosition / 1000.0)
            putDouble("duration", (if (p.duration > 0) p.duration else 0L) / 1000.0)
        }
        emitDeviceEvent("onAudioPlaybackStateChanged", map)
    }

    private fun emitTrackChanged() {
        val p = player ?: return
        val map = Arguments.createMap().apply {
            putInt("currentIndex", p.currentMediaItemIndex)
            val currentItem = p.currentMediaItem
            putString("trackId", currentItem?.mediaId ?: "")
            putDouble("duration", (if (p.duration > 0) p.duration else 0L) / 1000.0)
            putArray("queueIndices", getQueueIndices())
        }
        emitDeviceEvent("onAudioTrackChanged", map)
    }

    private fun emitProgress(position: Double, duration: Double) {
        val map = Arguments.createMap().apply {
            putDouble("position", position)
            putDouble("duration", duration)
        }
        emitDeviceEvent("onAudioProgress", map)
    }

    // ================= React Methods =================

    private fun buildMediaItem(map: ReadableMap, defaultId: String): MediaItem {
        val id = map.getString("id") ?: defaultId
        val uriStr = map.getString("uri") ?: map.getString("path") ?: ""
        val title = map.getString("title") ?: "Unknown"
        val artist = map.getString("artist") ?: "Unknown Artist"
        val album = map.getString("album") ?: ""
        val albumId = map.getString("albumId") ?: ""
        var artUri = map.getString("artworkUri")

        if (artUri.isNullOrEmpty() && albumId.isNotEmpty()) {
            val artFile = File(reactContext.cacheDir, "album_art/$albumId.jpg")
            if (artFile.exists() && artFile.length() > 0) {
                artUri = "file://${artFile.absolutePath}"
            }
        }

        val metaBuilder = MediaMetadata.Builder()
            .setTitle(title)
            .setArtist(artist)
            .setAlbumTitle(album)

        if (!artUri.isNullOrEmpty()) {
            metaBuilder.setArtworkUri(Uri.parse(artUri))
        }

        return MediaItem.Builder()
            .setMediaId(id)
            .setUri(Uri.parse(uriStr))
            .setMediaMetadata(metaBuilder.build())
            .build()
    }

    @ReactMethod
    fun setQueue(
        tracks: ReadableArray,
        startIndex: Int,
        startPositionSeconds: Double,
        playWhenReady: Boolean,
        shuffle: Boolean,
        repeatMode: String,
        equalizerBands: ReadableArray?,
        promise: Promise
    ) {
        val maps = (0 until tracks.size()).map { tracks.getMap(it) }
        replaceQueue(startIndex, startPositionSeconds, playWhenReady, shuffle, repeatMode, equalizerBands, promise) {
            maps.mapIndexedNotNull { i, map -> map?.let { buildMediaItem(it, i.toString()) } }
        }
    }

    /**
     * Same as [setQueue], but only ids cross the bridge; records come from MediaStore. Every
     * id yields exactly one item, in order. An id MediaStore does not know -- a file path
     * from "open with", or a deleted song -- still gets an item (a direct URI, which plays or
     * fails and is skipped like any bad file). Dropping it instead would shift every later
     * index JS sends for remove, move and skip onto the wrong song.
     */
    @ReactMethod
    fun setQueueByIds(
        trackIds: ReadableArray,
        startIndex: Int,
        startPositionSeconds: Double,
        playWhenReady: Boolean,
        shuffle: Boolean,
        repeatMode: String,
        equalizerBands: ReadableArray?,
        promise: Promise
    ) {
        val ids = (0 until trackIds.size()).map { trackIds.getString(it) ?: "" }
        replaceQueue(startIndex, startPositionSeconds, playWhenReady, shuffle, repeatMode, equalizerBands, promise) {
            val records = MediaStoreAudioModule.getSongsByIds(reactContext, ids)
            ids.map { id -> records[id]?.let { itemFromRecord(it) } ?: itemFromBareId(id) }
        }
    }

    private fun itemFromRecord(record: MediaStoreAudioModule.SongRecord): MediaItem {
        val metaBuilder = MediaMetadata.Builder()
            .setTitle(record.title)
            .setArtist(record.artist)
            .setAlbumTitle(record.album)
        // The record may predate the art being cached; look again, as buildMediaItem does.
        val artUri = record.artworkUri ?: File(reactContext.cacheDir, "album_art/${record.albumId}.jpg")
            .takeIf { record.albumId.isNotEmpty() && it.exists() && it.length() > 0 }
            ?.let { "file://${it.absolutePath}" }
        if (artUri != null) metaBuilder.setArtworkUri(Uri.parse(artUri))
        return MediaItem.Builder()
            .setMediaId(record.id)
            .setUri(Uri.parse(record.uri))
            .setMediaMetadata(metaBuilder.build())
            .build()
    }

    private fun itemFromBareId(id: String): MediaItem {
        val uri = when {
            id.toLongOrNull() != null ->
                android.content.ContentUris.withAppendedId(
                    android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id.toLong()
                )
            id.startsWith("/") -> Uri.fromFile(File(id))
            else -> Uri.parse(id)
        }
        val title = uri.lastPathSegment?.substringBeforeLast('.')?.takeIf { it.isNotBlank() } ?: "Unknown Track"
        return MediaItem.Builder()
            .setMediaId(id)
            .setUri(uri)
            .setMediaMetadata(MediaMetadata.Builder().setTitle(title).build())
            .build()
    }

    private fun replaceQueue(
        startIndex: Int,
        startPositionSeconds: Double,
        playWhenReady: Boolean,
        shuffle: Boolean,
        repeatMode: String,
        equalizerBands: ReadableArray?,
        promise: Promise,
        build: () -> List<MediaItem>
    ) {
        val bandLevels = GlideEqualizer.toBandLevels(equalizerBands)
        val generation = queueGeneration.incrementAndGet()
        queueExecutor.execute {
            val mediaItems = try {
                build()
            } catch (e: Exception) {
                Log.e(TAG, "queue build error", e)
                promise.reject("E_SET_QUEUE", e.message, e)
                return@execute
            }
            mainHandler.post {
                if (generation != queueGeneration.get()) {
                    // A newer queue was asked for while this one was building.
                    promise.resolve(false)
                    return@post
                }
                try {
                    consecutiveErrors = 0
                    val p = ensurePlayer()
                    p.setMediaItems(
                        mediaItems,
                        startIndex.coerceIn(0, (mediaItems.size - 1).coerceAtLeast(0)),
                        (startPositionSeconds * 1000).toLong()
                    )
                    p.shuffleModeEnabled = shuffle
                    p.repeatMode = when (repeatMode) {
                        "one" -> Player.REPEAT_MODE_ONE
                        "all" -> Player.REPEAT_MODE_ALL
                        else -> Player.REPEAT_MODE_OFF
                    }

                    if (bandLevels != null) {
                        currentBandLevels = bandLevels
                        applyEqualizer()
                    }

                    p.prepare()
                    p.playWhenReady = playWhenReady

                    if (playWhenReady) {
                        GlidePlayerHolder.start(reactContext, p)
                    }

                    emitTrackChanged()
                    emitPlaybackState()
                    promise.resolve(true)
                } catch (e: Exception) {
                    Log.e(TAG, "setQueue error", e)
                    promise.reject("E_SET_QUEUE", e.message, e)
                }
            }
        }
    }

    @ReactMethod
    fun addMediaItem(index: Int, track: ReadableMap, promise: Promise) {
        mainHandler.post {
            try {
                val p = ensurePlayer()
                val targetIndex = index.coerceIn(0, p.mediaItemCount)
                p.addMediaItem(targetIndex, buildMediaItem(track, targetIndex.toString()))
                emitTrackChanged()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("E_ADD_MEDIA_ITEM", e.message, e)
            }
        }
    }

    @ReactMethod
    fun removeMediaItem(index: Int, promise: Promise) {
        mainHandler.post {
            try {
                val p = player
                if (p != null && index >= 0 && index < p.mediaItemCount) {
                    p.removeMediaItem(index)
                    emitTrackChanged()
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("E_REMOVE_MEDIA_ITEM", e.message, e)
            }
        }
    }

    @ReactMethod
    fun moveMediaItem(fromIndex: Int, toIndex: Int, promise: Promise) {
        mainHandler.post {
            try {
                val p = player
                if (p != null && fromIndex >= 0 && fromIndex < p.mediaItemCount && toIndex >= 0 && toIndex < p.mediaItemCount) {
                    p.moveMediaItem(fromIndex, toIndex)
                    emitTrackChanged()
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("E_MOVE_MEDIA_ITEM", e.message, e)
            }
        }
    }

    @ReactMethod
    fun setSleepTimer(minutes: Double, pauseAtEndOfMediaItem: Boolean, promise: Promise) {
        mainHandler.post {
            try {
                sleepTimerRunnable?.let { mainHandler.removeCallbacks(it) }
                sleepTimerRunnable = null

                val p = ensurePlayer()
                if (pauseAtEndOfMediaItem) {
                    p.pauseAtEndOfMediaItems = true
                } else {
                    p.pauseAtEndOfMediaItems = false
                    if (minutes > 0.0) {
                        val runnable = Runnable {
                            player?.pause()
                            sleepTimerRunnable = null
                            emitDeviceEvent("onSleepTimerFired", Arguments.createMap())
                            emitPlaybackState()
                        }
                        sleepTimerRunnable = runnable
                        mainHandler.postDelayed(runnable, (minutes * 60 * 1000).toLong())
                    }
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("E_SLEEP_TIMER", e.message, e)
            }
        }
    }

    @ReactMethod
    fun clearSleepTimer(promise: Promise) {
        mainHandler.post {
            try {
                sleepTimerRunnable?.let { mainHandler.removeCallbacks(it) }
                sleepTimerRunnable = null
                player?.pauseAtEndOfMediaItems = false
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("E_CLEAR_SLEEP_TIMER", e.message, e)
            }
        }
    }

    @ReactMethod
    fun play(promise: Promise) {
        mainHandler.post {
            try {
                consecutiveErrors = 0
                val p = ensurePlayer()
                GlidePlayerHolder.start(reactContext, p)
                p.play()
                emitPlaybackState()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("E_PLAY", e.message, e)
            }
        }
    }

    @ReactMethod
    fun pause(promise: Promise) {
        mainHandler.post {
            try {
                val p = player
                p?.pause()
                emitPlaybackState()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("E_PAUSE", e.message, e)
            }
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        mainHandler.post {
            try {
                val p = player
                sleepTimerRunnable?.let { mainHandler.removeCallbacks(it) }
                sleepTimerRunnable = null
                p?.pauseAtEndOfMediaItems = false
                p?.stop()
                p?.clearMediaItems()
                stopProgressUpdates()
                playerListener?.let { p?.removeListener(it) }
                playerListener = null
                GlidePlayerHolder.clearAudio(reactContext)
                player = null
                emitPlaybackState()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("E_STOP", e.message, e)
            }
        }
    }

    @ReactMethod
    fun seekTo(positionSeconds: Double, promise: Promise) {
        mainHandler.post {
            try {
                val p = player
                p?.seekTo((positionSeconds * 1000).toLong())
                emitPlaybackState()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("E_SEEK", e.message, e)
            }
        }
    }

    @ReactMethod
    fun skipToNext(promise: Promise) {
        mainHandler.post {
            try {
                player?.seekToNext()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("E_SKIP_NEXT", e.message, e)
            }
        }
    }

    @ReactMethod
    fun skipToPrevious(promise: Promise) {
        mainHandler.post {
            try {
                player?.seekToPrevious()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("E_SKIP_PREV", e.message, e)
            }
        }
    }

    @ReactMethod
    fun skipToIndex(index: Int, promise: Promise) {
        mainHandler.post {
            try {
                consecutiveErrors = 0
                val p = player
                if (p != null && index >= 0 && index < p.mediaItemCount) {
                    p.seekToDefaultPosition(index)
                    if (!p.isPlaying) {
                        p.play()
                    }
                    emitTrackChanged()
                    emitPlaybackState()
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("E_SKIP_INDEX", e.message, e)
            }
        }
    }

    @ReactMethod
    fun setRepeatMode(mode: String, promise: Promise) {
        mainHandler.post {
            try {
                val p = player
                p?.repeatMode = when (mode) {
                    "one" -> Player.REPEAT_MODE_ONE
                    "all" -> Player.REPEAT_MODE_ALL
                    else -> Player.REPEAT_MODE_OFF
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("E_REPEAT_MODE", e.message, e)
            }
        }
    }

    @ReactMethod
    fun setShuffleMode(enabled: Boolean, promise: Promise) {
        mainHandler.post {
            try {
                val p = player
                p?.shuffleModeEnabled = enabled
                emitTrackChanged()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("E_SHUFFLE_MODE", e.message, e)
            }
        }
    }

    @ReactMethod
    fun setAudioEqualizer(levels: ReadableArray?, promise: Promise) {
        mainHandler.post {
            try {
                currentBandLevels = GlideEqualizer.toBandLevels(levels)
                applyEqualizer()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("E_EQUALIZER", e.message, e)
            }
        }
    }

    @ReactMethod
    fun getCurrentState(promise: Promise) {
        mainHandler.post {
            try {
                val p = player ?: if (GlidePlayerHolder.audioPlayer != null) ensurePlayer() else null
                val map = Arguments.createMap().apply {
                    putBoolean("isPlaying", p?.isPlaying ?: false)
                    putBoolean("isBuffering", p?.playbackState == Player.STATE_BUFFERING)
                    putInt("currentIndex", p?.currentMediaItemIndex ?: 0)
                    putDouble("position", (p?.currentPosition ?: 0L) / 1000.0)
                    putDouble("duration", (if ((p?.duration ?: 0L) > 0) p?.duration ?: 0L else 0L) / 1000.0)
                    putString("trackId", p?.currentMediaItem?.mediaId ?: "")
                    putArray("queueIndices", getQueueIndices())
                }
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("E_GET_STATE", e.message, e)
            }
        }
    }

    // ================= Invalidate =================

    override fun invalidate() {
        super.invalidate()
        mainHandler.post {
            stopProgressUpdates()
            sleepTimerRunnable?.let { mainHandler.removeCallbacks(it) }
            sleepTimerRunnable = null
            equalizer?.release()
            equalizer = null
            playerListener?.let {
                player?.removeListener(it)
            }
            playerListener = null
            player = null
            // We do NOT release the audio player or stop the service here;
            // background audio playback cleanly survives React Native JS reloads.
        }
    }
}
