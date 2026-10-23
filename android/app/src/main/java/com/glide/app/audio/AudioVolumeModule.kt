package com.glide.app.audio

import android.content.ContentResolver
import android.content.Context
import android.content.res.Configuration
import android.database.ContentObserver
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.KeyEvent
import androidx.annotation.RequiresApi
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.module.annotations.ReactModule
import java.util.Locale

/**
 * AudioVolumeModule manages audio volume, hardware button events, and audio routing.
 *
 * <p>
 * Handles music stream volume adjustments, volume queries, audio device/routing changes,
 * and route-aware limits (speaker capped at 100%, external routes allowing boost up to 200%).
 * </p>
 */
@ReactModule(name = AudioVolumeModule.NAME)
class AudioVolumeModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    companion object {
        const val NAME = "AudioVolumeModule"
        private const val TAG = "AudioVolumeModule"

        // Route type constants
        const val ROUTE_SPEAKER = "speaker"
        const val ROUTE_BLUETOOTH = "bluetooth"
        const val ROUTE_WIRED = "wired"
        const val ROUTE_USB = "usb"
        const val ROUTE_UNKNOWN = "unknown"

        fun detectRoute(am: AudioManager?): String {
            if (am == null) return ROUTE_SPEAKER
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                detectCurrentRouteModern(am)
            } else {
                detectCurrentRouteLegacy(am)
            }
        }

        /**
         * Whether audio is coming out of the phone's own speaker right now, read fresh. The
         * video player asks this before applying any boost above 100%, which a phone speaker
         * must never get. Static, so the answer never depends on a module having been built.
         */
        @JvmStatic
        fun isOnSpeaker(context: Context): Boolean =
            ROUTE_SPEAKER == detectRoute(context.getSystemService(AudioManager::class.java))

        @RequiresApi(Build.VERSION_CODES.M)
        private fun detectCurrentRouteModern(am: AudioManager): String {
            // The real route for music, rather than every port the device owns. Only
            // Android 13 and newer can answer that; below it, fall back to the scan.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                activeMediaRoute(am)?.let { return it }
            }

            val devices = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            var detectedRoute = ROUTE_SPEAKER

            for (device in devices) {
                val classified = classifyDevice(device)
                if (classified == ROUTE_BLUETOOTH) {
                    return ROUTE_BLUETOOTH
                } else if (classified == ROUTE_USB) {
                    detectedRoute = ROUTE_USB
                } else if (classified == ROUTE_WIRED && detectedRoute != ROUTE_USB) {
                    detectedRoute = ROUTE_WIRED
                }
            }

            return detectedRoute
        }

        /**
         * The device music is actually routed to. Null when the platform cannot say, so
         * the caller falls back to scanning every output port.
         */
        @RequiresApi(Build.VERSION_CODES.TIRAMISU)
        private fun activeMediaRoute(am: AudioManager): String? {
            val attributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                .build()
            val devices = try {
                am.getAudioDevicesForAttributes(attributes)
            } catch (e: RuntimeException) {
                Log.w(TAG, "could not read the active media route: ${e.message}")
                return null
            }
            for (device in devices) {
                if (device.isSource) continue
                val route = classifyDevice(device)
                // An unrecognised output is the speaker's problem to own, not a reason to
                // hand back a route that would unlock boost. Only a known one answers here.
                if (route != ROUTE_UNKNOWN) return route
            }
            return null
        }

        @Suppress("DEPRECATION")
        private fun detectCurrentRouteLegacy(am: AudioManager): String {
            return when {
                am.isBluetoothA2dpOn -> ROUTE_BLUETOOTH
                am.isWiredHeadsetOn -> ROUTE_WIRED
                else -> ROUTE_SPEAKER
            }
        }

        @RequiresApi(Build.VERSION_CODES.M)
        private fun classifyDevice(device: AudioDeviceInfo): String = routeForDeviceType(device.type)

        /**
         * An output port's type mapped to the route the boost rules care about. Anything
         * unrecognised stays [ROUTE_UNKNOWN], and every caller treats that as the speaker:
         * boost reaching the built-in speaker is the one outcome worth failing safe on.
         */
        @JvmStatic
        fun routeForDeviceType(type: Int): String {
            return when (type) {
                AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
                AudioDeviceInfo.TYPE_BUILTIN_EARPIECE,
                AudioDeviceInfo.TYPE_TELEPHONY,
                AudioDeviceInfo.TYPE_BUILTIN_SPEAKER_SAFE -> ROUTE_SPEAKER

                AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
                AudioDeviceInfo.TYPE_HEARING_AID,
                AudioDeviceInfo.TYPE_BLE_HEADSET,
                AudioDeviceInfo.TYPE_BLE_SPEAKER,
                AudioDeviceInfo.TYPE_BLE_BROADCAST -> ROUTE_BLUETOOTH

                AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                AudioDeviceInfo.TYPE_WIRED_HEADSET,
                AudioDeviceInfo.TYPE_LINE_ANALOG,
                AudioDeviceInfo.TYPE_LINE_DIGITAL,
                AudioDeviceInfo.TYPE_AUX_LINE,
                AudioDeviceInfo.TYPE_HDMI,
                AudioDeviceInfo.TYPE_HDMI_ARC,
                AudioDeviceInfo.TYPE_HDMI_EARC,
                AudioDeviceInfo.TYPE_DOCK,
                AudioDeviceInfo.TYPE_FM,
                AudioDeviceInfo.TYPE_FM_TUNER,
                AudioDeviceInfo.TYPE_TV_TUNER -> ROUTE_WIRED

                AudioDeviceInfo.TYPE_USB_HEADSET,
                AudioDeviceInfo.TYPE_USB_ACCESSORY,
                AudioDeviceInfo.TYPE_USB_DEVICE -> ROUTE_USB

                else -> ROUTE_UNKNOWN
            }
        }

        // Event names
        private const val EVENT_VOLUME_CHANGE = "onVolumeChange"
        private const val EVENT_ROUTE_CHANGE = "onAudioRouteChange"
        private const val EVENT_VOLUME_KEY = "onVolumeKey"

        // Timing constants
        private const val APP_CHANGE_DEBOUNCE_MS = 200L
        private const val VOLUME_FLAG_CLEAR_DELAY_MS = 50L
        private const val ROUTE_CHANGE_DEBOUNCE_MS = 100L
        private const val DUPLICATE_VOLUME_EVENT_DEBOUNCE_MS = 400L
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var audioManager: AudioManager? = null
    private var contentResolver: ContentResolver? = null

    /** See [getMaxVolumeForRoute]. */
    private val isTv = (reactContext.resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK) ==
        Configuration.UI_MODE_TYPE_TELEVISION

    // Audio routing state
    @Volatile
    var currentRoute: String = ROUTE_SPEAKER
        private set

    @Volatile
    var currentMaxVolume: Int = 100
        private set

    // Lifecycle state
    @Volatile
    var isListening: Boolean = false
        private set

    // Volume change detection (prevents feedback loops)
    @Volatile
    private var isAppChangingVolume: Boolean = false

    private var pendingVolumeFlagClear: Runnable? = null
    private var pendingRouteChange: Runnable? = null

    @Volatile
    private var lastAppVolumeChangeTime: Long = 0

    @Volatile
    private var lastEmittedVolumePercentage: Int = -1

    @Volatile
    private var lastEmittedVolumeEventTime: Long = 0

    // Observers and callbacks
    private var volumeObserver: ContentObserver? = null
    private var audioDeviceCallback: AudioDeviceCallback? = null

    init {
        reactContext.addLifecycleEventListener(this)
        try {
            audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
            contentResolver = reactContext.contentResolver
            if (audioManager == null) {
                Log.e(TAG, "AudioManager is null - audio features will be disabled")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error initializing audio services", e)
        }
        Log.d(TAG, "AudioVolumeModule initialized (API ${Build.VERSION.SDK_INT})")
    }

    override fun getName(): String = NAME

    // =========================================================================
    // VOLUME CONTROL
    // =========================================================================

    /**
     * Sets system volume with route-aware limits.
     *
     * @param percentage Volume level (0-200)
     * @param promise React Native promise for result callback
     */
    @ReactMethod
    fun setVolume(percentage: Int, promise: Promise) {
        val am = audioManager
        if (am == null) {
            promise.reject("ERROR", "AudioManager not available")
            return
        }

        try {
            synchronized(this) {
                isAppChangingVolume = true
                lastAppVolumeChangeTime = System.currentTimeMillis()
            }

            var effectivePercentage = percentage.coerceIn(0, currentMaxVolume)
            if (ROUTE_SPEAKER == currentRoute && effectivePercentage > 100) {
                effectivePercentage = 100
            }

            val systemPercentage = effectivePercentage.coerceAtMost(100)
            val maxSystemVolume = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            val targetVolume = Math.round((systemPercentage / 100f) * maxSystemVolume)

            am.setStreamVolume(AudioManager.STREAM_MUSIC, targetVolume, 0)

            scheduleVolumeFlagClear()

            val result = Arguments.createMap().apply {
                putInt("volume", effectivePercentage)
                putInt("maxVolume", currentMaxVolume)
                putString("route", currentRoute)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Error setting volume", e)
            promise.reject("ERROR", e.message)
        }
    }

    /**
     * Fast synchronous volume setter for gesture performance.
     *
     * @param percentage Volume level (0-200)
     */
    @ReactMethod
    fun setVolumeSync(percentage: Int) {
        val am = audioManager ?: return

        try {
            synchronized(this) {
                isAppChangingVolume = true
                lastAppVolumeChangeTime = System.currentTimeMillis()
            }

            var effectivePercentage = percentage.coerceIn(0, currentMaxVolume)
            if (ROUTE_SPEAKER == currentRoute && effectivePercentage > 100) {
                effectivePercentage = 100
            }

            val systemPercentage = effectivePercentage.coerceAtMost(100)
            val maxSystemVolume = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            val targetVolume = Math.round((systemPercentage / 100f) * maxSystemVolume)

            am.setStreamVolume(AudioManager.STREAM_MUSIC, targetVolume, 0)

            scheduleVolumeFlagClear()
        } catch (e: Exception) {
            Log.e(TAG, "Error in setVolumeSync", e)
        }
    }

    /**
     * Gets current system volume as percentage.
     */
    @ReactMethod
    fun getVolume(promise: Promise) {
        val am = audioManager
        if (am == null) {
            promise.reject("ERROR", "AudioManager not available")
            return
        }

        try {
            val currentVolume = am.getStreamVolume(AudioManager.STREAM_MUSIC)
            val maxVolume = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            val percentage = if (maxVolume > 0) Math.round((currentVolume / maxVolume.toFloat()) * 100) else 0

            val result = Arguments.createMap().apply {
                putInt("volume", percentage)
                putInt("maxVolume", currentMaxVolume)
                putString("route", currentRoute)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting volume", e)
            promise.reject("ERROR", e.message)
        }
    }

    // =========================================================================
    // AUDIO ROUTE DETECTION
    // =========================================================================

    /**
     * Gets current audio route and its volume limit.
     */
    @ReactMethod
    fun getCurrentRoute(promise: Promise) {
        try {
            val route = detectCurrentRoute()
            val maxVol = getMaxVolumeForRoute(route)

            currentRoute = route
            currentMaxVolume = maxVol

            val result = Arguments.createMap().apply {
                putString("route", route)
                putInt("maxVolume", maxVol)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting route", e)
            promise.reject("ERROR", e.message)
        }
    }

    fun detectCurrentRoute(): String = detectRoute(audioManager)

    /**
     * 100 on TV whatever the route: a TV owns HDMI/ARC/line ports, so below Android 13 the port
     * scan calls its own speakers "wired", and the HUD drew 100% as half of 200. Boost is out
     * of reach there anyway (no volume swipe; the remote's keys go to the system).
     */
    fun getMaxVolumeForRoute(route: String): Int {
        return if (ROUTE_SPEAKER == route || isTv) 100 else 200
    }


    // =========================================================================
    // LISTENERS & EVENT HANDLING
    // =========================================================================

    @ReactMethod
    fun startListening() {
        if (isListening) {
            Log.d(TAG, "Already listening, ignoring startListening call")
            return
        }

        Log.i(TAG, "Starting audio volume listeners")
        isListening = true

        currentRoute = detectCurrentRoute()
        currentMaxVolume = getMaxVolumeForRoute(currentRoute)
        Log.d(TAG, "Initial route: $currentRoute, maxVolume: $currentMaxVolume")

        registerVolumeObserver()
        registerAudioDeviceCallback()
    }

    @ReactMethod
    fun stopListening() {
        if (!isListening) {
            Log.d(TAG, "Not listening, ignoring stopListening call")
            return
        }

        Log.i(TAG, "Stopping audio volume listeners")
        isListening = false

        cancelPendingAudioCallbacks()
        unregisterVolumeObserver()
        unregisterAudioDeviceCallback()
    }

    private fun registerVolumeObserver() {
        if (volumeObserver != null || contentResolver == null) {
            return
        }

        try {
            volumeObserver = object : ContentObserver(mainHandler) {
                override fun onChange(selfChange: Boolean) {
                    handleVolumeObserverChange(null)
                }

                override fun onChange(selfChange: Boolean, uri: Uri?) {
                    handleVolumeObserverChange(uri)
                }
            }

            contentResolver?.registerContentObserver(
                Settings.System.CONTENT_URI,
                true,
                volumeObserver!!
            )
            Log.d(TAG, "Volume observer registered")
        } catch (e: Exception) {
            Log.e(TAG, "Error registering volume observer", e)
        }
    }

    private fun handleVolumeObserverChange(uri: Uri?) {
        if (uri != null && !isVolumeRelatedSettingsUri(uri)) {
            return
        }

        synchronized(this) {
            val now = System.currentTimeMillis()
            if (isAppChangingVolume || (now - lastAppVolumeChangeTime < APP_CHANGE_DEBOUNCE_MS)) {
                return
            }
        }

        handleHardwareVolumeChange()
    }

    private fun unregisterVolumeObserver() {
        val observer = volumeObserver
        if (observer != null && contentResolver != null) {
            try {
                contentResolver?.unregisterContentObserver(observer)
                volumeObserver = null
                Log.d(TAG, "Volume observer unregistered")
            } catch (e: Exception) {
                Log.e(TAG, "Error unregistering volume observer", e)
            }
        }
    }

    private fun getSystemVolumePercentage(): Int {
        val am = audioManager ?: return 0
        val currentVolume = am.getStreamVolume(AudioManager.STREAM_MUSIC)
        val maxVolume = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        return if (maxVolume > 0) Math.round((currentVolume / maxVolume.toFloat()) * 100) else 0
    }

    private fun handleHardwareVolumeChange() {
        val am = audioManager ?: return

        try {
            val now = System.currentTimeMillis()
            val percentage = getSystemVolumePercentage()

            if (percentage == lastEmittedVolumePercentage &&
                (now - lastEmittedVolumeEventTime) < DUPLICATE_VOLUME_EVENT_DEBOUNCE_MS) {
                return
            }

            lastEmittedVolumePercentage = percentage
            lastEmittedVolumeEventTime = now

            Log.d(TAG, "Hardware volume change detected: $percentage%")

            val params = Arguments.createMap().apply {
                putInt("volume", percentage)
                putInt("maxVolume", currentMaxVolume)
                putString("route", currentRoute)
                putBoolean("fromHardware", true)
            }
            sendEvent(EVENT_VOLUME_CHANGE, params)
        } catch (e: Exception) {
            Log.e(TAG, "Error handling hardware volume change", e)
        }
    }

    private fun registerAudioDeviceCallback() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || audioManager == null) {
            return
        }

        try {
            audioDeviceCallback = object : AudioDeviceCallback() {
                override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) {
                    Log.d(TAG, "Audio devices added: ${addedDevices?.size ?: 0}")
                    handleRouteChange()
                }

                override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) {
                    Log.d(TAG, "Audio devices removed: ${removedDevices?.size ?: 0}")
                    handleRouteChange()
                }
            }

            audioManager?.registerAudioDeviceCallback(audioDeviceCallback, mainHandler)
            Log.d(TAG, "Audio device callback registered")
        } catch (e: Exception) {
            Log.e(TAG, "Error registering audio device callback", e)
        }
    }

    private fun unregisterAudioDeviceCallback() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || audioManager == null || audioDeviceCallback == null) {
            return
        }

        try {
            audioManager?.unregisterAudioDeviceCallback(audioDeviceCallback)
            audioDeviceCallback = null
            Log.d(TAG, "Audio device callback unregistered")
        } catch (e: Exception) {
            Log.e(TAG, "Error unregistering audio device callback", e)
        }
    }

    private fun scheduleVolumeFlagClear() {
        pendingVolumeFlagClear?.let { mainHandler.removeCallbacks(it) }
        val clearRunnable = Runnable {
            pendingVolumeFlagClear = null
            synchronized(this) {
                isAppChangingVolume = false
            }
        }
        pendingVolumeFlagClear = clearRunnable
        mainHandler.postDelayed(clearRunnable, VOLUME_FLAG_CLEAR_DELAY_MS)
    }

    private fun cancelPendingAudioCallbacks() {
        pendingVolumeFlagClear?.let {
            mainHandler.removeCallbacks(it)
            pendingVolumeFlagClear = null
        }
        pendingRouteChange?.let {
            mainHandler.removeCallbacks(it)
            pendingRouteChange = null
        }
    }

    private fun handleRouteChange() {
        pendingRouteChange?.let { mainHandler.removeCallbacks(it) }
        val routeRunnable = Runnable {
            pendingRouteChange = null
            val previousRoute = currentRoute
            val newRoute = detectCurrentRoute()
            val newMaxVolume = getMaxVolumeForRoute(newRoute)

            if (newRoute != previousRoute) {
                currentRoute = newRoute
                currentMaxVolume = newMaxVolume

                Log.i(TAG, "Route changed: $previousRoute -> $newRoute")

                val params = Arguments.createMap().apply {
                    putString("route", newRoute)
                    putString("previousRoute", previousRoute)
                    putInt("maxVolume", newMaxVolume)
                    putInt("volume", getSystemVolumePercentage())
                }
                sendEvent(EVENT_ROUTE_CHANGE, params)
            }
        }
        pendingRouteChange = routeRunnable
        mainHandler.postDelayed(routeRunnable, ROUTE_CHANGE_DEBOUNCE_MS)
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        if (reactContext.hasActiveReactInstance()) {
            try {
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    ?.emit(eventName, params)
            } catch (e: Exception) {
                Log.e(TAG, "Error sending event: $eventName", e)
            }
        }
    }

    /**
     * Hands a volume key press to JS instead of the system.
     *
     * @return true if the key was consumed
     */
    fun handleVolumeKey(keyCode: Int): Boolean {
        if (keyCode != KeyEvent.KEYCODE_VOLUME_UP && keyCode != KeyEvent.KEYCODE_VOLUME_DOWN) {
            return false
        }
        val am = audioManager
        // Fixed-volume devices (TV boxes, HDMI-CEC) ignore setStreamVolume, and consuming
        // the key stops the system forwarding it to the TV: leave it to the system.
        if (!isListening || am == null || am.isVolumeFixed || !reactContext.hasActiveReactInstance()) {
            return false
        }
        val maxVolume = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        if (maxVolume <= 0) {
            return false
        }
        val step = maxOf(1, maxVolume / 15)
        val params = Arguments.createMap().apply {
            putInt("direction", if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) 1 else -1)
            putDouble("stepPercent", step * 100.0 / maxVolume)
        }
        sendEvent(EVENT_VOLUME_KEY, params)
        return true
    }

    // =========================================================================
    // LIFECYCLE CALLBACKS
    // =========================================================================

    override fun onHostResume() {
        Log.d(TAG, "onHostResume")
    }

    override fun onHostPause() {
        Log.d(TAG, "onHostPause")
    }

    override fun onHostDestroy() {
        Log.i(TAG, "onHostDestroy - cleaning up")
        cancelPendingAudioCallbacks()
        stopListening()
    }

    /**
     * A JS reload (and an OTA restart) destroys the module without onHostDestroy, which
     * left the observer and device callback holding the old context alive.
     */
    override fun invalidate() {
        cancelPendingAudioCallbacks()
        stopListening()
        reactContext.removeLifecycleEventListener(this)
        super.invalidate()
    }

    private fun isVolumeRelatedSettingsUri(uri: Uri): Boolean {
        val uriString = uri.toString().lowercase(Locale.US)
        return uriString.contains("volume_music") ||
            uriString.contains("volume_ring") ||
            uriString.contains("volume_alarm") ||
            uriString.contains("stream_volume") ||
            uriString.contains("/volume")
    }
}
