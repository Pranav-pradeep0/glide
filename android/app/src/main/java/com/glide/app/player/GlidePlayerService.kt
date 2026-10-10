package com.glide.app.player

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionError
import com.glide.app.MainActivity
import com.glide.app.audio.MediaStoreAudioModule
import com.glide.app.audio.MusicPlayback
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import java.util.concurrent.Executors

/**
 * Where the video view, the music module and the session service find each other.
 *
 * They live in one process but are created independently by the system, and an Intent
 * cannot carry an object reference.
 *
 * Main thread only, which is where the views, the module's player calls and the service run.
 */
@UnstableApi
object GlidePlayerHolder {

    /** The video view's player, while a video is open. */
    @JvmStatic
    var videoPlayer: ExoPlayer? = null
        private set

    /** The music player. Process-scoped: it outlives JS reloads and is never released. */
    @JvmStatic
    var audioPlayer: ExoPlayer? = null
        private set

    /**
     * The Activity the open video is playing in, so its notification reopens that screen
     * rather than a guess. Null while only music is playing.
     */
    @JvmStatic
    var videoHostActivity: Class<out Activity>? = null
        private set

    private var service: GlidePlayerService? = null

    fun attachService(value: GlidePlayerService?) {
        service = value
    }

    @Synchronized
    fun getOrCreateAudioPlayer(context: Context): ExoPlayer {
        audioPlayer?.let { return it }
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        // The renderers the video view already builds. EXTENSION_RENDERER_MODE_ON lets the
        // FFmpeg extension cover AC-3, E-AC-3, DTS and ALAC on devices with no decoder for
        // them -- without it those files select no audio track and play silently -- and
        // decoder fallback retries in software rather than failing the track outright.
        val renderers = DefaultRenderersFactory(context.applicationContext)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
            .setEnableDecoderFallback(true)

        val newPlayer = ExoPlayer.Builder(context.applicationContext, renderers)
            .setAudioAttributes(audioAttributes, /* handleAudioFocus = */ true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .build()

        MusicPlayback.attach(context, newPlayer)
        audioPlayer = newPlayer
        return newPlayer
    }

    /**
     * A player is about to play. Only one plays at a time, and the one session follows it:
     * the notification, lock screen, Bluetooth and Auto all show and drive this player.
     */
    fun start(context: Context, value: ExoPlayer, hostActivity: Class<out Activity>? = null) {
        if (value === audioPlayer) {
            videoPlayer?.pause()
            service?.showMusic()
        } else {
            audioPlayer?.pause()
            videoPlayer = value
            videoHostActivity = hostActivity
            service?.showVideo(value)
        }
        if (service == null) {
            // A plain start, never startForegroundService: that promises startForeground
            // within seconds, which a paused or failing player never reaches -- the
            // ForegroundServiceDidNotStartInTimeException this used to crash with. Media3
            // promotes the service itself once playback is actually ongoing.
            try {
                context.applicationContext.startService(
                    Intent(context.applicationContext, GlidePlayerService::class.java)
                )
            } catch (e: IllegalStateException) {
                // Background start not allowed. Playback still works; only the notification
                // waits until the next start from the foreground.
                Log.w(GlidePlayerView.TAG, "could not start playback service: ${e.message}")
            }
        }
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    /** Must be called *before* the video player is released, so no session holds it. */
    fun clear(context: Context, value: ExoPlayer) {
        if (videoPlayer !== value) {
            // A newer view already took over; leave its registration alone.
            return
        }
        videoPlayer = null
        videoHostActivity = null
        // Back to music, which also drops the video's notification: the music player's
        // empty queue posts none.
        service?.showMusic()
        mainHandler.post { stopServiceIfIdle(context) }
    }

    /** The music queue was cleared. The player itself stays; the music session is built on it. */
    fun clearAudio(context: Context) {
        audioPlayer?.let {
            it.stop()
            it.clearMediaItems()
        }
        mainHandler.post { stopServiceIfIdle(context) }
    }

    private fun stopServiceIfIdle(context: Context) {
        if (videoPlayer != null || (audioPlayer?.mediaItemCount ?: 0) > 0) return
        try {
            context.applicationContext.stopService(
                Intent(context.applicationContext, GlidePlayerService::class.java)
            )
        } catch (e: IllegalStateException) {
            Log.w(GlidePlayerView.TAG, "could not stop playback service: ${e.message}")
        }
    }

    fun isPlaybackOngoing(): Boolean = listOfNotNull(videoPlayer, audioPlayer).any {
        it.playWhenReady && it.mediaItemCount > 0 &&
            it.playbackState != Player.STATE_ENDED && it.playbackState != Player.STATE_IDLE
    }
}

/**
 * Owns the media session and its notification.
 *
 * One [MediaLibrarySession], created here rather than by the React Native module, so a
 * controller binding cold -- Android Auto, a Bluetooth head unit, Assistant -- finds a
 * working session with no JS running. It drives whichever player is in use: the
 * process-wide music player, or the video view's while a video plays. One session, not
 * one per player: Media3 has a single notification slot, so two sessions took it from each
 * other -- a stale video notification whose Play started music, a playing video losing its
 * notification and foreground service to a music event -- and Auto listed the app twice.
 *
 * ExoPlayer *is* a Media3 `Player`, so it is handed to the session directly. There is no
 * adapter mirroring engine state, and so none of the divergence bugs that came with one.
 */
@UnstableApi
class GlidePlayerService : MediaLibraryService() {

    private var session: MediaLibrarySession? = null
    private val library = MoreExecutors.listeningDecorator(
        Executors.newSingleThreadExecutor { Thread(it, "glide-media-library") }
    )

    private val musicActivity by lazy {
        PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
    }

    /**
     * Where the video notification leads: the Activity the video is actually playing in.
     * Both are `singleTask`, so SINGLE_TOP alone brings the running instance forward with
     * the player still on screen. CLEAR_TOP would finish it instead.
     */
    private fun videoActivity(): PendingIntent = PendingIntent.getActivity(
        this,
        1,
        Intent(this, GlidePlayerHolder.videoHostActivity ?: MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        },
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    override fun onCreate() {
        super.onCreate()
        GlidePlayerHolder.attachService(this)

        // Registered explicitly: onGetSession only runs when a controller connects, and
        // Glide's own UI drives the players directly, so without this the service would
        // never observe the player or post a notification.
        session = MediaLibrarySession.Builder(
            this,
            GlidePlayerHolder.getOrCreateAudioPlayer(this),
            LibraryCallback()
        )
            .setId(SESSION_ID)
            .setSessionActivity(musicActivity)
            .build()
            .also { addSession(it) }

        GlidePlayerHolder.videoPlayer?.let { showVideo(it) }
        Log.w(GlidePlayerView.TAG, "media session created")
    }

    /** The video view's player is in use. It must not be released while the session holds it. */
    fun showVideo(player: ExoPlayer) = show(player, videoActivity())

    fun showMusic() {
        GlidePlayerHolder.audioPlayer?.let { show(it, musicActivity) }
    }

    private fun show(player: ExoPlayer, activity: PendingIntent) {
        val s = session ?: return
        // Both players live on the main looper, which setPlayer requires.
        if (s.player !== player) s.player = player
        s.setSessionActivity(activity)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? =
        session

    /**
     * No super: Media3's default also pauses everything when no player `isPlaying()` at that
     * instant -- buffering, between tracks, or suppressed by a phone call -- so swiping the
     * task away then stopped music for good. Ongoing means playWhenReady, not isPlaying.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        GlidePlayerHolder.audioPlayer?.let { MusicPlayback.save(it) }
        if (!GlidePlayerHolder.isPlaybackOngoing()) {
            pauseAllPlayersAndStopSelf()
        }
    }

    override fun onDestroy() {
        GlidePlayerHolder.audioPlayer?.let { MusicPlayback.save(it) }
        session?.let {
            removeSession(it)
            it.release()
        }
        session = null
        library.shutdown()
        GlidePlayerHolder.attachService(null)
        super.onDestroy()
    }

    // ================= Browse tree (Android Auto and other media browsers) =================

    /**
     * Root -> Songs -> every song, in the library screen's order. Picking a song plays on
     * through the rest of the list, as tapping a song in the app does.
     *
     * ponytail: artwork is a file:// URI that Auto cannot read, so songs show no art there;
     * serve it through a ContentProvider if that matters. A queue started from Auto is not
     * the JS store's queue; the app shows the playing song only once it is in that queue.
     */
    private inner class LibraryCallback : MediaLibrarySession.Callback {

        @Volatile private var songs: Pair<Long, List<MediaStoreAudioModule.SongRecord>>? = null

        /** Paging calls arrive in bursts; one scan serves a burst rather than one per page. */
        private fun allSongs(): List<MediaStoreAudioModule.SongRecord> {
            val now = SystemClock.elapsedRealtime()
            songs?.takeIf { now - it.first < SONGS_TTL_MS }?.let { return it.second }
            return MediaStoreAudioModule.queryAllSongs(this@GlidePlayerService).also { songs = now to it }
        }

        /**
         * The service is exported, so any app can bind it, and the browse tree is the whole
         * music library. Only controllers that could read that library themselves get in:
         * Glide, the system (notification, Bluetooth, Auto, Assistant), controllers the user
         * trusts (notification listeners), and apps holding the audio permission.
         */
        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo
        ): MediaSession.ConnectionResult =
            if (mayBrowse(controller)) {
                super.onConnect(session, controller)
            } else {
                Log.w(GlidePlayerView.TAG, "Rejected media controller ${controller.packageName}")
                MediaSession.ConnectionResult.reject()
            }

        override fun onGetLibraryRoot(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            params: LibraryParams?
        ): ListenableFuture<LibraryResult<MediaItem>> =
            Futures.immediateFuture(LibraryResult.ofItem(folder(ROOT_ID, "Glide"), params))

        override fun onGetChildren(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            parentId: String,
            page: Int,
            pageSize: Int,
            params: LibraryParams?
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> = library.submit<LibraryResult<ImmutableList<MediaItem>>> {
            val children = when (parentId) {
                ROOT_ID -> listOf(folder(SONGS_ID, "Songs"))
                SONGS_ID -> allSongs().map(::playable)
                else -> return@submit LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
            }
            val from = (page.toLong() * pageSize).coerceIn(0, children.size.toLong()).toInt()
            val to = (from.toLong() + pageSize).coerceIn(0, children.size.toLong()).toInt()
            LibraryResult.ofItemList(children.subList(from, to), params)
        }

        override fun onGetItem(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            mediaId: String
        ): ListenableFuture<LibraryResult<MediaItem>> = library.submit<LibraryResult<MediaItem>> {
            MediaStoreAudioModule.getSongById(this@GlidePlayerService, mediaId)
                ?.let { LibraryResult.ofItem(playable(it), null) }
                ?: LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
        }

        override fun onSetMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
            startIndex: Int,
            startPositionMs: Long
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            useMusicPlayer()
            return library.submit<MediaSession.MediaItemsWithStartPosition> { setItems(mediaItems, startIndex, startPositionMs) }
        }

        private fun setItems(
            mediaItems: List<MediaItem>,
            startIndex: Int,
            startPositionMs: Long
        ): MediaSession.MediaItemsWithStartPosition {
            if (mediaItems.size == 1) {
                val all = allSongs()
                val index = all.indexOfFirst { it.id == mediaItems[0].mediaId }
                if (index >= 0) {
                    return MediaSession.MediaItemsWithStartPosition(all.map(::playable), index, startPositionMs)
                }
            }
            val resolved = resolve(mediaItems)
            // resolve() can drop items, which would leave startIndex past the end.
            val index = if (startIndex == C.INDEX_UNSET) startIndex else startIndex.coerceAtMost(resolved.size - 1)
            return MediaSession.MediaItemsWithStartPosition(resolved, index, startPositionMs)
        }

        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>
        ): ListenableFuture<MutableList<MediaItem>> {
            useMusicPlayer()
            return library.submit<MutableList<MediaItem>> { resolve(mediaItems).toMutableList() }
        }

        /**
         * Bluetooth Play with the app gone, or the System UI resume card: the queue
         * [MusicPlayback] saved, resolved against MediaStore again. Songs deleted since
         * drop out; if the current one is among them, playback starts from the top.
         */
        override fun onPlaybackResumption(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            isForPlayback: Boolean
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            useMusicPlayer()
            return library.submit<MediaSession.MediaItemsWithStartPosition> {
                val saved = MusicPlayback.savedQueue(this@GlidePlayerService)
                    ?: throw UnsupportedOperationException("nothing to resume")
                val records = MediaStoreAudioModule.getSongsByIds(this@GlidePlayerService, saved.ids)
                val items = saved.ids.mapNotNull { id -> records[id]?.let(::playable) }
                if (items.isEmpty()) throw UnsupportedOperationException("nothing to resume")
                val (index, positionMs) = saved.startIn(items.map { it.mediaId })
                MediaSession.MediaItemsWithStartPosition(items, index, positionMs)
            }
        }

        /**
         * A controller asking for songs means music, whatever the session shows now. Called
         * on the main thread before Media3 applies the items, so they land on the music
         * player rather than the video's.
         */
        private fun useMusicPlayer() {
            GlidePlayerHolder.audioPlayer?.let { GlidePlayerHolder.start(this@GlidePlayerService, it) }
        }

        /**
         * Browsers send ids only; give each item back its URI. An id that resolves to nothing
         * -- a song deleted while Auto still lists it, or an Assistant search, which sends
         * no id at all -- is dropped: handed on without a URI, it threw in the media source
         * factory. Nothing left fails the command instead of clearing the queue.
         */
        private fun resolve(items: List<MediaItem>): List<MediaItem> {
            val records = MediaStoreAudioModule.getSongsByIds(this@GlidePlayerService, items.map { it.mediaId })
            val playable = items.mapNotNull { item ->
                records[item.mediaId]?.let(::playable) ?: item.takeIf { it.localConfiguration != null }
            }
            if (playable.isEmpty()) throw UnsupportedOperationException("no playable items")
            return playable
        }
    }

    private fun mayBrowse(controller: MediaSession.ControllerInfo): Boolean {
        if (controller.uid == Process.myUid() || controller.isTrusted) return true
        // A binding app is visible to us, so its uid resolves despite package visibility.
        val packages = packageManager.getPackagesForUid(controller.uid) ?: return false
        val audioPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.READ_MEDIA_AUDIO
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }
        return packages.any { pkg ->
            val system = try {
                packageManager.getApplicationInfo(pkg, 0).flags and ApplicationInfo.FLAG_SYSTEM != 0
            } catch (e: PackageManager.NameNotFoundException) {
                false
            }
            system || packageManager.checkPermission(audioPermission, pkg) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun folder(id: String, title: String): MediaItem = MediaItem.Builder()
        .setMediaId(id)
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(title)
                .setIsBrowsable(true)
                .setIsPlayable(false)
                .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)
                .build()
        )
        .build()

    private fun playable(record: MediaStoreAudioModule.SongRecord): MediaItem = MediaItem.Builder()
        .setMediaId(record.id)
        .setUri(Uri.parse(record.uri))
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(record.title)
                .setArtist(record.artist)
                .setAlbumTitle(record.album)
                .setIsBrowsable(false)
                .setIsPlayable(true)
                .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
                .build()
        )
        .build()

    private companion object {
        const val SESSION_ID = "glide"
        const val ROOT_ID = "root"
        const val SONGS_ID = "songs"
        const val SONGS_TTL_MS = 30_000L
    }
}
