package com.glide.app

import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowInsetsController
import androidx.lifecycle.Lifecycle
import com.swmansion.rnscreens.fragment.restoration.RNScreensFragmentFactory
import com.facebook.react.ReactActivity
import com.facebook.react.ReactApplication
import com.glide.app.audio.AudioVolumeModule

/**
 * Base activity for Glide React Native activities.
 *
 * Implements unified hardware volume key handling so that both MainActivity
 * and VideoPlayerActivity silently intercept volume keys and dispatch volume events
 * to React Native without triggering the Android system volume UI overlay.
 */
open class GlideBaseActivity : ReactActivity() {

    /**
     * Both React trees use native-stack, whose fragments throw if the FragmentManager tries
     * to restore them -- after process death, or any config change configChanges does not
     * cover (language, font scale). The factory makes restoration hand back empty fragments
     * that React then replaces. Must be set before super.onCreate.
     */
    override fun onCreate(savedInstanceState: Bundle?) {
        supportFragmentManager.fragmentFactory = RNScreensFragmentFactory()
        super.onCreate(savedInstanceState)
        keepSystemGesturesWithBarsHidden()
    }

    /**
     * react-native-edge-to-edge sets BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE on every SystemBars
     * change. With the bars hidden (the player with its controls hidden) that mode spends an
     * edge swipe on revealing the bars, so Back did nothing until a tap brought them back.
     * BEHAVIOR_DEFAULT keeps system gestures working whatever the bars' visibility. It means
     * that only from Android 12; before, it is the non-sticky mode, so older versions keep
     * the library's. Re-applied before each frame, after the library's change reaches it.
     */
    private fun keepSystemGesturesWithBarsHidden() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        window.decorView.viewTreeObserver.addOnPreDrawListener {
            val controller = window.insetsController
            if (controller != null && controller.systemBarsBehavior != WindowInsetsController.BEHAVIOR_DEFAULT) {
                controller.systemBarsBehavior = WindowInsetsController.BEHAVIOR_DEFAULT
            }
            true
        }
    }

    /**
     * A PiP window is a paused Activity, and React Native pauses with it: FabricUIManager
     * stops the frame callback that mounts what JS renders. JS kept running, but nothing it
     * drew reached the views, so PiP next/previous replaced the screen in JS and the window
     * never changed; play/pause worked only because it never leaves native. The window is
     * on screen and playing, so React is kept resumed for as long as it is open.
     *
     * Only while no other Glide Activity is resumed: an "Open with" video in PiP uncovers the
     * library. React must follow the library then, or its Back reaches the PiP window (closing
     * it) and its pause trips React's current-activity assertion (a crash). The window gets
     * React back when the library goes.
     */
    private var resumedForPip = false

    override fun onPause() {
        super.onPause()
        if (resumed === this) resumed = null
        if (isInPictureInPictureMode) resumeReactForPip() else pip?.takeIf { it !== this }?.resumeReactForPip()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        if (!isInPictureInPictureMode && pip === this) pip = null
        // The mode change and onPause arrive in either order; whichever is second resumes.
        if (isInPictureInPictureMode && !lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
            resumeReactForPip()
        }
    }

    override fun onResume() {
        // Taking React from a PiP window: pause it for the window first. React ignores a resume
        // while resumed, so its current activity would stay the window's.
        pip?.takeIf { it !== this && it.resumedForPip }?.let {
            it.resumedForPip = false
            (application as? ReactApplication)?.reactHost?.onHostPause(it)
        }
        // Expanded back to full screen: an ordinary resume from here on.
        resumedForPip = false
        resumed = this
        super.onResume()
    }

    override fun onDestroy() {
        if (resumed === this) resumed = null
        if (pip === this) pip = null
        super.onDestroy()
    }

    override fun onStop() {
        // The PiP window was closed. Owe React the pause it was spared, so AppState goes to
        // background and the saves that hang off it run.
        if (resumedForPip) {
            resumedForPip = false
            (application as? ReactApplication)?.reactHost?.onHostPause(this)
        }
        super.onStop()
    }

    /**
     * Back with nothing left to go back to finishes the Activity, and finishing the task a PiP
     * window came from closes the window too: the library's last Back stopped an "Open with"
     * video playing in PiP. Leave the task instead while a window is open.
     */
    override fun invokeDefaultOnBackPressed() {
        if (pip.let { it != null && it !== this } && isTaskRoot) moveTaskToBack(true) else super.invokeDefaultOnBackPressed()
    }

    private fun resumeReactForPip() {
        pip = this
        if (resumed != null) return
        resumedForPip = true
        (application as? ReactApplication)?.reactHost?.onHostResume(this, this)
    }

    companion object {
        // Main thread only. Both are cleared by onDestroy at the latest, so neither leaks.
        private var resumed: GlideBaseActivity? = null
        private var pip: GlideBaseActivity? = null

        /** Whether a Glide window is in PiP, whichever Activity React is following. */
        val inPip: Boolean get() = pip?.isInPictureInPictureMode == true
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            if (handleVolumeKeyEvent(keyCode)) {
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun handleVolumeKeyEvent(keyCode: Int): Boolean {
        val reactApp = application as? ReactApplication ?: return false
        val reactContext = reactApp.reactHost?.currentReactContext ?: return false

        if (!reactContext.hasActiveReactInstance()) {
            return false
        }

        val volumeModule = reactContext.getNativeModule(AudioVolumeModule::class.java)
            ?: (reactContext.getNativeModule(AudioVolumeModule.NAME) as? AudioVolumeModule)
        if (volumeModule != null) {
            if (volumeModule.isListening) {
                return volumeModule.handleVolumeKey(keyCode)
            }
            return false
        }

        return false
    }
}
