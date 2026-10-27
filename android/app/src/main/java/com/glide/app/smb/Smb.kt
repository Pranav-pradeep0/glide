package com.glide.app.smb

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.hierynomus.security.SecurityProvider
import com.hierynomus.smbj.SMBClient
import com.hierynomus.smbj.SmbConfig
import com.hierynomus.smbj.auth.AuthenticationContext
import com.hierynomus.smbj.session.Session
import com.hierynomus.smbj.share.DiskShare
import java.io.IOException
import java.security.KeyStore
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Sessions to SMB servers: one per host, kept open between files, reopened after [drop].
 * Logins come from JS ([SmbModule.setServers]) and live only in memory; at rest the password is
 * ciphertext in MMKV, under a key that never leaves the AndroidKeyStore ([Secrets]).
 */
object Smb {
    class Login(val user: String, val password: String, val domain: String)

    private val logins = ConcurrentHashMap<String, Login>()
    private val sessions = HashMap<String, Session>()
    private val shares = HashMap<String, DiskShare>()
    private var client: SMBClient? = null

    /** The speed test swaps this to measure BouncyCastle against the platform. */
    var security: SecurityProvider = SmbSecurity
        @Synchronized set(value) {
            field = value
            closeAll()
        }

    /** SmbDataSource's read-ahead threads. */
    val readers: ExecutorService = Executors.newCachedThreadPool { r -> Thread(r, "smb-read").apply { isDaemon = true } }

    @Synchronized
    fun setLogins(map: Map<String, Login>) {
        logins.clear()
        logins.putAll(map)
        closeAll()
    }

    /** `host/share`, connected and signed in. */
    @Synchronized
    fun share(host: String, name: String): DiskShare {
        shares["$host/$name"]?.takeIf { it.isConnected }?.let { return it }
        val session = sessions[host]?.takeIf { it.connection.isConnected } ?: connect(host).also { sessions[host] = it }
        return (session.connectShare(name) as DiskShare).also { shares["$host/$name"] = it }
    }

    /**
     * Every connection to a server starts here. When targetSdk reaches 37, Android 17's
     * ACCESS_LOCAL_NETWORK runtime request goes here, and a refusal is shown as "Allow nearby
     * devices" rather than a timeout (docs/network-shares.md).
     */
    private fun connect(host: String): Session {
        val login = logins[host] ?: throw IOException("No login for $host")
        // Reads are sized by SmbDataSource; this only caps them, under the server's own maximum.
        val c = client ?: SMBClient(
            SmbConfig.builder()
                .withSecurityProvider(security)
                .withReadBufferSize(4 shl 20)
                .withTimeout(15, TimeUnit.SECONDS)
                .withSoTimeout(30, TimeUnit.SECONDS)
                .build()
        ).also { client = it }
        val auth = if (login.user.isEmpty()) AuthenticationContext.guest()
            else AuthenticationContext(login.user, login.password.toCharArray(), login.domain)
        return c.connect(host).authenticate(auth)
    }

    /** Dialect, sizes and signing of the open session to [host], for the speed test. */
    @Synchronized
    fun describe(host: String): String =
        sessions[host]?.let { "${it.connection.negotiatedProtocol}, signing ${if (it.isSigningRequired) "on" else "off"}" }.orEmpty()

    /** After a failure: the next [share] for [host] connects again. */
    @Synchronized
    fun drop(host: String) {
        sessions.remove(host)?.let { runCatching { it.connection.close(true) } }
        shares.keys.removeAll { it.startsWith("$host/") }
    }

    private fun closeAll() {
        sessions.keys.toList().forEach(::drop)
        client?.close()
        client = null
    }
}

/** AES-GCM under an AndroidKeyStore key. Ciphertext is base64 of the 12-byte IV and the sealed bytes. */
object Secrets {
    private const val ALIAS = "glide_smb"

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as SecretKey?)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build()
            )
        }.generateKey()
    }

    fun encrypt(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        return Base64.encodeToString(c.iv + c.doFinal(plain.toByteArray()), Base64.NO_WRAP)
    }

    /** Throws when the key is gone (app data restored onto another device): sign in again. */
    fun decrypt(sealed: String): String {
        val b = Base64.decode(sealed, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, b, 0, 12))
        }
        return String(c.doFinal(b, 12, b.size - 12))
    }
}
