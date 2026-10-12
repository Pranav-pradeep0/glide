package com.glide.app.haptic

import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * How this phone's motor answers amplitude, measured with its own accelerometer on a table
 * (decision L5). [amplitude] maps a track's device-independent intensity through the inverse of
 * the measured curve, so equal intensity steps give equal motion steps.
 */
class HapticCalibration(
    /** Amplitudes measured, rising. */
    val amps: IntArray,
    /** Motion above the quiet noise at each amplitude, made non-decreasing. */
    val motion: FloatArray,
    /** Lowest amplitude a person feels; intensity > 0 never plays below it. */
    val floorAmp: Int,
    /** Waveform call to half of full motion. The Performer issues calls this early. */
    val latencyMs: Int
) {
    init {
        require(amps.size == motion.size && amps.size >= 2) { "curve needs two points" }
    }

    /** Amplitude 0..255 for [intensity] 0..1; 0 only for intensity 0. */
    fun amplitude(intensity: Float): Int {
        if (intensity <= 0f) return 0
        val target = intensity.coerceAtMost(1f) * motion.last()
        val i = motion.indexOfFirst { it >= target }.coerceAtLeast(1)
        val (a0, a1, m0, m1) = listOf(amps[i - 1].toFloat(), amps[i].toFloat(), motion[i - 1], motion[i])
        val amp = if (m1 > m0) a0 + (a1 - a0) * (target - m0) / (m1 - m0) else a1
        return amp.roundToInt().coerceIn(floorAmp, 255)
    }

    fun encode() = listOf(amps.joinToString(" "), motion.joinToString(" "), floorAmp, latencyMs).joinToString(";")

    companion object {
        /**
         * Accelerometer floor -> felt floor. The sensor first clearly sees the motor at amp 31
         * (2x noise) where skin already feels amp 15 (Phase 0, L5 and the plan's feel test).
         */
        private const val FELT_FLOOR_RATIO = 15f / 31f
        private const val CLEAR_OVER_NOISE = 2f

        /** The reference phone (Nothing Phone 2, Phase 0 L5), for phones never calibrated. */
        val DEFAULT = HapticCalibration(
            intArrayOf(3, 8, 15, 23, 31, 46, 64, 96, 128, 160, 192, 224, 255),
            floatArrayOf(0.002f, 0.002f, 0.005f, 0.013f, 0.036f, 0.087f, 0.203f, 0.485f, 0.661f, 0.754f, 0.833f, 0.894f, 0.906f),
            15,
            62
        )

        fun decode(s: String): HapticCalibration? = runCatching {
            val (a, m, f, l) = s.split(';')
            HapticCalibration(
                a.split(' ').map { it.toInt() }.toIntArray(),
                m.split(' ').map { it.toFloat() }.toFloatArray(),
                f.toInt(),
                l.toInt()
            )
        }.getOrNull()

        /**
         * Reads a Lab calibration run (`t_ns,kind,values` rows: `acc,x,y,z` and `vib,amp,ms`):
         * a quiet second, then 500 ms holds at rising amplitudes, played twice.
         */
        fun measure(csv: String): HapticCalibration {
            val t = ArrayList<Long>()
            val xyz = ArrayList<FloatArray>()
            val holds = ArrayList<Pair<Long, Int>>()
            for (line in csv.lineSequence()) {
                val f = line.split(',')
                when (f.getOrNull(1)) {
                    "acc" -> { t += f[0].toLong(); xyz += floatArrayOf(f[2].toFloat(), f[3].toFloat(), f[4].toFloat()) }
                    "vib" -> if (f[3] == "500") holds += f[0].toLong() to f[2].toInt()
                }
            }
            require(t.size > 1000 && holds.isNotEmpty()) { "not a calibration run" }
            val env = envelope(t, xyz)
            fun median(fromNs: Long, toNs: Long): Float {
                val xs = t.indices.filter { t[it] in fromNs until toNs }.map { env[it] }.sorted()
                return if (xs.isEmpty()) 0f else xs[xs.size / 2]
            }
            val noise = median(t[0], t[0] + 900 * MS)
            val byAmp = holds.groupBy({ it.second }) { (at, _) -> median(at + 150 * MS, at + 450 * MS) }.toSortedMap()
            val amps = byAmp.keys.toIntArray()
            val levels = byAmp.values.map { it.sorted()[it.size / 2] }
            var top = 0f
            val motion = levels.map { (it - noise).coerceAtLeast(0f).also { m -> top = maxOf(top, m) }.let { top } }.toFloatArray()
            val clear = amps[levels.indexOfFirst { it >= noise * CLEAR_OVER_NOISE }.coerceAtLeast(0)]
            // Latency: a full-strength call to half of its own plateau.
            val latency = holds.filter { it.second == amps.last() }.map { (at, _) ->
                val half = median(at + 150 * MS, at + 450 * MS) / 2
                val i = t.indices.first { t[it] >= at && env[it] >= half }
                ((t[i] - at) / MS).toInt()
            }.sorted()
            return HapticCalibration(amps, motion, (clear * FELT_FLOOR_RATIO).roundToInt(), latency[latency.size / 2])
        }

        private const val MS = 1_000_000L

        /**
         * Vibration energy: each axis minus its 40 ms moving mean (gravity and hand motion are far
         * below the motor), then RMS of the vector over 20 ms. Same as `scripts/haptics-lab.js`.
         */
        private fun envelope(t: List<Long>, xyz: List<FloatArray>): FloatArray {
            val n = t.size
            val hp = DoubleArray(n)
            for (axis in 0..2) {
                var lo = 0
                var sum = 0.0
                for (i in 0 until n) {
                    sum += xyz[i][axis]
                    while (t[i] - t[lo] > 40 * MS) sum -= xyz[lo++][axis]
                    val d = xyz[i][axis] - sum / (i - lo + 1)
                    hp[i] += d * d
                }
            }
            val env = FloatArray(n)
            var lo = 0
            var sum = 0.0
            for (i in 0 until n) {
                sum += hp[i]
                while (t[i] - t[lo] > 20 * MS) sum -= hp[lo++]
                env[i] = sqrt(sum / (i - lo + 1)).toFloat()
            }
            return env
        }
    }
}
