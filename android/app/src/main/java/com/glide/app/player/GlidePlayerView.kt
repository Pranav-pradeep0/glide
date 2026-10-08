package com.glide.app.player

import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.audiofx.Equalizer
import android.media.audiofx.LoudnessEnhancer
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.SurfaceView
import android.widget.FrameLayout
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.TrackGroup
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.text.Cue
import androidx.media3.common.VideoSize
import androidx.media3.common.Effect
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.SeekParameters
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.ui.SubtitleView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.roundToLong

/**
 * The video engine. Since phase 4 it is the only one.
 *
 * The JS side is GlidePlayer.tsx, driven by usePlayerCore and VideoPlayerScreen. Covers
 * playback, audio tracks, colour enhancement, the equalizer, the six resize modes, PiP and
 * the media session.
 *
 * Subtitles: ExoPlayer decodes embedded tracks. Bitmap cues (PGS/VobSub) are drawn here by
 * SubtitleView; text cues are sent to JS (onCues) and drawn by the overlay in the user's
 * style. Downloaded and sidecar subtitle files are parsed in JS as a full cue list, which
 * is what haptics and subtitle delay need -- embedded text cues arrive only as they play.
 * Audio delay is an AudioDelayProcessor in the sink (D1 revisited: users asked for it).
 *
 * What is *not* here is the point. There is no audio-focus subsystem (ExoPlayer owns it),
 * no start-time resolver (setMediaItem takes an offset), no seek verifier or settle window
 * (seekTo is reliable and reports its own discontinuity), and no mirrored
 * paused/position/duration fields. The player is asked, never shadowed. The one retry that
 * does exist is for network IO, which is a property of the network rather than the engine.
 */
@UnstableApi
class GlidePlayerView(private val reactContext: ThemedReactContext) :
    FrameLayout(reactContext), LifecycleEventListener {

    private val surfaceView = SurfaceView(reactContext)
    private val subtitleView = SubtitleView(reactContext).apply {
        setUserDefaultStyle()
        setUserDefaultTextSize()
    }
    private var player: ExoPlayer? = null

    private val progressHandler = Handler(Looper.getMainLooper())

    // Props. Held only because they arrive before the player exists, or because ExoPlayer
    // genuinely cannot answer them -- playInBackground is our policy, not its state.
    private var sourceUri: String? = null
    private var startPositionMs: Long = C.TIME_UNSET
    private var pausedProp = false
    private var rateProp = 1.0f
    private var mutedProp = false
    private var repeatProp = false
    private var playInBackground = false
    private var progressIntervalMs: Long = 0
    private var enhancementEnabled = false
    private var videoTitle: String? = null
    private var videoArtist: String? = null
    private var equalizerBands: FloatArray? = null
    private var equalizer: Equalizer? = null
    private var volumeBoostPercent = 100
    private var loudnessEnhancer: LoudnessEnhancer? = null
    private val audioManager = reactContext.getSystemService(AudioManager::class.java)

    /**
     * Re-checks the boost the instant an output appears or disappears, in native, so
     * unplugging headphones mid-boost never reaches the speaker boosted -- not even for the
     * time it takes the route event to get through JS.
     */
    private val outputWatcher = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = applyVolumeBoost()
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = applyVolumeBoost()
    }
    private var outputWatcherRegistered = false
    private var audioDelayMs = 0
    private var audioDelayProcessor: AudioDelayProcessor? = null

    // The one thing ExoPlayer will not answer: whether onVideoLoad has already gone out for
    // this media. Duration is unknown until READY, and JS must see exactly one load.
    private var loadEmitted = false
    private var lastBuffering: Boolean? = null

    /** Consecutive recoverable IO failures; reset once playback is healthy again. */
    private var ioRetries = 0

    /**
     * Audio tracks in enumeration order. The index *is* the id JS sees, because the JS layer
     * treats track ids as opaque tokens it round-trips back to us -- it only ever displays
     * the name and hands the id to `audioTrack`. Holding the group here is what makes
     * selection a one-liner; there is no other way back from an id to a `TrackGroup`.
     */
    private val audioTracks = mutableListOf<Pair<TrackGroup, Int>>()
    private var tracksKnown = false
    private var pendingAudioTrack: Int? = null

    /**
     * The tracks JS last asked for, for this media. A re-open (enhancement toggle, IO retry)
     * builds a new player that starts on its default tracks, and JS will not resend a prop
     * that has not changed -- so without this the label said English while Hindi played.
     */
    private var chosenAudioTrack: Int? = null
    private var chosenTextTrack: Int? = null

    /**
     * Text tracks, in the order the container declares them. JS identifies a subtitle by its
     * *ordinal among subtitle streams* rather than by ffmpeg's absolute stream index, because
     * ffmpeg counts video and audio streams too and ExoPlayer does not.
     */
    private val textTracks = mutableListOf<Pair<TrackGroup, Int>>()
    private var pendingTextTrack: Int? = null

    private var videoWidth = 0
    private var videoHeight = 0
    /** Pixel aspect ratio, from VideoSize.pixelWidthHeightRatio. 1 for square pixels. */
    private var videoSar = 1f
    private var resizeMode: String? = null
    private var bestFitUsingCover: Boolean? = null
    private var lastLayoutSignature: String? = null
    private val pipController = GlidePipController(this)
    private var hostStopped = false

    private val progressTick = object : Runnable {
        override fun run() {
            val p = player
            if (p != null && progressIntervalMs > 0) {
                if (p.isPlaying) {
                    emit(EVENT_PROGRESS, eventMap())
                }
                progressHandler.postDelayed(this, progressIntervalMs)
            }
        }
    }

    init {
        addView(surfaceView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        addView(subtitleView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        reactContext.addLifecycleEventListener(this)
        pipController.attach()
    }

    // -- Geometry ------------------------------------------------------------------------

    fun setResizeMode(mode: String?) {
        if (mode == resizeMode) return
        resizeMode = mode
        // A mode change invalidates the best-fit hysteresis: it is state about a decision
        // for a mode we may no longer be in.
        bestFitUsingCover = null
        Log.d(TAG, "resizeMode=$mode")
        relayoutSurface()
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        layoutSurface(r - l, b - t)
    }

    /**
     * Re-run the child layout without waiting for a layout pass.
     *
     * `requestLayout()` is not enough here. React Native drives layout from its own shadow
     * tree and does not re-measure an Android view on request, so a resize-mode change sat
     * in the field doing nothing until something else forced a real pass -- in practice, a
     * rotation. Measured: six `resizeMode=` lines in a row with not one `layout` line
     * between them.
     */
    private fun relayoutSurface() {
        if (width > 0 && height > 0) {
            layoutSurface(width, height)
        }
    }

    private fun layoutSurface(w: Int, h: Int) {
        if (videoWidth <= 0 || videoHeight <= 0 || w <= 0 || h <= 0) {
            surfaceView.layout(0, 0, w, h)
            subtitleView.layout(0, 0, w, h)
            return
        }

        val geometry = computeGeometry(
            resizeMode, w, h, videoWidth, videoHeight, videoSar, bestFitUsingCover
        )
        geometry.bestFitUsingCover?.let { bestFitUsingCover = it }

        val childW: Int
        val childH: Int
        if (geometry.fill) {
            childW = w
            childH = h
        } else {
            childW = (videoWidth * videoSar * geometry.scale).roundToLong().toInt()
            childH = (videoHeight * geometry.scale).roundToLong().toInt()
        }
        // Centred, and deliberately allowed to exceed the view: cover, none and scale-down
        // all crop, and the parent FrameLayout clips.
        val x = (w - childW) / 2
        val y = (h - childH) / 2
        surfaceView.layout(x, y, x + childW, y + childH)
        // Subtitles go on the part of the video that is actually on screen. Laid out over the
        // whole cropped frame, a cue near the bottom of the video landed in the clipped-off
        // strip in cover, none and scale-down, and was never seen.
        subtitleView.layout(maxOf(x, 0), maxOf(y, 0), minOf(x + childW, w), minOf(y + childH, h))

        // Logged whenever the result changes, never per pass: the absence of this line
        // after a mode change is what exposed the requestLayout() problem above, so it has
        // to be a reliable signal rather than a conditional one.
        val signature = "$resizeMode/${w}x$h/${childW}x$childH"
        if (signature != lastLayoutSignature) {
            lastLayoutSignature = signature
            Log.d(
                TAG,
                "layout mode=$resizeMode view=${w}x$h video=${videoWidth}x$videoHeight " +
                    "sar=$videoSar scale=${geometry.scale} child=${childW}x$childH"
            )
        }
    }

    // -- Props ---------------------------------------------------------------------------

    fun setSource(src: ReadableMap?) {
        val uri = src?.takeIf { it.hasKey("uri") }?.getString("uri")
        if (uri.isNullOrEmpty()) {
            return
        }
        // Seconds on the wire, as VLC's :start-time was. This is the whole of resume now.
        val startSec = if (src.hasKey("startTime") && !src.isNull("startTime")) {
            src.getDouble("startTime")
        } else {
            0.0
        }
        val startMs = if (startSec > 0) (startSec * 1000).roundToLong() else C.TIME_UNSET

        if (uri == sourceUri && startMs == startPositionMs && player != null) {
            return
        }
        if (uri != sourceUri) {
            // Track ids index this media's tracks; they mean nothing for another file.
            chosenAudioTrack = null
            chosenTextTrack = null
        }
        sourceUri = uri
        startPositionMs = startMs
        openMedia()
    }

    fun setPaused(paused: Boolean) {
        pausedProp = paused
        val p = player ?: return
        // ExoPlayer ignores play in STATE_ENDED. Playing a finished video restarts it, as
        // Media3's own play button does (Util.handlePlayButtonAction).
        if (!paused && p.playbackState == Player.STATE_ENDED) {
            p.seekToDefaultPosition()
        }
        p.playWhenReady = !paused
    }

    fun setRate(rate: Float) {
        if (rate <= 0f) return
        rateProp = rate
        player?.playbackParameters = PlaybackParameters(rate)
    }

    fun setMuted(muted: Boolean) {
        mutedProp = muted
        player?.volume = if (muted) 0f else 1f
    }

    fun setRepeat(repeat: Boolean) {
        repeatProp = repeat
        player?.repeatMode = if (repeat) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
    }

    fun setPlayInBackground(enabled: Boolean) {
        playInBackground = enabled
    }

    /**
     * Select a subtitle track by its ordinal among the container's subtitle streams, or -1
     * to disable text output entirely.
     *
     * Set for embedded tracks (bitmap and text). Subtitle files JS parsed itself pass -1:
     * they are rendered from a full cue list in JS, which haptics and subtitle delay need.
     */
    fun setTextTrack(ordinal: Int) {
        chosenTextTrack = ordinal
        val p = player
        if (p == null || !tracksKnown) {
            pendingTextTrack = ordinal
            return
        }
        pendingTextTrack = null

        if (ordinal < 0) {
            p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
                .clearOverridesOfType(C.TRACK_TYPE_TEXT)
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                .build()
            subtitleView.setCues(emptyList())
            return
        }

        val entry = textTracks.getOrNull(ordinal)
        if (entry == null) {
            Log.w(TAG, "text track ordinal=$ordinal out of range (${textTracks.size} tracks)")
            return
        }
        Log.d(TAG, "text track select ordinal=$ordinal")
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            .setOverrideForType(TrackSelectionOverride(entry.first, entry.second))
            .build()
    }

    // -- Picture in picture ---------------------------------------------------------------
    // The controller is a straight port of VlcPipController: its aspect clamping, bounds
    // enforcement and ancestor-transform neutralisation were all earned against real device
    // behaviour, so it was moved rather than rewritten. The VLC copy dies with its module
    // in phase 4.

    /**
     * JS states only that PiP is currently allowed (player focused, nothing modal on top).
     * Geometry, source rect and auto-enter arming are decided here, where the video
     * dimensions and view bounds actually live.
     */
    fun setPipEnabled(enabled: Boolean) {
        pipController.setEnabled(enabled)
    }

    fun enterPictureInPicture() {
        pipController.enter()
    }


    /** Called by [GlidePipController] once the Activity has changed PiP state. */
    fun onPipModeChangedInternal(inPipMode: Boolean) {
        Log.d(TAG, if (inPipMode) "entered PiP window" else "left PiP window")
        if (!inPipMode && hostStopped && !playInBackground) {
            player?.playWhenReady = false
        }
        // The window changed size; recompute geometry once against the new bounds.
        relayoutSurface()
    }

    fun getReactActivity(): android.app.Activity? =
        try {
            reactContext.currentActivity
        } catch (e: RuntimeException) {
            null
        }

    /**
     * Notification and lock-screen metadata. Applied to the live item rather than only at
     * open, because the title arrives from JS after the source does.
     */
    fun setVideoTitle(title: String?) {
        if (title == videoTitle) return
        videoTitle = title
        updateMediaMetadata()
    }

    fun setVideoArtist(artist: String?) {
        if (artist == videoArtist) return
        videoArtist = artist
        updateMediaMetadata()
    }

    private fun updateMediaMetadata() {
        val p = player ?: return
        val uri = sourceUri ?: return
        // replaceMediaItem, not setMediaItem: setMediaItem would restart playback from the
        // beginning just to relabel the notification.
        p.replaceMediaItem(0, buildMediaItem(uri))
    }

    private fun buildMediaItem(uri: String): MediaItem =
        MediaItem.Builder()
            .setUri(uri)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(videoTitle)
                    .setArtist(videoArtist)
                    .build()
            )
            .build()

    /**
     * Ten band gains in dB, or null to switch the equalizer off. The UI's bands are fixed
     * (60Hz..16kHz) but `android.media.audiofx.Equalizer` exposes however many the device
     * implements -- five, typically -- so each device band takes the gain of the nearest
     * requested frequency. A system effect on our own audio session, rather than VLC's
     * engine-specific one.
     */
    fun setAudioEqualizer(bands: ReadableArray?) {
        equalizerBands = bands?.takeIf { it.size() > 0 }?.let { array ->
            FloatArray(array.size()) { array.getDouble(it).toFloat() }
        }
        applyEqualizer()
    }

    /**
     * Volume above 100%, for when the system stream is already at max. JS caps it at 100 on
     * the speaker; on headphones it goes to 200, which LoudnessEnhancer reaches as gain with
     * its own limiter rather than clipping samples.
     */
    fun setVolumeBoost(percent: Int) {
        volumeBoostPercent = percent.coerceIn(100, 200)
        applyVolumeBoost()
    }

    private fun applyVolumeBoost() {
        // Never on the phone's speaker. Unknown counts as speaker. Forgetting the level too
        // means plugging headphones back in does not bring the boost back by itself.
        if (volumeBoostPercent > 100 &&
            com.glide.app.audio.AudioVolumeModule.isOnSpeaker(context)) {
            volumeBoostPercent = 100
        }
        if (volumeBoostPercent > 100 && !outputWatcherRegistered) {
            audioManager?.registerAudioDeviceCallback(outputWatcher, progressHandler)
            outputWatcherRegistered = true
        } else if (volumeBoostPercent <= 100 && outputWatcherRegistered) {
            audioManager?.unregisterAudioDeviceCallback(outputWatcher)
            outputWatcherRegistered = false
        }
        if (volumeBoostPercent <= 100) {
            loudnessEnhancer?.release()
            loudnessEnhancer = null
            return
        }
        val sessionId = player?.audioSessionId ?: C.AUDIO_SESSION_ID_UNSET
        if (sessionId == C.AUDIO_SESSION_ID_UNSET) return
        try {
            val enhancer = loudnessEnhancer ?: LoudnessEnhancer(sessionId).also { loudnessEnhancer = it }
            // Amplitude ratio to millibels: 150% is +3.5 dB, 200% is +6 dB.
            enhancer.setTargetGain((2000 * log10(volumeBoostPercent / 100.0)).toInt())
            enhancer.enabled = true
        } catch (e: RuntimeException) {
            Log.w(TAG, "volume boost unavailable: ${e.message}")
            loudnessEnhancer = null
        }
    }

    /** Milliseconds; positive plays the audio later. Live, no re-open. */
    fun setAudioDelay(ms: Int) {
        audioDelayMs = ms
        audioDelayProcessor?.delayMs = ms
    }

    private fun applyEqualizer() {
        val bands = equalizerBands
        if (bands == null) {
            equalizer?.release()
            equalizer = null
            return
        }
        val sessionId = player?.audioSessionId ?: C.AUDIO_SESSION_ID_UNSET
        if (sessionId == C.AUDIO_SESSION_ID_UNSET) return

        try {
            val eq = equalizer ?: Equalizer(EQUALIZER_PRIORITY, sessionId).also { equalizer = it }
            val (minLevel, maxLevel) = eq.bandLevelRange.let { it[0] to it[1] }
            for (band in 0 until eq.numberOfBands) {
                val b = band.toShort()
                val centreHz = eq.getCenterFreq(b) / 1000
                val millibels = (nearestGainDb(bands, centreHz) * 100).toInt()
                eq.setBandLevel(b, millibels.coerceIn(minLevel.toInt(), maxLevel.toInt()).toShort())
            }
            eq.enabled = true
            Log.d(TAG, "equalizer applied bands=${eq.numberOfBands} session=$sessionId")
        } catch (e: RuntimeException) {
            // Devices legitimately refuse: no equalizer effect, or another app holds it at a
            // higher priority. Losing the equalizer must not take playback down with it.
            Log.w(TAG, "equalizer unavailable: ${e.message}")
            equalizer = null
        }
    }

    /** Gain of whichever UI band sits closest to this device band's centre frequency. */
    private fun nearestGainDb(bands: FloatArray, centreHz: Int): Float {
        val index = (0 until minOf(bands.size, EQUALIZER_BAND_HZ.size))
            .minByOrNull { abs(EQUALIZER_BAND_HZ[it] - centreHz) } ?: 0
        return bands[index]
    }

    /**
     * Colour enhancement, as GPU shaders on the frames the hardware decoder already
     * produced. The VLC path could not do this: `--video-filter=adjust` forced
     * `--no-mediacodec-dr`, which dropped the device to software 4K decode and kept it there
     * for the session, so every toggle also rebuilt the player. Here it is a list swap on a
     * running player -- no recreate, no decoder change, no sticky pipeline flag.
     */
    fun setVideoEnhancement(enabled: Boolean) {
        if (enabled == enhancementEnabled) return
        enhancementEnabled = enabled
        Log.d(TAG, "enhancement=$enabled")
        // Re-open rather than swap the effect list. Arming or disarming the frame processor
        // is a prepare-time decision (see openMedia), so the player has to be rebuilt --
        // from where it currently is, not from the top.
        val p = player ?: return
        startPositionMs = p.currentPosition.takeIf { it > 0 } ?: C.TIME_UNSET
        openMedia()
    }

    private fun buildEffects(): List<Effect> =
        if (enhancementEnabled) listOf(enhancement) else emptyList()

    /**
     * One GL effect for SDR and HDR -- see [ColorEnhancement]. Media3's obvious choice,
     * `HslAdjustment` plus `Contrast` as the migration plan proposed, cannot be used at all:
     * `HslShaderProgram` throws `IllegalArgumentException: HDR is not yet supported`, killing
     * playback on exactly the content this migration exists to fix.
     */
    private val enhancement = ColorEnhancementEffect()

    /**
     * Live: a uniform read per frame, so unlike the toggle it needs no re-open. While paused no
     * frame is drawn, so the change shows on resume. Re-seeking in place does not help: it runs
     * (BUFFERING -> READY) but media3's effects path does not redisplay a paused frame --
     * measured, the capture stayed byte-identical.
     */
    fun setVideoEnhancementStrength(strength: Float) {
        enhancement.strength = strength
    }

    /**
     * Select an audio track by the id handed out in the load event. Arrives before the media
     * is open on a remount, so it is held until the track list exists.
     *
     * No retry loop and no coalescing Handler: `TrackSelectionParameters` is accepted at any
     * time, unlike VLC's setAudioTrack, which rejected calls made too early and needed
     * `scheduleAudioTrackApply` to keep trying.
     */
    fun setAudioTrack(id: Int) {
        chosenAudioTrack = id
        val p = player
        if (p == null || !tracksKnown) {
            pendingAudioTrack = id
            return
        }
        pendingAudioTrack = null
        val entry = audioTracks.getOrNull(id)
        if (entry == null) {
            Log.w(TAG, "audio track id=$id out of range (${audioTracks.size} tracks)")
            return
        }
        Log.d(TAG, "audio track select id=$id")
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .setOverrideForType(TrackSelectionOverride(entry.first, entry.second))
            .build()
    }

    fun setProgressUpdateInterval(intervalMs: Long) {
        progressIntervalMs = intervalMs
        progressHandler.removeCallbacks(progressTick)
        if (intervalMs > 0 && player != null) {
            progressHandler.postDelayed(progressTick, intervalMs)
        }
    }

    /**
     * Seeks are view commands, not props: every call is a request, so seeking to the same
     * spot twice (two jumps back that both clamp to 0:00) works. `exact = false` is the
     * scrubber's live preview, issued every 40 ms; CLOSEST_SYNC keeps each one cheap and
     * the committed seek that follows is EXACT.
     */
    fun seekTo(positionMs: Long, exact: Boolean) {
        val p = player ?: return
        val duration = p.duration
        if (duration == C.TIME_UNSET || duration <= 0) {
            Log.w(TAG, "seek dropped position=${positionMs}ms - duration unknown")
            return
        }
        // stopPlayer() leaves the player idle. Seeking one is the revive path, and the media
        // has to be prepared again before a position means anything.
        if (p.playbackState == Player.STATE_IDLE) {
            p.prepare()
        }
        p.setSeekParameters(if (exact) SeekParameters.EXACT else SeekParameters.CLOSEST_SYNC)
        val target = positionMs.coerceIn(0L, duration)
        Log.d(TAG, "seek to ${target}ms of ${duration}ms exact=$exact")
        p.seekTo(target)
    }

    // -- Commands ------------------------------------------------------------------------

    fun pausePlayer() {
        player?.playWhenReady = false
    }

    fun stopPlayer() {
        val p = player ?: return
        p.stop()
        Log.d(TAG, "stopPlayer")
        emit(EVENT_STOPPED, eventMap().apply { putString("type", "Stopped") })
    }

    // -- Player lifecycle ----------------------------------------------------------------

    private fun isLocalUri(uriString: String): Boolean {
        val scheme = Uri.parse(uriString).scheme
        return scheme.isNullOrEmpty() ||
            scheme.equals("file", ignoreCase = true) ||
            scheme.equals("content", ignoreCase = true) ||
            scheme.equals("android.resource", ignoreCase = true)
    }

    private fun openMedia() {
        val uri = sourceUri ?: return
        releasePlayer()

        emit(EVENT_LOAD_START, Arguments.createMap())

        // MODE_ON keeps platform decoders first and falls back to the FFmpeg extension only
        // where the device has none. On the test device that is every one of AC-3, E-AC-3,
        // DTS and TrueHD, which otherwise select no track and play silently with no error.
        val delayProcessor = AudioDelayProcessor().also { it.delayMs = audioDelayMs }
        audioDelayProcessor = delayProcessor
        val renderers = object : DefaultRenderersFactory(context) {
            override fun buildAudioSink(
                context: android.content.Context,
                enableFloatOutput: Boolean,
                enableAudioOutputPlaybackParams: Boolean,
            ): AudioSink = DefaultAudioSink.Builder(context)
                .setEnableFloatOutput(enableFloatOutput)
                .setEnableAudioOutputPlaybackParameters(enableAudioOutputPlaybackParams)
                .setAudioProcessors(arrayOf(delayProcessor))
                .build()
        }.setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
            .setEnableDecoderFallback(true)

        val wakeMode = if (isLocalUri(uri)) C.WAKE_MODE_LOCAL else C.WAKE_MODE_NETWORK

        val p = ExoPlayer.Builder(context, renderers)
            // The entire audio-focus subsystem of the VLC view is this one argument. With
            // handleAudioFocus = true the app must not request or respond to focus itself;
            // ducking, transient loss and resume-on-gain are the player's business.
            // USAGE_MEDIA is required here -- any other usage throws.
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                    .build(),
                /* handleAudioFocus = */ true
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(wakeMode)
            .build()

        player = p
        loadEmitted = false
        lastBuffering = null
        ioRetries = 0
        tracksKnown = false
        audioTracks.clear()
        textTracks.clear()
        // Re-applied once the new player lists its tracks (onTracksChanged).
        pendingAudioTrack = pendingAudioTrack ?: chosenAudioTrack
        pendingTextTrack = pendingTextTrack ?: chosenTextTrack
        p.setVideoSurfaceView(surfaceView)
        p.addListener(listener)
        p.playbackParameters = PlaybackParameters(rateProp)
        p.volume = if (mutedProp) 0f else 1f
        p.repeatMode = if (repeatProp) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
        p.playWhenReady = !pausedProp

        // ONLY when enhancement is on, and never with an empty list.
        //
        // Calling setVideoEffects at all -- even with an empty list -- arms
        // DefaultVideoFrameProcessor, and that GL path tone-maps HDR to 8-bit sRGB.
        // Measured on device 2026-09-06, same file and same ExoPlayer, via SurfaceFlinger:
        //
        //   effects armed:  no BT2020 layer, every layer dataspace=V0_SRGB, colorMode=SRGB
        //   not armed:      dataspace=BT2020_ITU_PQ, colorMode=DISPLAY_P3
        //
        // On screen that is a washed-out picture with visible banding in dark scenes, on
        // HDR content only -- i.e. it silently undid the entire reason for this migration.
        // Arming it lazily is not an option either: the effects pipeline is a prepare-time
        // decision, which is why toggling enhancement re-opens the media.
        if (enhancementEnabled) {
            p.setVideoEffects(buildEffects())
        }

        Log.d(TAG, "open uri=$uri startPositionMs=$startPositionMs paused=$pausedProp " +
            "enhancement=$enhancementEnabled")
        // Resume is an argument, not a seek: no start-time resolver, no correction pass.
        p.setMediaItem(buildMediaItem(uri), startPositionMs)
        p.prepare()

        // The session describes this player directly -- no adapter mirroring its state.
        GlidePlayerHolder.start(context, p)

        if (progressIntervalMs > 0) {
            progressHandler.postDelayed(progressTick, progressIntervalMs)
        }
    }

    private fun releasePlayer() {
        progressHandler.removeCallbacksAndMessages(null)
        subtitleView.setCues(emptyList())
        equalizer?.release()
        equalizer = null
        loudnessEnhancer?.release()
        loudnessEnhancer = null
        audioDelayProcessor = null
        player?.let {
            // Before release, never after: the session must not be left holding a released
            // player. That is the defect class the VLC adapter kept producing.
            GlidePlayerHolder.clear(context, it)
            it.removeListener(listener)
            it.release()
        }
        player = null
        keepScreenOn = false
    }

    fun cleanUpResources() {
        reactContext.removeLifecycleEventListener(this)
        if (outputWatcherRegistered) {
            audioManager?.unregisterAudioDeviceCallback(outputWatcher)
            outputWatcherRegistered = false
        }
        pipController.detach()
        releasePlayer()
    }

    override fun onHostPause() {
        hostStopped = true
        // PiP is a foreground presentation even though the Activity reports paused, so it
        // must not be treated as backgrounding.
        if (!playInBackground && !pipController.isInPipMode) {
            player?.playWhenReady = false
        }
    }

    override fun onHostResume() {
        hostStopped = false
    }

    override fun onHostDestroy() {
        releasePlayer()
    }

    // -- Events --------------------------------------------------------------------------

    private val listener = object : Player.Listener {
        override fun onPlaybackStateChanged(state: Int) {
            val p = player ?: return
            Log.d(TAG, "state=${stateName(state)} duration=${p.duration}")
            when (state) {
                Player.STATE_BUFFERING -> emitBuffering(true)
                Player.STATE_READY -> {
                    // Healthy again: forgive earlier network failures so a long session
                    // is not killed by three unrelated hiccups hours apart.
                    ioRetries = 0
                    emitBuffering(false)
                    maybeEmitLoad()
                }
                Player.STATE_ENDED -> {
                    // Snap the UI to the end before announcing it, as the VLC path did.
                    emit(EVENT_PROGRESS, Arguments.createMap().apply {
                        putBoolean("isPlaying", false)
                        putDouble("position", 1.0)
                        putDouble("currentTime", p.duration.toDouble())
                        putDouble("duration", p.duration.toDouble())
                    })
                    keepScreenOn = false
                    emit(EVENT_END, eventMap().apply { putString("type", "Ended") })
                }
                else -> Unit
            }
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            keepScreenOn = isPlaying
            pipController.setPlaying(isPlaying)
            Log.d(TAG, "isPlaying=$isPlaying")
            if (isPlaying) {
                emit(EVENT_PLAYING, eventMap().apply { putString("type", "Playing") })
            } else if (player?.playbackState == Player.STATE_READY) {
                // READY and not playing is a pause. Buffering and ended have their own
                // events, and reporting either as a pause is how the old view's state got
                // out of step with the session.
                emit(EVENT_PAUSED, eventMap().apply { putString("type", "Paused") })
            }
        }

        override fun onAudioSessionIdChanged(audioSessionId: Int) {
            // The session id is not known until the audio renderer initialises, and it
            // changes across media. The effect has to follow it, so it is rebuilt here
            // rather than assumed to exist at open time.
            Log.d(TAG, "audioSessionId=$audioSessionId eq=${equalizerBands != null}")
            equalizer?.release()
            equalizer = null
            applyEqualizer()
            loudnessEnhancer?.release()
            loudnessEnhancer = null
            applyVolumeBoost()
        }

        override fun onTracksChanged(tracks: Tracks) {
            // The effects path loses the decoder's HDR metadata; the effect re-applies it.
            for (group in tracks.groups) {
                if (group.type != C.TRACK_TYPE_VIDEO) continue
                for (i in 0 until group.length) {
                    if (!group.isTrackSelected(i)) continue
                    val info = group.getTrackFormat(i).colorInfo?.hdrStaticInfo
                    enhancement.hdrMetadata = ColorEnhancement.eglHdrMetadata(info)
                    Log.d(TAG, "video hdrStaticInfo=${info?.size ?: "none"} usable=${enhancement.hdrMetadata != null}")
                }
            }
            audioTracks.clear()
            for (group in tracks.groups) {
                if (group.type != C.TRACK_TYPE_AUDIO) continue
                for (i in 0 until group.length) {
                    val format = group.getTrackFormat(i)
                    // Unsupported tracks are listed too. An E-AC-3 track with no decoder is
                    // exactly the case that used to play silently with no error; the user
                    // must be able to see it and pick it, and find out it is the FFmpeg
                    // extension that is missing rather than the track.
                    Log.d(
                        TAG,
                        "audio track ${audioTracks.size} codec=${format.sampleMimeType} " +
                            "lang=${format.language} channels=${format.channelCount} " +
                            "SUPPORTED=${group.isTrackSupported(i)} " +
                            "SELECTED=${group.isTrackSelected(i)}"
                    )
                    audioTracks.add(group.mediaTrackGroup to i)
                }
            }
            textTracks.clear()
            for (group in tracks.groups) {
                if (group.type != C.TRACK_TYPE_TEXT) continue
                for (i in 0 until group.length) {
                    val format = group.getTrackFormat(i)
                    // Logged with language so a mismatch against ffmpeg's list is visible:
                    // JS maps by ordinal, which assumes both enumerate the container's
                    // subtitle streams in the same order.
                    Log.d(
                        TAG,
                        "text track ${textTracks.size} codec=${format.sampleMimeType} " +
                            "lang=${format.language} SUPPORTED=${group.isTrackSupported(i)}"
                    )
                    textTracks.add(group.mediaTrackGroup to i)
                }
            }

            tracksKnown = true
            pendingAudioTrack?.let { setAudioTrack(it) }
            pendingTextTrack?.let { setTextTrack(it) }
            maybeEmitLoad()
        }

        override fun onCues(cueGroup: androidx.media3.common.text.CueGroup) {
            // Native draws picture subtitles only. Text cues go to JS below and are drawn
            // there, in the user's subtitle style; handing them to SubtitleView as well put
            // every line on screen twice.
            subtitleView.setCues(cueGroup.cues.filter { it.bitmap != null })
            val cueArray = Arguments.createArray()
            for (cue in cueGroup.cues) {
                val text = cue.text?.toString() ?: ""
                if (text.isNotEmpty()) {
                    cueArray.pushMap(Arguments.createMap().apply {
                        putString("text", text)
                    })
                }
            }
            val params = Arguments.createMap().apply {
                putArray("cues", cueArray)
                putDouble("presentationTimeUs", cueGroup.presentationTimeUs.toDouble())
            }
            emit(EVENT_CUES, params)
        }

        override fun onVideoSizeChanged(videoSize: VideoSize) {
            if (videoSize.width == videoWidth &&
                videoSize.height == videoHeight &&
                videoSize.pixelWidthHeightRatio == videoSar
            ) {
                return
            }
            videoWidth = videoSize.width
            videoHeight = videoSize.height
            // Anamorphic sources report a non-1 ratio here. Rotation needs no handling:
            // media3 applies it internally and width/height already account for it.
            videoSar = videoSize.pixelWidthHeightRatio.takeIf { it > 0f } ?: 1f
            Log.d(TAG, "video ${videoWidth}x$videoHeight sar=$videoSar")

            // Pin the surface buffer to the video's own dimensions.
            //
            // By default a SurfaceView sizes its buffer from its layout, and a SurfaceView
            // owns a separate compositor layer -- so every resize-mode change reallocated
            // the buffer queue, and the gap between releasing the old buffer and filling
            // the new one is the flash seen when switching modes.
            //
            // With a fixed size, changing the mode only moves and scales the *view*; the
            // buffer never changes, so there is nothing to reallocate. The decoder was
            // already producing frames at exactly this size, so nothing is resampled that
            // was not being resampled before.
            if (videoWidth > 0 && videoHeight > 0) {
                surfaceView.holder.setFixedSize(videoWidth, videoHeight)
            }
            // PiP wants the pixel ratio as a rational; media3 reports it as a float.
            pipController.setVideoGeometry(
                videoWidth, videoHeight, (videoSar * SAR_DENOMINATOR).roundToLong().toInt(),
                SAR_DENOMINATOR
            )
            requestLayout()
            relayoutSurface()
            maybeEmitLoad()
        }

        override fun onPositionDiscontinuity(
            oldPosition: Player.PositionInfo,
            newPosition: Player.PositionInfo,
            reason: Int
        ) {
            if (reason != Player.DISCONTINUITY_REASON_SEEK) return
            Log.d(TAG, "seek landed at ${newPosition.positionMs}ms")
            emit(EVENT_SEEK, eventMap().apply { putString("type", "TimeChanged") })
        }

        override fun onPlayerError(error: PlaybackException) {
            Log.e(TAG, "player error ${error.errorCodeName}", error)

            // A source/IO failure leaves ExoPlayer in STATE_IDLE permanently: playback is
            // simply dead until something calls prepare() again. LibVLC papered over this
            // with --http-reconnect, so network hiccups recovered on their own and nobody
            // had to think about it. Deleting the VLC init options deleted that too.
            //
            // Seen on a Stremio localhost stream: short seeks stayed inside the buffer and
            // worked, then a long seek forced a fresh range request, the local server
            // refused it, and the player never came back.
            //
            // ExoPlayer's own DefaultLoadErrorHandlingPolicy has already retried the load
            // before this fires, so retry a bounded number of times and slowly, then give
            // up and tell JS. Position is preserved: prepare() resumes where it stopped.
            if (error.errorCode in IO_ERROR_CODES && ioRetries < MAX_IO_RETRIES) {
                ioRetries++
                Log.w(TAG, "recoverable IO error, retry $ioRetries/$MAX_IO_RETRIES")
                progressHandler.postDelayed({ player?.prepare() }, IO_RETRY_DELAY_MS)
                return
            }

            keepScreenOn = false
            emit(EVENT_ERROR, eventMap().apply {
                putString("type", "Error")
                putString("error", error.errorCodeName)
            })
        }
    }

    private fun maybeEmitLoad() {
        val p = player ?: return
        if (loadEmitted) return
        val duration = p.duration
        if (duration == C.TIME_UNSET || duration <= 0) return
        // Both, or the load event ships a track list JS will never get a second chance at.
        if (!tracksKnown) return
        loadEmitted = true
        val info = Arguments.createMap()
        info.putDouble("duration", duration.toDouble())
        val trackArray = Arguments.createArray()
        audioTracks.forEachIndexed { id, (group, index) ->
            trackArray.pushMap(Arguments.createMap().apply {
                putInt("id", id)
                putString("name", audioTrackName(group.getFormat(index), id))
            })
        }
        info.putArray("audioTracks", trackArray)
        val subTrackArray = Arguments.createArray()
        textTracks.forEachIndexed { id, (group, index) ->
            val format = group.getFormat(index)
            // Subtitles parsed during extraction all report media3-cues; the container's own
            // mime is kept in codecs. Without this a PGS track read as text.
            val mime = (if (format.sampleMimeType == MimeTypes.APPLICATION_MEDIA3_CUES) format.codecs
                else format.sampleMimeType).orEmpty()
            val isBitmap = mime.contains("pgs") || mime.contains("vobsub") || mime.contains("dvd")
            val codec = when {
                mime.contains("subrip") || mime.contains("srt") -> "srt"
                mime.contains("pgs") -> "pgs"
                mime.contains("ssa") || mime.contains("ass") -> "ass"
                mime.contains("vtt") -> "webvtt"
                mime.contains("tx3g") || mime.contains("quicktime") -> "mov_text"
                else -> mime.substringAfterLast("/")
            }
            val lang = format.language ?: "und"
            val title = format.label ?: if (lang != "und") lang else "Subtitle ${id + 1}"
            subTrackArray.pushMap(Arguments.createMap().apply {
                putInt("id", id)
                putInt("index", id)
                putString("name", title)
                putString("title", title)
                putString("language", lang)
                putString("codec", codec)
                putBoolean("isBitmap", isBitmap)
                // Automatic subtitle choice prefers the default track and avoids forced-only ones.
                putBoolean("isDefault", format.selectionFlags and C.SELECTION_FLAG_DEFAULT != 0)
                putBoolean("isForced", format.selectionFlags and C.SELECTION_FLAG_FORCED != 0)
            })
        }
        info.putArray("subtitleTracks", subTrackArray)
        if (videoWidth > 0 && videoHeight > 0) {
            info.putMap("videoSize", Arguments.createMap().apply {
                putInt("width", videoWidth)
                putInt("height", videoHeight)
            })
        }
        Log.d(TAG, "load duration=${duration}ms audioTracks=${audioTracks.size}")
        emit(EVENT_LOAD, info)
    }

    /**
     * The language has to survive into this string: `findMatchingAudioTrack` picks the
     * preferred-language track by substring-matching the *name*, so a name of "Track 2"
     * would silently disable that preference.
     */
    private fun audioTrackName(format: androidx.media3.common.Format, id: Int): String {
        val label = format.label ?: format.language ?: "Track ${id + 1}"
        val codec = format.sampleMimeType?.substringAfter('/')?.uppercase()
        val channels = format.channelCount.takeIf { it > 0 }?.let { "${it}ch" }
        val detail = listOfNotNull(codec, channels).joinToString(" ")
        val language = format.language?.takeIf { format.label != null }
        return listOfNotNull(
            label,
            detail.takeIf { it.isNotEmpty() },
            language?.let { "[$it]" }
        ).joinToString(" - ")
    }

    private fun emitBuffering(buffering: Boolean) {
        if (lastBuffering == buffering) return
        lastBuffering = buffering
        emit(EVENT_BUFFERING, Arguments.createMap().apply {
            putBoolean("isBuffering", buffering)
            putDouble("bufferRate", if (buffering) 0.0 else 100.0)
            putString("type", "Buffering")
        })
    }

    /** The shape every VLC event carried, so the JS handlers need no branch on engine. */
    private fun eventMap(): WritableMap {
        val p = player
        val map = Arguments.createMap()
        val duration = p?.duration ?: C.TIME_UNSET
        val position = p?.currentPosition ?: 0L
        val known = duration != C.TIME_UNSET && duration > 0
        map.putBoolean("isPlaying", p?.isPlaying ?: false)
        map.putDouble("position", if (known) position.toDouble() / duration else 0.0)
        map.putDouble("currentTime", position.toDouble())
        map.putDouble("duration", if (known) duration.toDouble() else 0.0)
        return map
    }

    /**
     * `getJSModule(RCTEventEmitter)` -- what the VLC view still uses -- works only through
     * the New Architecture interop shim, and logs an "Unhandled SoftException" for *every*
     * event saying it will stop working once interop is disabled. The events did arrive,
     * but a migration whose entire method is reading device logs cannot afford one stack
     * trace per progress tick.
     */
    private fun emit(event: String, map: WritableMap) {
        val dispatcher = UIManagerHelper.getEventDispatcherForReactTag(reactContext, id) ?: return
        dispatcher.dispatchEvent(GlideVideoEvent(UIManagerHelper.getSurfaceId(this), id, event, map))
    }

    private class GlideVideoEvent(
        surfaceId: Int,
        viewTag: Int,
        private val name: String,
        private val payload: WritableMap
    ) : Event<GlideVideoEvent>(surfaceId, viewTag) {
        override fun getEventName() = name
        override fun getEventData() = payload
    }

    private fun stateName(state: Int) = when (state) {
        Player.STATE_IDLE -> "IDLE"
        Player.STATE_BUFFERING -> "BUFFERING"
        Player.STATE_READY -> "READY"
        Player.STATE_ENDED -> "ENDED"
        else -> "?$state"
    }

    companion object {
        const val TAG = "GlidePlayer"

        /** Media3's IO/source failures. Everything in the 2000 block is worth retrying. */
        private val IO_ERROR_CODES = 2000..2999
        private const val MAX_IO_RETRIES = 3
        private const val IO_RETRY_DELAY_MS = 1500L

        /** Denominator used to express media3's float pixel ratio as a rational for PiP. */
        private const val SAR_DENOMINATOR = 10000

        /** Matches src/config/equalizerPresets.ts. Ten gains arrive in this order. */
        private val EQUALIZER_BAND_HZ =
            intArrayOf(60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000)
        private const val EQUALIZER_PRIORITY = 0

        const val EVENT_LOAD_START = "onVideoLoadStart"
        const val EVENT_LOAD = "onVideoLoad"
        const val EVENT_PROGRESS = "onVideoProgress"
        const val EVENT_SEEK = "onVideoSeek"
        const val EVENT_END = "onVideoEnd"
        const val EVENT_PLAYING = "onVideoPlaying"
        const val EVENT_PAUSED = "onVideoPaused"
        const val EVENT_STOPPED = "onVideoStopped"
        const val EVENT_BUFFERING = "onVideoBuffering"
        const val EVENT_ERROR = "onVideoError"
        const val EVENT_CUES = "onCues"

        val EVENTS = arrayOf(
            EVENT_LOAD_START, EVENT_LOAD, EVENT_PROGRESS, EVENT_SEEK, EVENT_END,
            EVENT_PLAYING, EVENT_PAUSED, EVENT_STOPPED, EVENT_BUFFERING, EVENT_ERROR,
            EVENT_CUES
        )
    }
}
