package com.glide.app.player

import android.util.Log
import androidx.media3.common.util.UnstableApi
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.glide.app.haptic.HapticDirector
import com.glide.app.haptic.HapticMeaning

/**
 * Only the props that are actually implemented are declared. A prop that is absent here is
 * absent on purpose: subtitles, enhancement, the equalizer, audio delay, resize modes, title
 * and artist, and PiP all belong to later steps, and declaring a no-op setter for each would
 * hide which of them are really wired.
 */
@UnstableApi
class GlidePlayerViewManager : SimpleViewManager<GlidePlayerView>() {

    override fun getName() = REACT_CLASS

    override fun createViewInstance(context: ThemedReactContext) = GlidePlayerView(context)

    override fun onDropViewInstance(view: GlidePlayerView) {
        view.cleanUpResources()
        super.onDropViewInstance(view)
    }

    /** After every prop in one update is set: open the media once, with all of them. */
    override fun onAfterUpdateTransaction(view: GlidePlayerView) {
        super.onAfterUpdateTransaction(view)
        view.applyPendingOpen()
    }

    override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> {
        return GlidePlayerView.EVENTS.associateWith { mapOf("registrationName" to it) }
    }

    @ReactProp(name = "source")
    fun setSource(view: GlidePlayerView, src: ReadableMap?) = view.setSource(src)

    @ReactProp(name = "paused", defaultBoolean = false)
    fun setPaused(view: GlidePlayerView, paused: Boolean) = view.setPaused(paused)

    @ReactProp(name = "rate", defaultFloat = 1f)
    fun setRate(view: GlidePlayerView, rate: Float) = view.setRate(rate)

    @ReactProp(name = "haptics", defaultBoolean = false)
    fun setHaptics(view: GlidePlayerView, enabled: Boolean) = view.setHaptics(enabled)

    /** [{startMs, endMs, text}] of the SDH subtitle's tagged cues; empty or null for none. */
    @ReactProp(name = "hapticCues")
    fun setHapticCues(view: GlidePlayerView, cues: ReadableArray?) = view.setHapticCues(
        (0 until (cues?.size() ?: 0)).mapNotNull { i ->
            cues!!.getMap(i)?.let { HapticMeaning.Cue(it.getInt("startMs"), it.getInt("endMs"), it.getString("text") ?: "") }
        }
    )

    /** "subtle", "cinematic" or "intense". */
    @ReactProp(name = "hapticPreset")
    fun setHapticPreset(view: GlidePlayerView, preset: String?) = view.setHapticPreset(
        HapticDirector.Preset.entries.firstOrNull { it.name.equals(preset, ignoreCase = true) } ?: HapticDirector.Preset.CINEMATIC
    )

    /** Slider position 0..1, on a dB scale ([HapticDirector.strength]). */
    @ReactProp(name = "hapticStrength", defaultFloat = 1f)
    fun setHapticStrength(view: GlidePlayerView, level: Float) = view.setHapticStrength(HapticDirector.strength(level))

    @ReactProp(name = "muted", defaultBoolean = false)
    fun setMuted(view: GlidePlayerView, muted: Boolean) = view.setMuted(muted)

    @ReactProp(name = "repeat", defaultBoolean = false)
    fun setRepeat(view: GlidePlayerView, repeat: Boolean) = view.setRepeat(repeat)

    @ReactProp(name = "playInBackground", defaultBoolean = false)
    fun setPlayInBackground(view: GlidePlayerView, enabled: Boolean) =
        view.setPlayInBackground(enabled)

    @ReactProp(name = "audioTrack", defaultInt = -1)
    fun setAudioTrack(view: GlidePlayerView, id: Int) {
        if (id >= 0) view.setAudioTrack(id)
    }

    @ReactProp(name = "pipEnabled", defaultBoolean = false)
    fun setPipEnabled(view: GlidePlayerView, enabled: Boolean) = view.setPipEnabled(enabled)

    @ReactProp(name = "title")
    fun setTitle(view: GlidePlayerView, title: String?) = view.setVideoTitle(title)

    @ReactProp(name = "artist")
    fun setArtist(view: GlidePlayerView, artist: String?) = view.setVideoArtist(artist)

    /** Ordinal among the container's subtitle streams, or -1 to disable. Bitmap subs only. */
    @ReactProp(name = "textTrack", defaultInt = -1)
    fun setTextTrack(view: GlidePlayerView, ordinal: Int) = view.setTextTrack(ordinal)

    @ReactProp(name = "resizeMode")
    fun setResizeMode(view: GlidePlayerView, mode: String?) = view.setResizeMode(mode)

    @ReactProp(name = "audioEqualizer")
    fun setAudioEqualizer(view: GlidePlayerView, bands: ReadableArray?) =
        view.setAudioEqualizer(bands)

    /** 100..200; above 100 is gain on top of a maxed system stream. */
    @ReactProp(name = "volumeBoost", defaultInt = 100)
    fun setVolumeBoost(view: GlidePlayerView, percent: Int) = view.setVolumeBoost(percent)

    /** Milliseconds; positive plays the audio later. */
    @ReactProp(name = "audioDelay", defaultInt = 0)
    fun setAudioDelay(view: GlidePlayerView, ms: Int) = view.setAudioDelay(ms)

    @ReactProp(name = "videoEnhancement", defaultBoolean = false)
    fun setVideoEnhancement(view: GlidePlayerView, enabled: Boolean) =
        view.setVideoEnhancement(enabled)

    @ReactProp(name = "videoEnhancementStrength", defaultFloat = 1f)
    fun setVideoEnhancementStrength(view: GlidePlayerView, strength: Float) =
        view.setVideoEnhancementStrength(strength)

    @ReactProp(name = "progressUpdateInterval", defaultFloat = 0f)
    fun setProgressUpdateInterval(view: GlidePlayerView, intervalMs: Float) =
        view.setProgressUpdateInterval(intervalMs.toLong())

    // Same command ids as RCTVLCPlayer, so VLCPlayer.tsx dispatches to either engine
    // without knowing which one it has.
    override fun getCommandsMap(): Map<String, Int> = mapOf(
        "pausePlayer" to 4,
        "stopPlayer" to 5,
        "enterPictureInPicture" to 6,
        "seek" to 7,
        "previewSeek" to 8
    )

    override fun receiveCommand(view: GlidePlayerView, commandId: String, args: ReadableArray?) {
        when (commandId) {
            "pausePlayer" -> view.pausePlayer()
            "stopPlayer" -> view.stopPlayer()
            "enterPictureInPicture" -> view.enterPictureInPicture()
            "seek" -> args?.let { view.seekTo(it.getDouble(0).toLong(), exact = true) }
            "previewSeek" -> args?.let { view.seekTo(it.getDouble(0).toLong(), exact = false) }
            else -> Unit
        }
    }

    /** Bundles from before API level 2 send the numeric ids. Kept for them only. */
    @Deprecated("Use the String overload")
    override fun receiveCommand(view: GlidePlayerView, commandId: Int, args: ReadableArray?) {
        val name = commandsMap.entries.firstOrNull { it.value == commandId }?.key ?: return
        receiveCommand(view, name, args)
    }

    private companion object {
        const val REACT_CLASS = "RCTGlidePlayer"
    }
}
