package com.glide.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

/**
 * What this APK's native layer can do, for a JS bundle that may be newer than it.
 *
 * JS ships over the air and native only with an APK, so a bundle can reach an APK that is
 * months older than the code it was built from. Stallion scopes releases to versionName,
 * which covers the normal case; this covers the rest. JS checks [API_LEVEL] before calling
 * anything native that was added after level 1 (src/native/GlideNative.ts), and falls back
 * when it is lower, rather than crashing on `undefined is not a function`.
 *
 * Bump [API_LEVEL] in the same commit as any change to a native method, prop, command,
 * event or constant, and note what the level added below.
 *
 * 1: everything up to the native freeze (2026-10).
 * 2: PipModule.currentActivityName(); MediaStoreVideoModule emits onVideoLibraryChanged;
 *    RCTGlidePlayer takes commands by name.
 * 3: MediaStoreVideoModule.deleteVideos resolves false when the user cancels the system
 *    delete dialog (it rejected E_DELETE_CANCELLED before).
 * 4: GlideAudioPlayerModule.getCurrentState() includes sleepTimerMode, sleepTimerMinutes
 *    and sleepTimerEndsAt (epoch ms).
 * 5: GlideAudioPlayerModule.moveInShuffleOrder(index, toPosition) reorders the shuffled
 *    play order without touching the queue order.
 * 6: MediaStoreVideoModule.shareVideo(pathOrUri) opens the share sheet with the video's
 *    MediaStore link (replaces react-native-share and its FileProvider).
 * 7: SubtitleSyncModule.readSubtitleFromZip(zipPath) returns the subtitle text inside a zip,
 *    capped and never extracted to disk (replaces react-native-zip-archive).
 * 8: constant `env`, a JSON object of the build-time .env strings JS reads (API keys,
 *    endpoints; replaces react-native-config).
 * 9: VideoOrientation.getCutoutRects() returns the camera cutout rects in dp.
 * 10: HapticsLab module (runSeams, runCalibration, runDecode, runPlayer), the dev screen
 *     behind Settings > Version.
 * 11: GlidePlayer prop `haptics` (HapticPerformer plays the cached track); HapticsLab.importTruth;
 *     HapticModule drops vibrateWaveform, cancel and hasAmplitudeControl.
 * 12: GlidePlayer prop `haptics` analyses the film's audio itself (HapticListener) and caches the track.
 * 13: GlidePlayer props `pipHasPrevious`/`pipHasNext` and events `onPipPrevious`/`onPipNext`:
 *     the PiP window's own previous/play-pause/next buttons.
 * 14: HapticsLab module is debug-only; release builds no longer register it.
 * 15: constant `env` holds only AI_PROXY_URL; the SubDL and OMDb keys and URLs moved to the Worker.
 * 16: GlidePlayer prop `haptics` also recognises the film's sounds (HapticRecognizer, YAMNet).
 * 17: GlidePlayer emits onVideoError ERROR_CODE_AUDIO_UNSUPPORTED for audio with no decoder and
 *     plays on without sound; follows http->https redirects; plays extensionless HLS/DASH opened
 *     by MIME type; GlideNative.setCrashReportsEnabled(enabled) (CrashReports.kt);
 *     GlideAudioPlayerModule emits onAudioSkippedUnplayable { title, skipped, allFailed } for a
 *     song that will not play; VideoOrientation.getSystemGestureInsets() (Back-gesture strips, dp).
 * 18: GlidePlayer plays smb:// URIs; GlideSmb module (encrypt, setServers, list, speedTest).
 */
class GlideNativeModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    override fun getConstants(): Map<String, Any> = mapOf(
        "apiLevel" to API_LEVEL,
        "versionName" to BuildConfig.VERSION_NAME,
        "versionCode" to BuildConfig.VERSION_CODE,
        "env" to BuildConfig.JS_ENV,
    )

    @ReactMethod
    fun setCrashReportsEnabled(enabled: Boolean) = CrashReports.setEnabled(reactApplicationContext, enabled)

    companion object {
        const val NAME = "GlideNative"
        const val API_LEVEL = 19
    }

    class Package : ReactPackage {
        override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
            listOf(GlideNativeModule(reactContext))

        override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
            listOf(KeyboardInsetView.Manager())
    }
}
