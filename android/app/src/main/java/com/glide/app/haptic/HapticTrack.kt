package com.glide.app.haptic

import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException

/**
 * The haptic track: the contract between whatever decides what is felt (Listener, subtitle
 * meaning, Director) and the Performer that plays it (docs/haptics-engine-plan.md 3.2). Units are
 * device-independent: intensity and sharpness are 0..1, and the Performer maps them through the
 * phone's calibration. Frozen in Phase 1; any change to the fields or the file layout bumps
 * [FORMAT_VERSION].
 *
 * Bed lane: one (intensity, sharpness) frame every [BED_FRAME_MS] from time 0. Frames past the
 * end are 0. Intensity 0 is a gap, the only place the Performer starts a new call (decision L1).
 *
 * Event lane: hits, sorted by time. [Event.lengthMs] is the pulse at full intensity and
 * [Event.decayMs] the tail after it; with no frequency control a hit's character is its length
 * (decision L5).
 */
class HapticTrack(
    /** Bumped by a producer when its output changes, so cached tracks are rebuilt. */
    val analyzerVersion: Int,
    val fingerprint: Fingerprint,
    val bedIntensity: FloatArray,
    val bedSharpness: FloatArray,
    val events: List<Event>
) {
    /** Identifies the media file the track was made from. */
    data class Fingerprint(val path: String, val size: Long, val mtimeMs: Long)

    data class Event(
        val timeMs: Int,
        val intensity: Float,
        val sharpness: Float,
        val lengthMs: Int,
        val decayMs: Int,
        /** [SOURCE_AUDIO] and/or [SOURCE_SUBTITLE]. */
        val sources: Int
    )

    init {
        require(bedIntensity.size == bedSharpness.size) { "bed lanes differ in length" }
        require(bedIntensity.all { it in 0f..1f } && bedSharpness.all { it in 0f..1f }) { "bed value outside 0..1" }
        require(events.zipWithNext().all { (a, b) -> a.timeMs <= b.timeMs }) { "events not sorted" }
        require(events.all { it.timeMs >= 0 && it.intensity in 0f..1f && it.sharpness in 0f..1f && it.lengthMs in 0..0xFFFF && it.decayMs in 0..0xFFFF }) {
            "event field out of range"
        }
    }

    /** Bed intensity at [timeMs], 0 outside the lane. */
    fun bedAt(timeMs: Int): Float = bedIntensity.getOrElse(timeMs / BED_FRAME_MS) { 0f }

    /**
     * Writes the cache file. Intensity and sharpness are stored as 8 bits (1/255 steps, the
     * motor's own amplitude resolution), so a written track reads back quantized.
     */
    fun write(out: DataOutputStream) {
        out.writeInt(MAGIC)
        out.writeInt(FORMAT_VERSION)
        out.writeInt(analyzerVersion)
        out.writeUTF(fingerprint.path)
        out.writeLong(fingerprint.size)
        out.writeLong(fingerprint.mtimeMs)
        out.writeInt(bedIntensity.size)
        bedIntensity.forEach { out.writeByte(quantize(it)) }
        bedSharpness.forEach { out.writeByte(quantize(it)) }
        out.writeInt(events.size)
        for (e in events) {
            out.writeInt(e.timeMs)
            out.writeByte(quantize(e.intensity))
            out.writeByte(quantize(e.sharpness))
            out.writeShort(e.lengthMs)
            out.writeShort(e.decayMs)
            out.writeByte(e.sources)
        }
        out.flush()
    }

    companion object {
        const val FORMAT_VERSION = 1
        const val BED_FRAME_MS = 10
        const val SOURCE_AUDIO = 1
        const val SOURCE_SUBTITLE = 2
        private const val MAGIC = 0x47485431 // "GHT1"
        private const val MAX_FRAMES = 24 * 3600 * 1000 / BED_FRAME_MS // a day of bed; guards corrupt counts

        /** Reads a cache file. Throws [IOException] if it isn't one or is another format version. */
        fun read(input: DataInputStream): HapticTrack {
            if (input.readInt() != MAGIC) throw IOException("not a haptic track")
            val version = input.readInt()
            if (version != FORMAT_VERSION) throw IOException("haptic track format $version, expected $FORMAT_VERSION")
            val analyzer = input.readInt()
            val fingerprint = Fingerprint(input.readUTF(), input.readLong(), input.readLong())
            val frames = input.readInt()
            if (frames !in 0..MAX_FRAMES) throw IOException("bad frame count $frames")
            val intensity = FloatArray(frames) { input.readUnsignedByte() / 255f }
            val sharpness = FloatArray(frames) { input.readUnsignedByte() / 255f }
            val count = input.readInt()
            if (count !in 0..MAX_FRAMES) throw IOException("bad event count $count")
            val events = List(count) {
                Event(
                    timeMs = input.readInt(),
                    intensity = input.readUnsignedByte() / 255f,
                    sharpness = input.readUnsignedByte() / 255f,
                    lengthMs = input.readUnsignedShort(),
                    decayMs = input.readUnsignedShort(),
                    sources = input.readUnsignedByte()
                )
            }
            return try {
                HapticTrack(analyzer, fingerprint, intensity, sharpness, events)
            } catch (e: IllegalArgumentException) {
                throw IOException("corrupt haptic track: ${e.message}")
            }
        }

        private fun quantize(v: Float) = Math.round(v * 255f)
    }
}
