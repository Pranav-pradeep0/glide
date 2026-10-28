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

  internal companion object {
    const val TAG = "VideoPlayerActivity"

    // Storage Access Framework URIs are long; 8 KB sits far above any legitimate one and
    // far below a size that can pressure a parser.
    const val MAX_URI_LENGTH = 8192

    // LibVLC natively resolves far more than this - smb, ftp, nfs, sftp, dvd, screen and
    // others. This Activity is exported, so any installed app can start it with an
    // explicit intent and skip the manifest intent filters entirely. Only the schemes
    // Glide actually advertises are accepted.
    val ALLOWED_SCHEMES = setOf("content", "file", "http", "https", "rtsp")

    // The MX Player / VLC external-player contract that Stremio, Kodi addons and others use:
    // "position" (ms) in, and "position"/"duration" (MX, int ms) plus "extra_position"/
    // "extra_duration" (VLC, long ms) back in the result.
    const val RESULT_ACTION = "com.mxtech.intent.result.VIEW"

    // The live player, for reports from JS while another Glide Activity is in front (PiP).
    var instance: java.lang.ref.WeakReference<VideoPlayerActivity>? = null
  }

  // Resolved once in onCreate; getLaunchOptions only reads it.
  private var externalVideoUri: String? = null
  private var startPositionMs: Long = 0
  // The last stop point JS reported; survives a recreate so the reopened player resumes there.
  private var stopPositionMs: Long = -1
  /** Set by the player view: background play keeps this alive when it leaves the screen. */
  @JvmField var playInBackground = false

  /** Where the caller wants playback to start. Senders disagree on int vs long, so take any number. */
  private fun resolveStartPositionMs(): Long {
    @Suppress("DEPRECATION")
    val ms = (intent?.extras?.get("position") as? Number)?.toLong() ?: return 0
    return ms.coerceAtLeast(0)
  }

  /**
   * The rest of the MX Player / VLC contract, checked as strictly as the video URI: title,
   * secure_uri, HTTP headers, subtitle files and a playlist. Flat strings and string arrays,
   * the only shapes launch options and events carry.
   */
  private fun externalExtras(uri: String, startMs: Long): Bundle = Bundle().apply {
    val launchIntent = intent
    putString("videoUri", uri)
    putDouble("startPositionMs", startMs.toDouble())
    launchIntent.getStringExtra("title")?.trim()?.take(500)?.takeIf { it.isNotEmpty() }
        ?.let { putString("title", it) }
    putBoolean("secureUri", launchIntent.getBooleanExtra("secure_uri", false))

    // Name/value pairs, flat. A CR or LF would let a sender write its own request lines.
    val headers = launchIntent.getStringArrayExtra("headers").orEmpty().toList().chunked(2)
        .filter { it.size == 2 && it.none { s -> s.length > 4096 || s.contains('\r') || s.contains('\n') } }
        .take(32).flatten()
    if (headers.isNotEmpty()) putStringArray("headers", headers.toTypedArray())

    val subs = uriListExtra("subs").toMutableList()
    val subNames = launchIntent.getStringArrayExtra("subs.name")
        ?: launchIntent.getStringArrayExtra("subs.filename")
    val enabled = uriListExtra("subs.enable").toMutableSet()
    // VLC's single subtitle: a path or a URI, always shown.
    launchIntent.getStringExtra("subtitles_location")?.let { loc ->
      checkedUri(if (loc.startsWith("/")) Uri.fromFile(java.io.File(loc)) else Uri.parse(loc))?.let {
        subs += it
        enabled += it
      }
    }
    if (subs.isNotEmpty()) {
      putStringArray("subs", subs.toTypedArray())
      putStringArray("subsName", Array(subs.size) { subNames?.getOrNull(it)?.take(200) ?: "" })
      putStringArray("subsEnable", enabled.filter { it in subs }.toTypedArray())
    }

    val list = uriListExtra("video_list")
    if (list.size > 1) {
      val names = launchIntent.getStringArrayExtra("video_list.name")
          ?: launchIntent.getStringArrayExtra("video_list.filename")
      putStringArray("videoList", list.toTypedArray())
      putStringArray("videoListName", Array(list.size) { names?.getOrNull(it)?.take(500) ?: "" })
    }
  }

  /** A URI-list extra, whichever shape the sender used (Uri[], String[], one of either). */
  private fun uriListExtra(key: String): List<String> {
    @Suppress("DEPRECATION")
    val raw = intent?.extras?.get(key) ?: return emptyList()
    val items = when (raw) {
      is Array<*> -> raw.toList()
      is Collection<*> -> raw.toList()
      else -> listOf(raw)
    }
    return items.take(500).mapNotNull { item ->
      checkedUri((item as? Uri) ?: (item as? String)?.let(Uri::parse))
    }
  }

  /** The checks every URI from an intent passes: scheme, emptiness, Glide's own files, length. */
  private fun checkedUri(uri: Uri?): String? {
    if (uri == null) return null
    val scheme = uri.scheme?.lowercase()
    if (scheme == null || scheme !in ALLOWED_SCHEMES) {
      android.util.Log.w(TAG, "Rejected external intent scheme: $scheme")
      return null
    }
    if (uri.schemeSpecificPart.isNullOrBlank()) return null
    if (PrivatePath.isPrivate(this, uri)) {
      android.util.Log.w(TAG, "Rejected external intent: path inside Glide's own storage")
      return null
    }
    val value = uri.toString()
    if (value.length > MAX_URI_LENGTH) {
      android.util.Log.w(TAG, "Rejected external intent: URI length ${value.length}")
      return null
    }
    return value
  }

  /**
   * The stop point for the app that started this one for a result. Held as the pending result
   * at every report, so whatever finishes the Activity -- Back, the detail screen, leaving
   * it -- hands back the latest one.
   */
  fun setStopPoint(uri: String?, positionMs: Long, durationMs: Long) {
    if (positionMs < 0 || durationMs <= 0) return
    stopPositionMs = positionMs
    val atEnd = positionMs >= durationMs - 1000
    // The data is the video it stopped in: with a video_list, maybe not the one it opened.
    setResult(RESULT_OK, Intent(RESULT_ACTION, uri?.let(Uri::parse))
        .putExtra("position", positionMs.toInt())
        .putExtra("duration", durationMs.toInt())
        .putExtra("extra_position", positionMs)
        .putExtra("extra_duration", durationMs)
        .putExtra("end_by", if (atEnd) "playback_completion" else "user"))
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    if (stopPositionMs >= 0) outState.putLong("stopPositionMs", stopPositionMs)
  }

  /**
   * A result only reaches the caller when this finishes itself. Left running in the caller's
   * task, Home and reopening the caller (whose launch can clear the task above it) would
   * close the player with no result at all, so leaving the screen ends it here.
   */
  override fun onStop() {
    super.onStop()
    if (callingActivity != null && !isFinishing && !isChangingConfigurations &&
        !isInPictureInPictureMode && !playInBackground) {
      finish()
    }
  }

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
    // Recreated after process death: carry on from where it got to, not the caller's start.
    startPositionMs = savedInstanceState?.getLong("stopPositionMs", -1)?.takeIf { it >= 0 }
        ?: resolveStartPositionMs()

    super.onCreate(savedInstanceState)
    instance = java.lang.ref.WeakReference(this)

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
    val value = checkedUri(uri) ?: return null

    if (uri.scheme.equals("content", ignoreCase = true) &&
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
          return externalExtras(uri, startPositionMs)
      }
      }

  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    setIntent(intent)
    val uri = resolveExternalVideoUri()
    if (uri != null) {
      externalVideoUri = uri
      stopPositionMs = -1
      try {
        val reactApplication = application as? com.facebook.react.ReactApplication
        val reactContext = reactApplication?.reactHost?.currentReactContext
        reactContext
            ?.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit("onNewVideoUri", com.facebook.react.bridge.Arguments.fromBundle(
                externalExtras(uri, resolveStartPositionMs())))
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
