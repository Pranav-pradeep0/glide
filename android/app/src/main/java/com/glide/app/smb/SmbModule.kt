package com.glide.app.smb

import android.net.Uri
import android.os.SystemClock
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
import com.glide.app.player.BackgroundWork
import com.hierynomus.mserref.NtStatus
import com.hierynomus.mssmb2.SMBApiException
import com.hierynomus.security.SecurityProvider
import com.hierynomus.security.bc.BCSecurityProvider
import kotlin.concurrent.thread

/** Network shares for JS: discovery, logins, share and folder listings, and the speed test. Playback goes through [SmbDataSource]. */
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
            promise.reject("smb", reason(e, host))
        }
    }

    /** SMB servers on the local network ([Discovery]): `{ host, name }`, `name` null when unknown. */
    @ReactMethod
    fun discover(promise: Promise) = BackgroundWork.submit(promise) {
        val out = Arguments.createArray()
        for ((ip, name) in Discovery.find(reactApplicationContext)) {
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
            promise.reject("smb", reason(e, host))
        }
    }

    /**
     * The go/no-go speed test (docs/network-shares.md): reads [uri] for [SECONDS] per setup the
     * way playback does and resolves a report, also logged as `smb-bench` lines for
     * scripts/smb-bench.js. Its own thread at normal priority, not BackgroundWork's background
     * lane, so it measures the network rather than the scheduler.
     * Remove before the release that ships SMB.
     */
    @OptIn(UnstableApi::class)
    @ReactMethod
    fun speedTest(uri: String, promise: Promise) {
        thread(name = "smb-bench") {
            val u = Uri.parse(uri)
            try {
                val setups = listOf<Triple<String, Pair<Int, Int>, SecurityProvider>>(
                    Triple("1 x 1 MB", (1 shl 20) to 1, SmbSecurity),
                    Triple("8 x 256 KB", (256 shl 10) to 8, SmbSecurity),
                    Triple("8 x 1 MB", (1 shl 20) to 8, SmbSecurity),
                    Triple("8 x 1 MB, BouncyCastle", (1 shl 20) to 8, BCSecurityProvider()),
                )
                val lines = setups.map { (name, size, security) ->
                    Smb.security = security
                    val mbps = measure(u, size.first, size.second)
                    "$name: ${"%.1f".format(mbps)} MB/s".also { Log.w(TAG, "smb-bench $it") }
                }
                val session = Smb.describe(u.host.orEmpty()).also { Log.w(TAG, "smb-bench $it") }
                promise.resolve((lines + session).joinToString("\n"))
            } catch (e: Throwable) {
                Log.w(TAG, "smb-bench failed", e)
                promise.reject("smb", reason(e, u.host.orEmpty()))
            } finally {
                Smb.security = SmbSecurity
            }
        }
    }

    @OptIn(UnstableApi::class)
    private fun measure(uri: Uri, chunk: Int, depth: Int): Double {
        val source = SmbDataSource(chunk, depth)
        val buf = ByteArray(64 shl 10)
        val start = SystemClock.elapsedRealtime()
        var bytes = 0L
        try {
            source.open(DataSpec(uri))
            while (SystemClock.elapsedRealtime() - start < SECONDS * 1000) {
                val n = source.read(buf, 0, buf.size)
                if (n != C.RESULT_END_OF_INPUT) {
                    bytes += n
                } else {
                    source.close()
                    source.open(DataSpec(uri))
                }
            }
        } finally {
            source.close()
        }
        return bytes / 1e6 / ((SystemClock.elapsedRealtime() - start) / 1000.0)
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
        private const val SECONDS = 20
        // FILE_ATTRIBUTE_HIDDEN and FILE_ATTRIBUTE_DIRECTORY (MS-FSCC 2.6).
        private const val HIDDEN = 0x2L
        private const val DIRECTORY = 0x10L
    }
}
