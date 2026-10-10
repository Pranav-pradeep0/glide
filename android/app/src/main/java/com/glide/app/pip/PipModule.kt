package com.glide.app.pip

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.glide.app.VideoPlayerActivity

/**
 * Reports Picture-in-Picture state to JavaScript.
 *
 * PiP itself is owned natively by the video view (see VlcPipController in the VLC
 * player module), because that is the only place that knows the video's dimensions,
 * the surface bounds and whether playback is live. This module is only the event
 * channel that lets the React tree react to a mode change, plus the one activity
 * action the external-open flow needs.
 *
 * It deliberately holds no PiP configuration. The previous version tracked aspect
 * ratio, source rect, auto-enter and a per-activity ownership map pushed down from
 * JS; clearing that state never reached the Activity, so auto-enter stayed armed
 * after the player was gone and Android would put an unrelated screen into PiP.
 */
@ReactModule(name = PipModule.NAME)
class PipModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "PipModule"
        const val PIP_MODE_CHANGED_EVENT = "onPipModeChanged"
    }

    override fun getName(): String = NAME

    /** Required by RN's built-in NativeEventEmitter. */
    @ReactMethod
    fun addListener(eventName: String) = Unit

    /** Required by RN's built-in NativeEventEmitter. */
    @ReactMethod
    fun removeListeners(count: Int) = Unit

    @ReactMethod
    fun isInPipMode(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        promise.resolve(activity != null && activity.isInPictureInPictureMode)
    }

    @ReactMethod
    fun isPipSupported(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }

        promise.resolve(
            activity.packageManager.hasSystemFeature(
                android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE
            )
        )
    }

    /**
     * Close the external player Activity. Used when playback was opened from outside the
     * app, where going "back" should dismiss it rather than exit the whole process.
     *
     * Only ever that Activity: both share one JS runtime, so a back press handled by the
     * player's JS can arrive while MainActivity is in front (the video in PiP or playing
     * in the background), and finishing the current Activity closed the library instead.
     */
    @ReactMethod
    fun finishCurrentActivity(promise: Promise) {
        val activity = reactApplicationContext.currentActivity as? VideoPlayerActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }

        activity.finish()
        promise.resolve(true)
    }

    /**
     * The simple class name of the Activity in front, or null. Synchronous because a
     * hardwareBackPress handler has to answer at once whether the press is its own: React
     * Native's back event does not say which Activity it came from.
     */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun currentActivityName(): String? =
        reactApplicationContext.currentActivity?.javaClass?.simpleName

    /** Called from the host Activity's onPictureInPictureModeChanged. */
    fun onPictureInPictureModeChanged(isInPipMode: Boolean) {
        val params = Arguments.createMap().apply {
            putBoolean("isInPipMode", isInPipMode)
        }
        sendEvent(PIP_MODE_CHANGED_EVENT, params)
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        try {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit(eventName, params)
        } catch (e: Exception) {
            android.util.Log.w(NAME, "Failed to emit $eventName: ${e.message}")
        }
    }
}
