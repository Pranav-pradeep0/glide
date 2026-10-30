package com.glide.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

/** Build info for JS: [API_LEVEL] (shown in Settings > Version), version and the .env strings. */
class GlideNativeModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    override fun getConstants(): Map<String, Any> = mapOf(
        "apiLevel" to API_LEVEL,
        "versionName" to BuildConfig.VERSION_NAME,
        "versionCode" to BuildConfig.VERSION_CODE,
        "env" to BuildConfig.JS_ENV,
    )

    @ReactMethod
    fun setCrashReportsEnabled(enabled: Boolean) = CrashReports.setEnabled(reactApplicationContext, enabled)

    companion object {
        const val NAME = "GlideNative"
        const val API_LEVEL = 25
    }

    class Package : ReactPackage {
        override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
            listOf(GlideNativeModule(reactContext))

        override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
            listOf(KeyboardInsetView.Manager())
    }
}
