package com.glide.app

import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.os.SystemClock
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.bridge.ReactContext
import com.glide.app.pip.PipModule

import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

class MainActivity : GlideBaseActivity() {
  private companion object {
    const val SPLASH_TIMEOUT_MS = 8_000L
    /** windowSplashScreenAnimationDuration in values-v31/styles.xml. */
    const val SPLASH_ICON_MS = 800L
  }

  private var isReactReady = false

  override fun onCreate(savedInstanceState: Bundle?) {
    val splashScreen = installSplashScreen()
    // In debug, we only keep it until the activity is created to see bundling progress.
    // In release, we keep it until React Native is ready for a perfect transition.
    // Capped natively: only JS clears isReactReady, so a bundle that throws before the
    // navigator is ready -- a bad OTA included -- would otherwise sit on the splash forever,
    // hiding the error screen, and never crash for Stallion to roll back. The condition is
    // polled every frame while the splash shows.
    val splashShownAt = SystemClock.uptimeMillis()
    // A fast start also cut the icon's play-to-pause morph off midway, so a cold start holds
    // until it has played; on Android 12+ it starts with the process. (An exit listener could
    // time it exactly there, but it moves the splash into our window and the tab bar jumps.)
    fun hold(now: Long, iconStartedAt: Long) = !BuildConfig.DEBUG && now - splashShownAt < SPLASH_TIMEOUT_MS &&
        (!isReactReady || now - iconStartedAt < SPLASH_ICON_MS)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      splashScreen.setKeepOnScreenCondition { hold(SystemClock.uptimeMillis(), Process.getStartUptimeMillis()) }
    } else {
      // Before Android 12 the splash is a still picture of the icon (a white screen on a TV).
      // Let it hand over at once to its view in our window, play the morph there, and hold
      // that view by the same rule. No tab bar jump here: those versions have no exit animation.
      splashScreen.setOnExitAnimationListener { provider ->
        // Its icon is the logo inside the library's MaskedDrawable, which can't be started: put
        // a fresh one in its place. The mask only clips to a circle the logo sits within.
        (provider.iconView as? android.widget.ImageView)?.let { icon ->
          val logo = getDrawable(R.drawable.logo_animated)
          icon.setImageDrawable(logo)
          (logo as? android.graphics.drawable.Animatable)?.start()
        }
        val iconStartedAt = SystemClock.uptimeMillis()
        val view = provider.view
        view.postOnAnimation(object : Runnable {
          override fun run() {
            if (hold(SystemClock.uptimeMillis(), iconStartedAt)) view.postOnAnimation(this) else provider.remove()
          }
        })
      }
    }
    dropPrivateUri(intent)
    super.onCreate(savedInstanceState)
    
    // Programmatically set background to ensure it's applied correctly during debug bundling gap
    window.setBackgroundDrawableResource(R.color.splash_background)
  }

  fun onReactReady() {
    isReactReady = true
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "Glide"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
          override fun createRootView(): com.facebook.react.ReactRootView? {
              val rootView = super.createRootView()
              // Ensure the root view has the same background as the splash to prevent black flash
              rootView?.let {
                val color = androidx.core.content.ContextCompat.getColor(this@MainActivity, R.color.splash_background)
                it.setBackgroundColor(color)
              }
              return rootView
          }
      }

  /**
   * Handle new intent when app is already running (singleTask mode)
   * This ensures Linking.getInitialURL() returns the correct URI for video files
   */
  override fun onNewIntent(intent: Intent?) {
    // Before super: React Native announces the URI to JS from there.
    dropPrivateUri(intent)
    super.onNewIntent(intent)
    setIntent(intent)
  }

  /**
   * The library's last Back sends the app to the background, as Android 12+ does for launcher
   * roots, instead of finishing: reopening resumes where the user was. Always, not only when
   * the system would (its default finishes on Android 11 and below, and a task an "Open with"
   * started); this also leaves a PiP window from [GlideBaseActivity] open.
   */
  override fun invokeDefaultOnBackPressed() {
    if (isTaskRoot) moveTaskToBack(true) else super.invokeDefaultOnBackPressed()
  }

  /** "Open with" audio lands here, and this Activity is exported; see [PrivatePath]. */
  private fun dropPrivateUri(intent: Intent?) {
    if (intent != null && PrivatePath.isPrivate(this, intent.data)) {
      android.util.Log.w("MainActivity", "Dropped a URI inside Glide's own storage")
      intent.data = null
    }
  }

  /**
   * PiP is owned natively by the video view; the Activity only relays the mode change
   * so the React tree can hide what does not belong in a PiP window.
   */
  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)

    try {
      val reactApplication = application as? com.facebook.react.ReactApplication
      val reactContext = reactApplication?.reactHost?.currentReactContext
      val pipModule = reactContext?.getNativeModule(PipModule::class.java)
          ?: (reactContext?.getNativeModule(PipModule.NAME) as? PipModule)
      pipModule?.onPictureInPictureModeChanged(isInPictureInPictureMode)
    } catch (e: Exception) {
      android.util.Log.w("MainActivity", "Failed to notify PIP state change: ${e.message}")
    }
  }

}
