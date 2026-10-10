package com.glide.app.audio

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.exoplayer.ExoPlayer
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
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
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    override fun getName(): String = "GlideAudioPlayerModule"

    companion object {
        private const val TAG = "GlideAudioPlayerModule"
        private const val PROGRESS_INTERVAL_MS = 500L

        /** Matches POSITION_SAVE_INTERVAL_MS in audioStore.ts, the only background reader. */
        private const val BACKGROUND_PROGRESS_INTERVAL_MS = 5000L

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
    private val mainHandler = Handler(Looper.getMainLooper())
    private var isProgressRunning = false

    /**
     * Set by [invalidate]. Main-thread work posted before a JS reload can still run after
     * it, and must not attach this dead module's listener next to the new module's.
     */
    @Volatile private var invalidated = false

    private val playbackListener = object : MusicPlayback.Listener {
        override fun onSleepTimerFired() {
            emitDeviceEvent("onSleepTimerFired", Arguments.createMap())
            emitPlaybackState()
        }
    }

    /**
     * In the background nothing is drawing the position, so the 500 ms event is mostly a
     * wakeup for nobody -- and background music is exactly when it runs longest. The one
     * reader left is audioStore saving the position every 5 s, so a killed app resumes close
     * to where it was; the event slows to that instead of stopping. The notification and
     * lock screen come from the MediaSession, not from this.
     */
    private var hostPaused = false

    private val progressRunnable = object : Runnable {
        override fun run() {
            val p = player
            if (p != null && p.isPlaying) {
                emitProgress(p.currentPosition / 1000.0, (if (p.duration > 0) p.duration else 0L) / 1000.0)
                mainHandler.postDelayed(
                    this,
                    if (hostPaused) BACKGROUND_PROGRESS_INTERVAL_MS else PROGRESS_INTERVAL_MS
                )
            } else {
                isProgressRunning = false
            }
        }
    }

    init {
        reactContext.addLifecycleEventListener(this)
        mainHandler.post {
            if (!invalidated) MusicPlayback.listener = playbackListener
            ensurePlayer()
        }
    }

    override fun onHostPause() {
        hostPaused = true
    }

    override fun onHostResume() {
        hostPaused = false
        val p = player ?: return
        // One position, so the UI is correct immediately rather than up to 500 ms stale.
        emitProgress(p.currentPosition / 1000.0, (if (p.duration > 0) p.duration else 0L) / 1000.0)
        emitPlaybackState()
        // Back to the foreground rate now, not after the slow tick already queued.
        stopProgressUpdates()
        if (p.isPlaying) startProgressUpdates()
    }

    /** Playback deliberately outlives the Activity; nothing to tear down here. */
    override fun onHostDestroy() = Unit

    private var playerListener: Player.Listener? = null

    private fun ensurePlayer(): ExoPlayer {
        val existing = player
        if (existing != null) {
            return existing
        }

        val p = GlidePlayerHolder.getOrCreateAudioPlayer(reactContext)
        if (invalidated) return p
        player = p

        // Events only. What the player does -- skipping failed files, the equalizer, the
        // sleep timer -- is MusicPlayback's, so it carries on with no JS attached.
        var listener = playerListener
        if (listener == null) {
            listener = object : Player.Listener {
                override fun onIsPlayingChanged(isPlaying: Boolean) {
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

                override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                    emitTrackChanged()
                }

                override fun onPlayerError(error: PlaybackException) {
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
                    MusicPlayback.resetErrors()
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

                    MusicPlayback.setBands(p, bandLevels)

                    p.prepare()
                    // A slow build can land after the user has left. Starting then is refused
                    // audio focus (API 35+) and a foreground service, so it would play mute
                    // or not at all: load it paused, ready for Play.
                    val play = playWhenReady && !hostPaused
                    p.playWhenReady = play

                    if (play) {
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
                MusicPlayback.setSleepTimer(ensurePlayer(), minutes, pauseAtEndOfMediaItem)
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
                MusicPlayback.clearSleepTimer(ensurePlayer())
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
                MusicPlayback.resetErrors()
                val p = ensurePlayer()
                GlidePlayerHolder.start(reactContext, p)
                // Prepares an idle player (after an error or stop) and restarts an ended queue;
                // a bare play() does neither, so the button just flipped back.
                Util.handlePlayButtonAction(p)
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
                // The listener stays: the player is never released, and music started later
                // from Auto or a Bluetooth button still has to reach the UI.
                MusicPlayback.clearSleepTimer(ensurePlayer())
                stopProgressUpdates()
                GlidePlayerHolder.clearAudio(reactContext)
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
                MusicPlayback.resetErrors()
                val p = player
                if (p != null && index >= 0 && index < p.mediaItemCount) {
                    p.seekToDefaultPosition(index)
                    Util.handlePlayButtonAction(p)
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
                val p = ensurePlayer()
                val bands = GlideEqualizer.toBandLevels(levels)
                if (bands == null) MusicPlayback.clearBands(p) else MusicPlayback.setBands(p, bands)
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
        invalidated = true
        super.invalidate()
        reactContext.removeLifecycleEventListener(this)
        mainHandler.post {
            stopProgressUpdates()
            if (MusicPlayback.listener === playbackListener) MusicPlayback.listener = null
            playerListener?.let {
                player?.removeListener(it)
            }
            playerListener = null
            player = null
            // The player, its equalizer and any sleep timer all carry on: they belong to
            // MusicPlayback, and music plays straight through a JS reload or OTA restart.
        }
    }
}
