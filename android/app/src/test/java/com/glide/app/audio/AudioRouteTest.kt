package com.glide.app.audio

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Volume boost above 100% must never reach the phone's own speaker. The route decides, so
 * anything it gets wrong is either clipping on the speaker or boost refused on headphones.
 * Types are the raw AudioDeviceInfo values, which is what the platform hands over.
 */
class AudioRouteTest {

    private fun route(type: Int) = AudioVolumeModule.routeForDeviceType(type)

    @Test
    fun `built-in outputs are the speaker`() {
        assertEquals("speaker", route(1))  // BUILTIN_EARPIECE
        assertEquals("speaker", route(2))  // BUILTIN_SPEAKER
        assertEquals("speaker", route(18)) // TELEPHONY
        assertEquals("speaker", route(24)) // BUILTIN_SPEAKER_SAFE
    }

    @Test
    fun `every flavour of wireless counts as bluetooth`() {
        assertEquals("bluetooth", route(7))  // BLUETOOTH_A2DP
        assertEquals("bluetooth", route(8))  // BLUETOOTH_SCO
        assertEquals("bluetooth", route(23)) // HEARING_AID
        assertEquals("bluetooth", route(26)) // BLE_HEADSET
        assertEquals("bluetooth", route(27)) // BLE_SPEAKER
        assertEquals("bluetooth", route(30)) // BLE_BROADCAST
    }

    @Test
    fun `wired and usb keep their own routes`() {
        assertEquals("wired", route(3))  // WIRED_HEADSET
        assertEquals("wired", route(4))  // WIRED_HEADPHONES
        assertEquals("wired", route(9))  // HDMI
        assertEquals("wired", route(10)) // HDMI_ARC
        assertEquals("wired", route(29)) // HDMI_EARC
        assertEquals("usb", route(11))   // USB_DEVICE
        assertEquals("usb", route(22))   // USB_HEADSET
    }

    /**
     * The whole point: an output nobody mapped must not read as something boost is allowed
     * on. Callers treat unknown as the speaker, so boost stays off.
     */
    @Test
    fun `an unmapped output is never mistaken for an external one`() {
        for (type in listOf(0, 20, 21, 25, 28, 31, 99)) {
            assertEquals("type $type", "unknown", route(type))
        }
    }
}
