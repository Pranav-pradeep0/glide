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

# Reanimated, SVG, Screens, Safe Area Context and Zip Archive each used to be kept whole
# here. All of them ship consumer ProGuard rules in their own AARs, which R8 applies
# automatically and which keep only what reflection actually reaches -- so these blanket
# keeps did nothing but hold entire packages in the APK. Two of them named packages that
# no longer exist (com.lugg.ReactNativeConfig, com.rnfs) and so kept nothing at all.

# OkHttp3 / Okio
-keepattributes Signature
-keepattributes *Annotation*
-dontwarn okhttp3.**
-dontwarn okio.**

# General
-dontwarn com.facebook.react.**


# smbj (network shares). Its event bus, mbassador, finds @Handler methods by reflection.
# javax.el (mbassador's optional EL filters) and org.ietf.jgss (Kerberos; we sign in with NTLM)
# are not on Android and never reached.
-keep class net.engio.mbassy.** { *; }
-keepclassmembers class * { @net.engio.mbassy.listener.Handler <methods>; }
-dontwarn javax.el.**
-dontwarn org.ietf.jgss.**
