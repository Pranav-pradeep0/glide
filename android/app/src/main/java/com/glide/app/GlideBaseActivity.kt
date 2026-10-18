package com.glide.app

import android.content.res.Configuration
import android.os.Bundle
import android.view.KeyEvent
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
    }

    /**
     * A PiP window is a paused Activity, and React Native pauses with it: FabricUIManager
     * stops the frame callback that mounts what JS renders. JS kept running, but nothing it
     * drew reached the views, so PiP next/previous replaced the screen in JS and the window
     * never changed; play/pause worked only because it never leaves native. The window is
     * on screen and playing, so React is kept resumed for as long as it is open.
     */
    private var resumedForPip = false

    override fun onPause() {
        super.onPause()
        if (isInPictureInPictureMode) resumeReactForPip()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        // The mode change and onPause arrive in either order; whichever is second resumes.
        if (isInPictureInPictureMode && !lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
            resumeReactForPip()
        }
    }

    override fun onResume() {
        // Expanded back to full screen: an ordinary resume from here on.
        resumedForPip = false
        super.onResume()
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

    private fun resumeReactForPip() {
        resumedForPip = true
        (application as? ReactApplication)?.reactHost?.onHostResume(this, this)
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
