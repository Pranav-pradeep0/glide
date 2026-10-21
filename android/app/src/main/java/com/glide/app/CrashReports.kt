package com.glide.app

import android.app.Application
import android.content.Context
import org.acra.ACRA
import org.acra.ReportField
import org.acra.config.dialog
import org.acra.config.mailSender
import org.acra.data.StringFormat
import org.acra.ktx.initAcra

/**
 * Crash reports, sent only by the user. After a crash ACRA shows a dialog; Send opens the
 * user's email app with the report in the body, addressed to the developer. No server and
 * nothing automatic. Settings > "Offer to send crash reports" turns the whole thing off.
 *
 * JS fatal errors reach here too: in release, ReactHostImpl.handleHostException hands them to
 * DefaultReactHostDelegate, whose default handler rethrows on the JS thread.
 */
object CrashReports {
    // ACRA reads its on/off switch (ACRA.PREF_ENABLE_ACRA) from this file, and listens for
    // changes, so the Settings toggle takes effect at once.
    private const val PREFS = "acra"

    fun init(app: Application) {
        app.initAcra {
            buildConfigClass = BuildConfig::class.java
            sharedPreferencesName = PREFS
            reportFormat = StringFormat.KEY_VALUE_LIST
            // Only what's needed to read a crash. No logcat, settings, file paths or user data.
            reportContent = listOf(
                ReportField.STACK_TRACE,
                ReportField.APP_VERSION_NAME,
                ReportField.APP_VERSION_CODE,
                ReportField.CUSTOM_DATA,
                ReportField.ANDROID_VERSION,
                ReportField.BRAND,
                ReportField.PHONE_MODEL,
            )
            // Still pass the crash on, so Play Console's Android vitals count it.
            alsoReportToAndroidFramework = true
            dialog {
                title = "Glide stopped"
                text = "Send a crash report? It opens your email app with the error details " +
                    "(stack trace, app and Android version, phone model) for you to review first."
                positiveButtonText = "Send"
                negativeButtonText = "Don't send"
                // ACRA's manifest gives the dialog Android 1.0's Theme.Dialog; use the system's.
                resTheme = android.R.style.Theme_DeviceDefault_Dialog_Alert
                resIcon = null
            }
            mailSender {
                mailTo = "glidemediaplayer@gmail.com"
                subject = "Glide crash report"
                // In the body, not attached, so the user sees exactly what is sent.
                reportAsFile = false
            }
        }
        ACRA.errorReporter.putCustomData("API_LEVEL", GlideNativeModule.API_LEVEL.toString())
    }

    fun setEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(ACRA.PREF_ENABLE_ACRA, enabled)
            .apply()
    }
}
