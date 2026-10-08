package com.glide.app

import android.content.res.Configuration
import android.content.pm.ActivityInfo
import android.net.Uri
import android.os.Build
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import android.os.Bundle
import android.content.Intent
import com.glide.app.pip.PipModule

class VideoPlayerActivity : GlideBaseActivity() {

  private companion object {
    const val TAG = "VideoPlayerActivity"

    // Storage Access Framework URIs are long; 8 KB sits far above any legitimate one and
    // far below a size that can pressure a parser.
    const val MAX_URI_LENGTH = 8192

    // LibVLC natively resolves far more than this - smb, ftp, nfs, sftp, dvd, screen and
    // others. This Activity is exported, so any installed app can start it with an
    // explicit intent and skip the manifest intent filters entirely. Only the schemes
    // Glide actually advertises are accepted.
    val ALLOWED_SCHEMES = setOf("content", "file", "http", "https", "rtsp")
  }

  // Resolved once in onCreate; getLaunchOptions only reads it.
  private var externalVideoUri: String? = null

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "VideoPlayerActivity"

  override fun onCreate(savedInstanceState: Bundle?) {
    // Set orientation before super.onCreate so OEMs can settle during the transition.
    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR

    // Validate before the React root mounts. VideoPlayerRoot renders an indefinite
    // spinner when it receives no videoUri, so handing it nothing is not an option.
    externalVideoUri = resolveExternalVideoUri()

    super.onCreate(savedInstanceState)

    if (externalVideoUri == null) {
      android.util.Log.w(TAG, "Rejected external intent: no playable video URI")
      // Scoped to this Activity deliberately. Exiting the process would also take
      // MainActivity, which may be showing the user their own library.
      finish()
    }
  }

  /**
   * Everything an intent carries is untrusted: the URI, its scheme, its length, and the
   * declared MIME type. Returns null for anything Glide cannot play.
   */
  private fun resolveExternalVideoUri(): String? {
    val launchIntent = intent ?: return null

    val uri: Uri? = if (launchIntent.action == Intent.ACTION_SEND) {
      // Share sheet. The MIME check is kept here because the sender chooses it and the
      // stream extra carries no scheme guarantee of its own.
      if (launchIntent.type?.startsWith("video/") != true) {
        return null
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        launchIntent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
      } else {
        @Suppress("DEPRECATION")
        launchIntent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
      }
    } else {
      launchIntent.data
    }

    if (uri == null) {
      return null
    }

    // No MIME assertion on ACTION_VIEW. The manifest filters already require video/* for
    // every implicit VIEW except extension-matched http(s) links, and an explicit intent
    // can declare video/mp4 for anything, so checking it here would only reject the file
    // managers that send application/octet-stream for a real video.
    val scheme = uri.scheme?.lowercase()
    if (scheme == null || scheme !in ALLOWED_SCHEMES) {
      android.util.Log.w(TAG, "Rejected external intent scheme: $scheme")
      return null
    }
    if (uri.schemeSpecificPart.isNullOrBlank()) {
      return null
    }

    val value = uri.toString()
    if (value.length > MAX_URI_LENGTH) {
      android.util.Log.w(TAG, "Rejected external intent: URI length ${value.length}")
      return null
    }

    if (scheme == "content" &&
        launchIntent.flags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION != 0) {
      // Only when the sender actually offered a persistable grant. Taking one that was
      // not offered throws, and most file managers offer a call-scoped grant instead.
      try {
        contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      } catch (e: SecurityException) {
        android.util.Log.w(TAG, "Could not persist content URI grant: ${e.message}")
      }
    }

    // ponytail: a content:// URI arriving without any read grant is still accepted, and
    // fails downstream as a decode error rather than a clear message. Rejecting on a
    // missing FLAG_GRANT_READ_URI_PERMISSION would also reject world-readable exported
    // providers that legitimately need no grant, so it needs the device matrix in
    // tracker section 6.2 before it can be tightened.
    return value
  }

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
      override fun getLaunchOptions(): Bundle? {
          val uri = externalVideoUri ?: return null
          return Bundle().apply { putString("videoUri", uri) }
      }
      }

  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    setIntent(intent)
    val uri = resolveExternalVideoUri()
    if (uri != null) {
      externalVideoUri = uri
      try {
        val reactApplication = application as? com.facebook.react.ReactApplication
        val reactContext = reactApplication?.reactHost?.currentReactContext
        reactContext
            ?.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit("onNewVideoUri", uri)
      } catch (e: Exception) {
        android.util.Log.w(TAG, "Failed to emit onNewVideoUri: ${e.message}")
      }
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
      android.util.Log.w("VideoPlayerActivity", "Failed to notify PIP state change: ${e.message}")
    }
  }

}
