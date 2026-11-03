package com.glide.app.smb

import android.graphics.Bitmap
import android.graphics.Color
import android.util.Base64
import android.util.Log
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.common.BitMatrix
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.security.SecureRandom
import kotlin.concurrent.thread

/**
 * TV sign-in from a phone (docs/network-shares.md, step (d)): while the TV's sign-in sheet is
 * open, a page on the LAN where the phone's keyboard types the login. Plain http, like a
 * router's page; the URL carries a random token, and nothing listens once the sheet closes.
 */
object PhoneSignIn {
    private const val TAG = "GlideSmb"
    private var server: ServerSocket? = null

    /** Serves the form for [host] (empty: the phone types the IP) and returns its URL. Replaces a running one. */
    @Synchronized
    fun start(host: String, onLogin: (Map<String, String>) -> Unit): String {
        stop()
        val ip = Discovery.ownAddress() ?: throw IOException("Not connected to a network")
        val token = token()
        val socket = ServerSocket(0, 8, ip)
        server = socket
        thread(name = "smb-phone", isDaemon = true) {
            while (!socket.isClosed) {
                val client = runCatching { socket.accept() }.getOrNull() ?: break
                // A thread each: browsers open spare connections and send nothing on them.
                thread(isDaemon = true) {
                    runCatching { client.use { serve(it, token, host, onLogin) } }.onFailure { Log.w(TAG, "phone sign-in", it) }
                }
            }
        }
        return "http://${ip.hostAddress}:${socket.localPort}/$token"
    }

    @Synchronized
    fun stop() {
        server?.close()
        server = null
    }

    /** [url] as a QR code, quiet zone included, 8 px a module. */
    fun qr(url: String): BitMatrix {
        val hints = mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 4)
        val raw = QRCodeWriter().encode(url, BarcodeFormat.QR_CODE, 0, 0, hints)
        return QRCodeWriter().encode(url, BarcodeFormat.QR_CODE, raw.width * 8, raw.height * 8, hints)
    }

    fun qrBitmap(url: String): Bitmap {
        val m = qr(url)
        val pixels = IntArray(m.width * m.height) { if (m[it % m.width, it / m.width]) Color.BLACK else Color.WHITE }
        return Bitmap.createBitmap(pixels, m.width, m.height, Bitmap.Config.ARGB_8888)
    }

    /** [qr] as a PNG data URI for an `<Image>`. */
    fun qrPng(url: String): String {
        val png = ByteArrayOutputStream()
        qrBitmap(url).compress(Bitmap.CompressFormat.PNG, 100, png)
        return "data:image/png;base64," + Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP)
    }

    // 8 letters and digits, about 40 bits; easy to read off the screen when the camera won't scan.
    // No x: the app's font draws "9x2" as "9×2".
    private fun token(): String {
        val abc = "abcdefghjkmnpqrstuvwyz23456789"
        val random = SecureRandom()
        return String(CharArray(8) { abc[random.nextInt(abc.length)] })
    }

    private fun serve(client: Socket, token: String, host: String, onLogin: (Map<String, String>) -> Unit) {
        client.soTimeout = 5000
        val input = client.getInputStream().bufferedReader(Charsets.ISO_8859_1)
        val (method, path) = input.readLine()?.split(' ')?.takeIf { it.size >= 2 } ?: return
        var length = 0
        while (true) {
            val line = input.readLine() ?: return
            if (line.isEmpty()) break
            if (line.startsWith("content-length:", ignoreCase = true)) length = line.substringAfter(':').trim().toIntOrNull() ?: 0
        }
        val page = when {
            path != "/$token" -> return reply(client, "404 Not Found", page("Not found", "<p>Open the address shown on your TV.</p>"))
            method == "POST" && length in 1..4096 -> {
                val body = CharArray(length).also { var n = 0; while (n < length) { val r = input.read(it, n, length - n); if (r < 0) break; n += r } }
                val fields = String(body).split('&').associate {
                    URLDecoder.decode(it.substringBefore('='), "UTF-8") to URLDecoder.decode(it.substringAfter('=', ""), "UTF-8")
                }
                onLogin(listOf("host", "user", "password", "domain").associateWith { fields[it].orEmpty() })
                page("Sent to your TV", "<div class=\"card\"><svg class=\"tick\" viewBox=\"0 0 24 24\"><path d=\"M5 12.5l4.5 4.5L19 7.5\"/></svg>" +
                    "<p>Look at the TV: it signs in and shows your shares.</p></div>" +
                    "<p class=\"note\">Wrong password? <a href=\"/$token\">Try again</a></p>")
            }
            else -> form(host)
        }
        reply(client, "200 OK", page)
    }

    private fun reply(client: Socket, status: String, html: String) {
        val body = html.toByteArray()
        client.getOutputStream().apply {
            write("HTTP/1.1 $status\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${body.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".toByteArray())
            write(body)
            flush()
        }
    }

    private fun form(host: String): String {
        val field = { label: String, name: String, type: String, extra: String ->
            "<label>$label<input name=\"$name\" type=\"$type\" autocapitalize=\"none\" autocorrect=\"off\" spellcheck=\"false\" $extra></label>"
        }
        val server = if (host.isEmpty()) field("IP address", "host", "text", "inputmode=\"decimal\" placeholder=\"192.168.1.5\" required")
        else "<p>Signing in to <b>${escape(host)}</b></p>"
        // Disabled once sent, so a second tap doesn't send the login twice.
        return page("Sign in", "<form method=\"post\" autocomplete=\"off\" onsubmit=\"var b=this.querySelector('button');b.disabled=true;b.textContent='Sending…'\">" +
            "<div class=\"card\">$server" +
            field("Username", "user", "text", "placeholder=\"Empty for guest\" autocomplete=\"off\"") +
            field("Password", "password", "password", "autocomplete=\"off\"") +
            field("Domain (optional)", "domain", "text", "") +
            "</div><button>Send to TV</button></form>" +
            "<p class=\"note\">Windows 11 needs your Windows username and password. This page is on your home Wi-Fi " +
            "and isn't encrypted, like your router's settings page.</p>")
    }

    // The app's look (src/theme/colors.ts, theme.ts, NetworkScreen's Field and the primary Button).
    // Inputs are 16 px so iPhones don't zoom in on focus.
    private fun page(title: String, body: String) = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Glide · $title</title><style>
:root{color-scheme:light dark;--bg:#F6F6F8;--surface:#FFF;--fill:rgba(0,0,0,.05);--text:#111113;--text2:#5E5E66;--text3:#8E8E96;--primary:#111113;--on:#FFF}
@media(prefers-color-scheme:dark){:root{--bg:#000;--surface:#121214;--fill:rgba(255,255,255,.08);--text:#EDEDEF;--text2:#A1A1A8;--text3:#6E6E76;--primary:#FFF;--on:#000}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/20px system-ui,Roboto,sans-serif;-webkit-tap-highlight-color:transparent}
main{max-width:28rem;margin:0 auto;padding:32px 16px}p{margin:0}
.brand{font-size:13.5px;line-height:18px;font-weight:500;color:var(--text2)}
h1{margin:4px 0 24px;font-size:28px;line-height:34px;font-weight:700;letter-spacing:-.5px}
.card{display:grid;gap:16px;padding:16px;border-radius:20px;background:var(--surface)}
label{display:block;font-size:12px;line-height:16px;color:var(--text2)}
input{display:block;width:100%;margin-top:4px;padding:8px 12px;font:inherit;font-size:16px;font-weight:500;color:var(--text);background:var(--fill);border:2px solid transparent;border-radius:12px;outline:0}
input:focus{border-color:var(--primary)}input::placeholder{color:var(--text3);font-weight:400}
button{width:100%;height:48px;margin-top:24px;border:0;border-radius:24px;background:var(--primary);color:var(--on);font:inherit;font-size:13.5px;font-weight:500}
button:disabled{opacity:.5}.note{margin-top:16px;font-size:12px;line-height:16px;color:var(--text3)}a{color:var(--text);font-weight:500}
.tick{width:40px;height:40px;fill:none;stroke:var(--text);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
</style></head><body><main><p class="brand">Glide</p><h1>$title</h1>$body</main></body></html>"""

    private fun escape(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
}
