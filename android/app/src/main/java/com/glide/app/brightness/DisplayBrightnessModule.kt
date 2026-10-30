package com.glide.app.brightness

import android.app.Activity
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.view.WindowManager
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

/**
 * DisplayBrightnessModule manages window-level brightness for the video player.
 *
 * <p>
 * Only adjusts window brightness (0.0f to 1.0f). Never writes to global system settings
 * (Settings.System) to ensure the user's system brightness is never altered permanently.
 * </p>
 */
@ReactModule(name = DisplayBrightnessModule.NAME)
class DisplayBrightnessModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    companion object {
        const val NAME = "DisplayBrightnessModule"
        private const val TAG = "DisplayBrightnessModule"
        private const val BRIGHTNESS_RELEASE_VALUE = -1.0f
    }

    init {
        reactContext.addLifecycleEventListener(this)
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun setBrightness(brightness: Float) {
        applyBrightness(brightness)
    }

    @ReactMethod
    fun resetBrightness() {
        resetWindowBrightness()
    }

    @ReactMethod
    fun getBrightness(promise: Promise) {
        val activity = reactContext.currentActivity
        if (activity == null) {
            promise.reject("ERROR", "No activity available")
            return
        }

        activity.runOnUiThread {
            try {
                val params = activity.window?.attributes
                var brightness = params?.screenBrightness ?: BRIGHTNESS_RELEASE_VALUE

                // If window brightness is default (-1.0), read system brightness
                if (brightness < 0f) {
                    try {
                        val systemBrightness = Settings.System.getInt(
                            reactContext.contentResolver,
                            Settings.System.SCREEN_BRIGHTNESS
                        )
                        brightness = systemBrightness / 255.0f
                    } catch (e: Exception) {
                        brightness = 0.5f
                    }
                }

                val finalBrightness = brightness.coerceIn(0.0f, 1.0f)
                promise.resolve(finalBrightness)
            } catch (e: Exception) {
                Log.e(TAG, "Error getting brightness", e)
                promise.reject("ERROR", e.message)
            }
        }
    }

    private fun applyBrightness(brightness: Float) {
        val clamped = brightness.coerceIn(0.0f, 1.0f)
        val activity = reactContext.currentActivity ?: return
        activity.runOnUiThread {
            try {
                val window = activity.window ?: return@runOnUiThread
                val params = window.attributes
                if (Build.VERSION.SDK_INT >= 35) {
                    params.desiredHdrHeadroom = 1.0f
                }
                params.screenBrightness = clamped
                window.attributes = params
            } catch (e: Exception) {
                Log.e(TAG, "Error setting brightness", e)
            }
        }
    }

    private fun resetWindowBrightness() {
        val activity = reactContext.currentActivity ?: return
        activity.runOnUiThread {
            try {
                val window = activity.window ?: return@runOnUiThread
                val params = window.attributes
                params.screenBrightness = BRIGHTNESS_RELEASE_VALUE
                window.attributes = params
            } catch (e: Exception) {
                Log.e(TAG, "Error resetting brightness", e)
            }
        }
    }

    override fun onHostResume() {}

    override fun onHostPause() {}

    override fun onHostDestroy() {
        Log.i(TAG, "onHostDestroy - resetting window brightness")
        resetWindowBrightness()
    }
}
