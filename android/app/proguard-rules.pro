# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# Strip debug, info, and verbose logging in release builds
-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int);
    public static int v(...);
    public static int d(...);
    public static int i(...);
}

# Hermes
-keep class com.facebook.hermes.unicode.** { *; }

# Reanimated
-keep class com.swmansion.reanimated.** { *; }

# React Native SVG
-keep class com.horcrux.svg.** { *; }

# Safe Area Context
-keep class com.th3rdwave.safeareacontext.** { *; }

# React Native Screens
-keep class com.swmansion.rnscreens.** { *; }


# React Native FS

# React Native Zip Archive
-keep class com.rnziparchive.** { *; }

# OkHttp3 / Okio
-keepattributes Signature
-keepattributes *Annotation*
-dontwarn okhttp3.**
-dontwarn okio.**

# General
-dontwarn com.facebook.react.**

# React Native Config
-keep class com.lugg.RNCConfig.** { *; }

# Keep BuildConfig
-keep class com.glide.app.BuildConfig { *; }

