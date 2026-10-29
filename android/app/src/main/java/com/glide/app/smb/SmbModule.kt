package com.glide.app.smb

import android.net.Uri
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.glide.app.player.BackgroundWork
import com.hierynomus.mserref.NtStatus
import com.hierynomus.mssmb2.SMBApiException

/** Network shares for JS: discovery, logins, share and folder listings. Playback goes through [SmbDataSource]. */
class SmbModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "GlideSmb"

    @ReactMethod
    fun encrypt(plain: String, promise: Promise) = BackgroundWork.submit(promise) {
        promise.resolve(Secrets.encrypt(plain))
    }

    /**
     * [servers]: `{ host, user, domain, secret }`, `secret` from [encrypt], empty for guest.
     * Replaces every login and closes open sessions. Resolves the hosts whose password can no
     * longer be read (the key is gone after a restore onto another device).
     */
    @ReactMethod
    fun setServers(servers: ReadableArray, promise: Promise) = BackgroundWork.submit(promise) {
        val unreadable = Arguments.createArray()
        val logins = HashMap<String, Smb.Login>()
        for (i in 0 until servers.size()) {
            val s = servers.getMap(i) ?: continue
            val host = s.getString("host") ?: continue
            val secret = s.getString("secret").orEmpty()
            val password = if (secret.isEmpty()) "" else runCatching { Secrets.decrypt(secret) }.getOrNull()
            if (password == null) {
                unreadable.pushString(host)
                continue
            }
            logins[host] = Smb.Login(s.getString("user").orEmpty(), password, s.getString("domain").orEmpty())
        }
        Smb.setLogins(logins)
        promise.resolve(unreadable)
    }

    /** The folder at `smb://host/share/path`: `{ name, isDirectory, size }`, hidden entries left out. */
    @ReactMethod
    fun list(uri: String, promise: Promise) = BackgroundWork.submit(promise) {
        val u = Uri.parse(uri)
        val host = u.host.orEmpty()
        try {
            val out = Arguments.createArray()
            for (e in Smb.share(host, u.pathSegments[0]).list(u.pathSegments.drop(1).joinToString("\\"))) {
                val attrs = e.fileAttributes
                if (e.fileName == "." || e.fileName == ".." || attrs and HIDDEN != 0L) continue
                out.pushMap(Arguments.createMap().apply {
                    putString("name", e.fileName)
                    putBoolean("isDirectory", attrs and DIRECTORY != 0L)
                    putDouble("size", e.endOfFile.toDouble())
                })
            }
            promise.resolve(out)
        } catch (e: Exception) {
            Log.w(TAG, "list $uri", e)
            Smb.drop(host)
            fail(promise, e, host)
        }
    }

    /** A small text file (a sidecar subtitle) as UTF-8, read the way playback reads; over [TEXT_CAP] is refused. */
    @OptIn(UnstableApi::class)
    @ReactMethod
    fun readText(uri: String, promise: Promise) = BackgroundWork.submit(promise) {
        val u = Uri.parse(uri)
        val source = SmbDataSource()
        try {
            val length = source.open(DataSpec(u))
            if (length > TEXT_CAP) {
                promise.reject("smb", "Too large to read: $length bytes")
                return@submit
            }
            val out = java.io.ByteArrayOutputStream(length.toInt().coerceAtLeast(0))
            val buf = ByteArray(64 shl 10)
            while (true) {
                val n = source.read(buf, 0, buf.size)
                if (n == C.RESULT_END_OF_INPUT) break
                out.write(buf, 0, n)
            }
            promise.resolve(out.toString(Charsets.UTF_8.name()))
        } catch (e: Exception) {
            Log.w(TAG, "readText $uri", e)
            fail(promise, e, u.host.orEmpty())
        } finally {
            source.close()
        }
    }

    /** SMB servers on the local network ([Discovery]): `{ host, name }`, `name` null when unknown. */
    @ReactMethod
    fun discover(promise: Promise) = BackgroundWork.submit(promise) {
        val out = Arguments.createArray()
        val found = try {
            Discovery.find(reactApplicationContext)
        } catch (e: Smb.LocalNetworkDenied) {
            return@submit fail(promise, e, "")
        }
        for ((ip, name) in found) {
            out.pushMap(Arguments.createMap().apply {
                putString("host", ip)
                putString("name", name)
            })
        }
        promise.resolve(out)
    }

    /**
     * Signs in to [host] and resolves its disk shares, before anything is saved. An empty list
     * when sign-in worked but the server won't list them: the share's name is typed instead.
     */
    @ReactMethod
    fun listShares(host: String, user: String, password: String, domain: String, promise: Promise) = BackgroundWork.submit(promise) {
        try {
            val shares = Smb.withLogin(host, Smb.Login(user, password, domain)) { session ->
                runCatching { ShareEnum.list(session) }.onFailure { Log.w(TAG, "shares $host", it) }.getOrDefault(emptyList())
            }
            promise.resolve(Arguments.fromList(shares))
        } catch (e: Exception) {
            Log.w(TAG, "sign in $host", e)
            fail(promise, e, host)
        }
    }

    /**
     * TV sign-in from a phone ([PhoneSignIn]): serves the form for [host] (empty: the phone types
     * the IP) and resolves `{ url, qr }`, `qr` a PNG data URI. Each form the phone sends arrives
     * as a [PHONE_LOGIN] event `{ host, user, password, domain }`.
     */
    @ReactMethod
    fun servePhoneSignIn(host: String, promise: Promise) = BackgroundWork.submit(promise) {
        val url = PhoneSignIn.start(host) { login ->
            reactApplicationContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit(PHONE_LOGIN, Arguments.makeNativeMap(login))
        }
        promise.resolve(Arguments.createMap().apply {
            putString("url", url)
            putString("qr", PhoneSignIn.qrPng(url))
        })
    }

    @ReactMethod
    fun stopPhoneSignIn() = PhoneSignIn.stop()

    /** `local-network` for [Smb.LocalNetworkDenied], so JS offers its settings; `smb` for the rest. */
    private fun fail(promise: Promise, e: Throwable, host: String) {
        val denied = generateSequence(e) { it.cause }.any { it is Smb.LocalNetworkDenied }
        promise.reject(if (denied) "local-network" else "smb", if (denied) e.message else reason(e, host))
    }

    private fun reason(e: Throwable, host: String): String {
        val api = generateSequence(e) { it.cause }.filterIsInstance<SMBApiException>().firstOrNull()
        return when (api?.status) {
            NtStatus.STATUS_LOGON_FAILURE -> "Wrong username or password"
            NtStatus.STATUS_BAD_NETWORK_NAME -> "No share by that name on $host"
            NtStatus.STATUS_OBJECT_NAME_NOT_FOUND, NtStatus.STATUS_OBJECT_PATH_NOT_FOUND -> "Not found on $host"
            NtStatus.STATUS_ACCESS_DENIED -> "$host refused access"
            null -> "Can't reach $host"
            else -> "$host: ${api.status}"
        }
    }

    companion object {
        private const val TAG = "GlideSmb"
        private const val PHONE_LOGIN = "GlideSmbPhoneLogin"
        private const val TEXT_CAP = 10L shl 20
        // FILE_ATTRIBUTE_HIDDEN and FILE_ATTRIBUTE_DIRECTORY (MS-FSCC 2.6).
        private const val HIDDEN = 0x2L
        private const val DIRECTORY = 0x10L
    }
}
