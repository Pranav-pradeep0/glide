package com.glide.app.smb

import com.google.zxing.BinaryBitmap
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/** The page a phone fills in for the TV, served on this machine's LAN address, and its QR code. */
class PhoneSignInTest {

    @After
    fun stop() = PhoneSignIn.stop()

    @Test
    fun qrReadsBackAsTheUrl() {
        val url = "http://192.168.1.33:41237/k7m2qx9a"
        val m = PhoneSignIn.qr(url)
        val pixels = IntArray(m.width * m.height) { if (m[it % m.width, it / m.width]) 0 else 0xFFFFFF }
        val read = QRCodeReader().decode(BinaryBitmap(HybridBinarizer(RGBLuminanceSource(m.width, m.height, pixels))))
        assertEquals(url, read.text)
    }

    @Test
    fun formPostArrivesAsALogin() {
        val logins = ArrayBlockingQueue<Map<String, String>>(1)
        val url = PhoneSignIn.start("192.168.1.37") { logins.add(it) }

        val form = URL(url).openConnection() as HttpURLConnection
        assertEquals(200, form.responseCode)
        assertTrue(form.inputStream.bufferedReader().readText().contains("192.168.1.37"))

        val post = URL(url).openConnection() as HttpURLConnection
        post.doOutput = true
        post.outputStream.write("user=glide+test&password=p%26ss%3D%C3%A9&domain=".toByteArray())
        assertEquals(200, post.responseCode)
        assertEquals(
            mapOf("host" to "", "user" to "glide test", "password" to "p&ss=é", "domain" to ""),
            logins.poll(2, TimeUnit.SECONDS),
        )

        val wrong = URL(url.substringBeforeLast('/') + "/guess").openConnection() as HttpURLConnection
        assertEquals(404, wrong.responseCode)

        PhoneSignIn.stop()
        assertTrue(runCatching { (URL(url).openConnection() as HttpURLConnection).responseCode }.isFailure)
    }
}
