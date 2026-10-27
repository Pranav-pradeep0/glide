package com.glide.app.smb

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * SMB servers on the local network, three ways at once (docs/network-shares.md, step (b)):
 * mDNS `_smb._tcp` (NAS boxes, Macs, Samba), WS-Discovery (Windows with network discovery on),
 * and port 445 on every address of our /24 (Windows on a Public network, which answers neither).
 */
object Discovery {
    private const val TAG = "GlideSmb"
    private const val WINDOW_MS = 3000L

    /** IP → name, when one was found. Takes about [WINDOW_MS]. */
    fun find(context: Context): Map<String, String?> {
        Smb.gate()
        val found = ConcurrentHashMap<String, String>()
        val names = ConcurrentHashMap<String, String>()
        listOf(
            thread { runCatching { mdns(context, found, names) }.onFailure { Log.w(TAG, "mdns", it) } },
            thread { runCatching { wsDiscovery(found) }.onFailure { Log.w(TAG, "ws-discovery", it) } },
            thread { runCatching { scan(found) }.onFailure { Log.w(TAG, "scan", it) } },
        ).forEach { it.join() }
        // w, not i: release builds strip Log.i (proguard-rules.pro).
        Log.w(TAG, "discovery: ${found.map { (ip, how) -> "$ip by $how" }}")
        // A router that registers its DHCP clients answers for the rest; else the IP stands alone.
        val pool = Executors.newFixedThreadPool(8)
        val out = found.keys.associateWith { ip ->
            pool.submit<String?> {
                names[ip] ?: InetAddress.getByName(ip).canonicalHostName.takeIf { it != ip }?.substringBefore('.')
            }
        }.mapValues { runCatching { it.value.get(2, TimeUnit.SECONDS) }.getOrNull() }
        pool.shutdownNow()
        return out
    }

    private fun mdns(context: Context, found: MutableMap<String, String>, names: MutableMap<String, String>) {
        val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
        val services = ConcurrentHashMap.newKeySet<NsdServiceInfo>()
        val listener = object : NsdManager.DiscoveryListener {
            override fun onServiceFound(info: NsdServiceInfo) { services += info }
            override fun onServiceLost(info: NsdServiceInfo) {}
            override fun onDiscoveryStarted(type: String) {}
            override fun onDiscoveryStopped(type: String) {}
            override fun onStartDiscoveryFailed(type: String, code: Int) { Log.w(TAG, "mdns start $code") }
            override fun onStopDiscoveryFailed(type: String, code: Int) {}
        }
        nsd.discoverServices("_smb._tcp", NsdManager.PROTOCOL_DNS_SD, listener)
        Thread.sleep(WINDOW_MS * 2 / 3)
        runCatching { nsd.stopServiceDiscovery(listener) }
        // Before Android 14 NsdManager resolves one service at a time.
        for (info in services) {
            val done = CountDownLatch(1)
            @Suppress("DEPRECATION")
            nsd.resolveService(info, object : NsdManager.ResolveListener {
                override fun onResolveFailed(info: NsdServiceInfo, code: Int) { done.countDown() }
                override fun onServiceResolved(info: NsdServiceInfo) {
                    (info.host as? Inet4Address)?.hostAddress?.let {
                        found[it] = "mdns"
                        names[it] = info.serviceName
                    }
                    done.countDown()
                }
            })
            done.await(500, TimeUnit.MILLISECONDS)
        }
    }

    /** A WS-Discovery Probe for any device; Windows answers with a unicast ProbeMatch. */
    private fun wsDiscovery(found: MutableMap<String, String>) {
        val probe = """<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:wsd="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:wsdp="http://schemas.xmlsoap.org/ws/2006/02/devprof"><soap:Header><wsa:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To><wsa:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</wsa:Action><wsa:MessageID>urn:uuid:${UUID.randomUUID()}</wsa:MessageID></soap:Header><soap:Body><wsd:Probe><wsd:Types>wsdp:Device</wsd:Types></wsd:Probe></soap:Body></soap:Envelope>""".toByteArray()
        DatagramSocket().use { socket ->
            socket.send(DatagramPacket(probe, probe.size, InetAddress.getByName("239.255.255.250"), 3702))
            val end = System.currentTimeMillis() + WINDOW_MS
            val buf = ByteArray(8192)
            while (true) {
                val left = end - System.currentTimeMillis()
                if (left <= 0) break
                socket.soTimeout = left.toInt()
                val p = DatagramPacket(buf, buf.size)
                runCatching { socket.receive(p) }.onFailure { break }
                // Printers and TVs answer too; only the ones with port 445 open are kept.
                p.address.hostAddress?.let { if (open(it)) found.putIfAbsent(it, "ws-discovery") }
            }
        }
    }

    /** Port 445 on every other address of our /24. */
    private fun scan(found: MutableMap<String, String>) {
        val own = NetworkInterface.getNetworkInterfaces().asSequence()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.interfaceAddresses.asSequence() }
            .map { it.address }
            .firstOrNull { it is Inet4Address && it.isSiteLocalAddress } ?: return
        val prefix = own.address.let { "${it[0].toInt() and 255}.${it[1].toInt() and 255}.${it[2].toInt() and 255}." }
        val pool = Executors.newFixedThreadPool(64)
        (1..254).map { "$prefix$it" }.filter { it != own.hostAddress }.forEach { ip ->
            pool.execute { if (open(ip)) found.putIfAbsent(ip, "scan") }
        }
        pool.shutdown()
        pool.awaitTermination(WINDOW_MS, TimeUnit.MILLISECONDS)
    }

    // ponytail: 300 ms suits a home LAN; a slow Wi-Fi hop could need more.
    private fun open(ip: String) = runCatching { Socket().use { it.connect(InetSocketAddress(ip, 445), 300) } }.isSuccess
}
