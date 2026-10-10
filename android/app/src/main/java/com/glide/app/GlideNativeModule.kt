package com.glide.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.uimanager.ViewManager

/**
 * What this APK's native layer can do, for a JS bundle that may be newer than it.
 *
 * JS ships over the air and native only with an APK, so a bundle can reach an APK that is
 * months older than the code it was built from. Stallion scopes releases to versionName,
 * which covers the normal case; this covers the rest. JS checks [API_LEVEL] before calling
 * anything native that was added after level 1 (src/native/GlideNative.ts), and falls back
 * when it is lower, rather than crashing on `undefined is not a function`.
 *
 * Bump [API_LEVEL] in the same commit as any change to a native method, prop, command,
 * event or constant, and note what the level added below.
 *
 * 1: everything up to the native freeze (2026-10).
 */
class GlideNativeModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    override fun getConstants(): Map<String, Any> = mapOf(
        "apiLevel" to API_LEVEL,
        "versionName" to BuildConfig.VERSION_NAME,
        "versionCode" to BuildConfig.VERSION_CODE,
    )

    companion object {
        const val NAME = "GlideNative"
        const val API_LEVEL = 1
    }

    class Package : ReactPackage {
        override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
            listOf(GlideNativeModule(reactContext))

        override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
            emptyList()
    }
}
