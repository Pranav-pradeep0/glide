package com.glide.app.player

import androidx.media3.common.util.UnstableApi
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

@UnstableApi
class GlidePlayerPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
        listOf(
            SubtitleSyncModule(context),
            MediaStoreVideoModule(context),
            TvRemoteModule(context),
            com.glide.app.smb.SmbModule(context)
        )

    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
        listOf(GlidePlayerViewManager())
}
