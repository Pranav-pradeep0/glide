package com.glide.app

import android.app.Application
import android.content.Context
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.glide.app.haptic.HapticPackage
import com.glide.app.pip.PipPackage
import com.glide.app.smb.SmbDataSource
import com.reactnativesimplethumbnail.SimpleThumbnailModule
import com.reactnativesimplethumbnail.SimpleThumbnailPackage

class MainApplication : Application(), ReactApplication {

  // ReactNativeHost throws under the New Architecture in 0.87; ReactHost replaces it.
  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
        context = applicationContext,
        packageList =
            PackageList(this).packages.apply {
              // Packages that cannot be autolinked yet can be added manually here.
              add(GlideNativeModule.Package())
              add(HapticPackage())
              add(com.glide.app.orientation.VideoOrientationPackage())
              add(PipPackage())
              add(SimpleThumbnailPackage())
              add(AudioControlPackage())
              add(SplashPackage())
              // The Media3/ExoPlayer playback core. Registered alongside the VLC view, not
              // instead of it; which one renders is a setting (docs/player-engine-migration-plan.md).
              add(com.glide.app.player.GlidePlayerPackage())
              add(com.glide.app.audio.AudioPackage())
            },
        // Stallion hands back the downloaded OTA bundle, or null to fall through to the
        // bundle packaged in the APK. This replaces the old getJSBundleFile() override.
        jsBundleFilePath = com.stallion.Stallion.getJSBundleFile(applicationContext),
        useDevSupport = BuildConfig.DEBUG,
    )
  }

  override fun attachBaseContext(base: Context) {
    super.attachBaseContext(base)
    CrashReports.init(this)
  }

  override fun onCreate() {
    super.onCreate()
    // ACRA's crash dialog and sender run in their own ":acra" process, which needs no React Native.
    if (org.acra.ACRA.isACRASenderServiceProcess()) return
    // Replaces SoLoader.init plus the New Architecture entry point load().
    loadReactNative(this)
    // Subtitle font. An XML family (res/font) so fontWeight and italic pick real faces.
    com.facebook.react.common.assets.ReactFontManager.getInstance()
        .addCustomFont(this, "AtkinsonHyperlegibleNext", R.font.atkinson_hyperlegible_next)
    // Thumbnails of smb:// films: the library can't see app classes, so it is handed the reader.
    SimpleThumbnailModule.dataSourceFactory = androidx.media3.datasource.DataSource.Factory { SmbDataSource() }
  }
}
