@file:JvmName("DebugModules")

package com.glide.app.haptic

import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext

/** Release builds have no Haptics Lab (src/debug has the real one). */
@Suppress("UNUSED_PARAMETER")
fun create(context: ReactApplicationContext): List<NativeModule> = emptyList()
