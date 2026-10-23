package com.glide.app.player

import android.app.Activity
import android.view.FocusFinder
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.ref.WeakReference

/**
 * The TV remote in the video player. Stock React Native has no TV key handling, so the
 * Activity hands every key to [dispatch] first, and the player's JS sets the rules ahead of
 * time instead of being asked per key:
 *
 *  - [HIDDEN] (controls hidden): the D-pad is the player's. Every press goes to JS, none to
 *    the focus system, so focus can't wander onto controls that can't be seen.
 *  - [FOCUS] (controls up): the D-pad moves focus as usual, kept inside the player screen, or
 *    inside the topmost overlay (a panel, a modal) while one is open. Left / Right on the seek
 *    bar scrub instead. JS still hears each press, unconsumed, to hold off the auto-hide.
 *
 * Fast forward, rewind, next and previous are always the player's: the session would seek by
 * its own increments with no readout, and its player only ever holds the one video. Play /
 * pause stays with the media session (GlidePlayerService), which already toggles the player;
 * JS only hears it.
 *
 * [OFF] (the default, phones, any other screen) leaves every key alone.
 */
@ReactModule(name = TvRemoteModule.NAME)
class TvRemoteModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

    companion object {
        const val NAME = "TvRemoteModule"
        const val EVENT = "onTvRemoteKey"
        const val OFF = 0
        const val HIDDEN = 1
        const val FOCUS = 2

        private const val FOCUS_TRIES = 10
        private const val FOCUS_RETRY_MS = 40L

        private val KEYS = mapOf(
            KeyEvent.KEYCODE_DPAD_UP to "up",
            KeyEvent.KEYCODE_DPAD_DOWN to "down",
            KeyEvent.KEYCODE_DPAD_LEFT to "left",
            KeyEvent.KEYCODE_DPAD_RIGHT to "right",
            KeyEvent.KEYCODE_DPAD_CENTER to "center",
            KeyEvent.KEYCODE_ENTER to "center",
            KeyEvent.KEYCODE_NUMPAD_ENTER to "center",
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD to "fastForward",
            KeyEvent.KEYCODE_MEDIA_REWIND to "rewind",
            KeyEvent.KEYCODE_MEDIA_NEXT to "next",
            KeyEvent.KEYCODE_MEDIA_PREVIOUS to "previous",
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE to "playPause",
            KeyEvent.KEYCODE_MEDIA_PLAY to "playPause",
            KeyEvent.KEYCODE_MEDIA_PAUSE to "playPause",
        )
        private val ALWAYS_OURS = setOf(
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
            KeyEvent.KEYCODE_MEDIA_REWIND,
            KeyEvent.KEYCODE_MEDIA_NEXT,
            KeyEvent.KEYCODE_MEDIA_PREVIOUS,
        )
        private val DIRECTIONS = mapOf(
            KeyEvent.KEYCODE_DPAD_UP to View.FOCUS_UP,
            KeyEvent.KEYCODE_DPAD_DOWN to View.FOCUS_DOWN,
            KeyEvent.KEYCODE_DPAD_LEFT to View.FOCUS_LEFT,
            KeyEvent.KEYCODE_DPAD_RIGHT to View.FOCUS_RIGHT,
        )
        private val PLAY_PAUSE = setOf(
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
            KeyEvent.KEYCODE_MEDIA_PLAY,
            KeyEvent.KEYCODE_MEDIA_PAUSE,
        )

        // Main thread only: the methods below post there, and keys arrive there.
        private var mode = OFF
        private var screenId = View.NO_ID
        private var seekBarId = View.NO_ID
        /** Where focus starts in the screen when nothing has it: Play. */
        private var homeId = View.NO_ID
        /** Open overlays' view ids, topmost last. Focus stays inside the last. */
        private val overlays = ArrayList<Int>()
        /** Where focus starts in each open overlay (its own id when none was given). */
        private val starts = HashMap<Int, Int>()
        /** The window [guardFocus] watches; one listener per window. */
        private var guarded: WeakReference<View>? = null
        /**
         * A key has reached the player since it opened. Before that, what has focus is only
         * Android's first pick (the back arrow), not something the viewer chose to come back to.
         */
        private var keyed = false
        /** What had focus before the first overlay opened, to give it back when the last closes. */
        private var opener: WeakReference<View>? = null
        /**
         * Keys whose press was the player's: their release is too, whatever the mode is by then.
         * OK shows the controls and focuses Play; its release reaching Play would press it again.
         */
        private val held = HashSet<Int>()
        private var module: WeakReference<TvRemoteModule>? = null

        /** From the Activity's dispatchKeyEvent. True: the key was the player's, stop there. */
        fun dispatch(activity: Activity, event: KeyEvent): Boolean {
            if (mode == OFF && held.isEmpty()) return false
            val code = event.keyCode
            val name = KEYS[code] ?: return false
            if (event.action == KeyEvent.ACTION_UP) {
                if (!held.remove(code)) return false
                emit(name, event, consumed = true)
                return true
            }
            if (event.action != KeyEvent.ACTION_DOWN || mode == OFF) return false
            keyed = true

            val focused = activity.currentFocus
            val noOverlay = overlays.isEmpty()
            val ours = code in ALWAYS_OURS ||
                (noOverlay && mode == HIDDEN && code !in PLAY_PAUSE) ||
                (noOverlay && seekBarId != View.NO_ID && focused?.id == seekBarId &&
                    (code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_DPAD_RIGHT))
            if (ours) {
                held.add(code)
                emit(name, event, consumed = true)
                return true
            }
            if (event.repeatCount == 0) emit(name, event, consumed = false)
            val direction = DIRECTIONS[code] ?: return false
            return contain(activity, focused, direction)
        }

        /**
         * Lets the focus system move focus when it stays in scope; otherwise moves it within the
         * scope, or not at all. False: let the normal handling (ScrollView's included) do it.
         */
        private fun contain(activity: Activity, focused: View?, direction: Int): Boolean {
            val scope = activity.findViewById<View>(overlays.lastOrNull() ?: screenId) as? ViewGroup
                ?: return false
            if (focused == null || !isInside(scope, focused)) {
                // Nothing focused yet (the controls start up), or focus was lost: in, not across.
                val home = if (overlays.isEmpty()) activity.findViewById<View>(homeId) else null
                if (home?.requestFocus() != true) scope.requestFocus(direction)
                return true
            }
            val root = activity.window.decorView as? ViewGroup ?: return false
            val next = FocusFinder.getInstance().findNextFocus(root, focused, direction)
            if (next != null && isInside(scope, next)) return false
            FocusFinder.getInstance().findNextFocus(scope, focused, direction)?.requestFocus(direction)
            return true
        }

        private fun isInside(scope: View, view: View): Boolean {
            var v: Any? = view
            while (v is View) {
                if (v === scope) return true
                v = v.parent
            }
            return false
        }

        private fun emit(key: String, event: KeyEvent, consumed: Boolean) {
            val context = module?.get()?.reactApplicationContext ?: return
            if (!context.hasActiveReactInstance()) return
            val params = Arguments.createMap().apply {
                putString("key", key)
                putString("action", if (event.action == KeyEvent.ACTION_UP) "up" else "down")
                putInt("repeat", event.repeatCount)
                putBoolean("consumed", consumed)
            }
            try {
                context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    ?.emit(EVENT, params)
            } catch (e: Exception) {
                android.util.Log.w(NAME, "Failed to emit $EVENT: ${e.message}")
            }
        }
    }

    init {
        module = WeakReference(this)
    }

    override fun getName(): String = NAME

    /** Required by RN's built-in NativeEventEmitter. */
    @ReactMethod
    fun addListener(eventName: String) = Unit

    /** Required by RN's built-in NativeEventEmitter. */
    @ReactMethod
    fun removeListeners(count: Int) = Unit

    /**
     * The player screen's view, its seek bar and where focus starts (Play), by React tag (a
     * Fabric view's id); -1 for none.
     */
    @ReactMethod
    fun setMode(value: Int, screenTag: Int, seekBarTag: Int, homeTag: Int) {
        UiThreadUtil.runOnUiThread {
            val opening = mode == OFF && value == FOCUS
            if (mode == OFF && value != OFF) keyed = false
            mode = value
            screenId = screenTag
            seekBarId = seekBarTag
            homeId = homeTag
            // The player opens with its controls up: start on Play, not on whatever Android picks
            // first (the back arrow, where OK leaves the video). An overlay opening sets its own.
            if (opening && overlays.isEmpty() && homeTag != View.NO_ID) focusWhenShown(homeTag, FOCUS_TRIES)
        }
    }

    /** An overlay opened: focus goes into it (or to [focusTag] in it) and stays there. */
    @ReactMethod
    fun pushScope(tag: Int, focusTag: Int) {
        UiThreadUtil.runOnUiThread {
            if (overlays.isEmpty()) {
                opener = reactApplicationContext.currentActivity?.currentFocus?.takeIf { keyed }?.let { WeakReference(it) }
            }
            overlays.remove(tag)
            overlays.add(tag)
            starts[tag] = if (focusTag != View.NO_ID) focusTag else tag
            guardFocus()
            focusWhenShown(starts.getValue(tag), FOCUS_TRIES)
        }
    }

    /** An overlay closed. The last one gives focus back to what opened the first. */
    @ReactMethod
    fun popScope(tag: Int) {
        UiThreadUtil.runOnUiThread {
            starts.remove(tag)
            if (!overlays.remove(tag) || overlays.isNotEmpty()) return@runOnUiThread
            // Opened by the app (Continue watching, an error) rather than from a button: start on Play.
            val back = opener?.get()?.takeIf { it.isAttachedToWindow && it.isShown }
            if (back != null) back.requestFocus() else if (mode != OFF && homeId != View.NO_ID) focusWhenShown(homeId, FOCUS_TRIES)
            opener = null
        }
    }

    /**
     * Keys alone can't keep focus in an overlay: when the focused view is removed or re-created
     * under it, Android hands focus to the window's first focusable view (the player's back
     * arrow), and OK there leaves the video. Any focus that lands outside the topmost overlay
     * goes back to where that overlay starts.
     */
    private fun guardFocus() {
        val decor = reactApplicationContext.currentActivity?.window?.decorView ?: return
        if (guarded?.get() === decor) return
        guarded = WeakReference(decor)
        decor.viewTreeObserver.addOnGlobalFocusChangeListener { _, now ->
            val top = overlays.lastOrNull() ?: return@addOnGlobalFocusChangeListener
            val scope = decor.findViewById<View>(top) ?: return@addOnGlobalFocusChangeListener
            if (now == null || !isInside(scope, now)) focusWhenShown(starts[top] ?: top, FOCUS_TRIES)
        }
    }

    /** Focus this view, or the first focusable view inside it. */
    @ReactMethod
    fun focus(tag: Int) {
        UiThreadUtil.runOnUiThread { focusWhenShown(tag, FOCUS_TRIES) }
    }

    /**
     * A view JS has just rendered may not be mounted, or may still be display: none, when this
     * runs: try again for a few frames.
     */
    private fun focusWhenShown(tag: Int, tries: Int) {
        val view = reactApplicationContext.currentActivity?.findViewById<View>(tag)
        if (view != null && view.isShown && (view.hasFocus() || view.requestFocus())) return
        if (tries > 0) UiThreadUtil.runOnUiThread({ focusWhenShown(tag, tries - 1) }, FOCUS_RETRY_MS)
    }

    override fun invalidate() {
        // A reload: the new JS starts with the remote left alone.
        UiThreadUtil.runOnUiThread {
            mode = OFF
            overlays.clear()
            starts.clear()
            held.clear()
            opener = null
        }
        super.invalidate()
    }
}
