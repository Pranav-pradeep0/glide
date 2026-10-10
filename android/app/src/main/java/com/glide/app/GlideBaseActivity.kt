package com.glide.app

import android.os.Bundle
import android.view.KeyEvent
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
