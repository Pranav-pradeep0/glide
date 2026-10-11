package com.glide.app.orientation

import android.app.Activity
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Build
import com.facebook.react.bridge.*

/**
 * Orientation requests for the Activity in front.
 *
 * On screens 600dp and wider, Android 16 ignores requestedOrientation for apps targeting
 * 36+, so on tablets and unfolded foldables these are no-ops and the window follows the
 * device. JS should hide rotation lock there rather than offer a control that does nothing.
 */
class VideoOrientationModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "VideoOrientation"
    }

    /**
     * On the UI thread: these methods arrive on the native-modules thread, and Activity
     * window state belongs to the main one.
     */
    private fun request(orientation: (Activity) -> Int) {
        val activity = reactApplicationContext.currentActivity ?: return
        activity.runOnUiThread {
            if (!activity.isFinishing) activity.requestedOrientation = orientation(activity)
        }
    }

    /**
     * Where the camera cutout sits, as rects in dp in window coordinates (empty: none, or
     * Android 8). Insets only say how deep the cutout band is; the player needs the rects to
     * move just the controls that would sit behind a punch hole, not the whole edge.
     */
    @ReactMethod
    fun getCutoutRects(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            promise.resolve(Arguments.createArray())
            return
        }
        activity.runOnUiThread {
            val density = activity.resources.displayMetrics.density
            val rects = Arguments.createArray()
            activity.window.decorView.rootWindowInsets?.displayCutout?.boundingRects?.forEach { r ->
                rects.pushMap(Arguments.createMap().apply {
                    putDouble("left", (r.left / density).toDouble())
                    putDouble("top", (r.top / density).toDouble())
                    putDouble("right", (r.right / density).toDouble())
                    putDouble("bottom", (r.bottom / density).toDouble())
                })
            }
            promise.resolve(rects)
        }
    }

    @ReactMethod
    fun lockToPortrait() = request { ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }

    @ReactMethod
    fun lockToLandscape() = request { ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE }

    /**
     * FULL_SENSOR: all four orientations the device supports, following how it is held even
     * with system auto-rotate off, since this Activity enforces it.
     */
    @ReactMethod
    fun enableAuto() = request { ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR }

    /**
     * "Lock" means stop rotating: keep the current orientation's axis. Landscape stays
     * SENSOR_LANDSCAPE so a 180 degree flip still works.
     */
    @ReactMethod
    fun disableAuto() = request { activity ->
        if (activity.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE) {
            ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        } else {
            ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
    }

    /** Back to UNSPECIFIED: the system decides, usually following its own setting. */
    @ReactMethod
    fun release() = request { ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED }
}
