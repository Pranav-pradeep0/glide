@file:JvmName("DebugModules")

package com.glide.app.haptic

import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext

/** Debug builds register the Haptics Lab; the release source set has an empty twin. */
@OptIn(UnstableApi::class)
fun create(context: ReactApplicationContext): List<NativeModule> = listOf(HapticsLabModule(context))
