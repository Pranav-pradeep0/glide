package com.glide.app.haptic

import com.glide.app.haptic.HapticMeaning.Kind
import java.io.File
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Trains the moment score ([HapticSounds.moment], docs/haptics-decisions.md, Moments) on the tuning
 * films and writes it into HapticSounds.kt's `<model>` block. Ground truth by script, as
 * [HapticBenchTest]: a window is a moment if it meets an SDH effect cue (from [LEAD_MS] before it).
 * Only windows where something could be felt are learned from (bass or a hit near the film's loud
 * level, or a light onset): the score decides among those, silence needs no deciding.
 *
 * L1-regularised logistic regression over all 521 YAMNet scores and the Listener's features, so it
 * keeps a few classes ([HapticSounds.KEPT]). The penalty is chosen by leaving one tuning film out
 * at a time (ROC AUC on it). [HapticBenchTest.HOLDOUT] films are scored, never learned from.
 *
 * Writing the block changes the shipped model: rerun the tests after (the run that writes it still
 * scores the old one). A change to [HapticSounds.KEPT] must bump [HapticListener.VERSION].
 */
class HapticMomentTrain {
    private class Film(val name: String, val x: List<FloatArray>, val y: BooleanArray)

    @Test
    fun train() {
        val dir = File(HapticHarness.fixturesDir(), "films")
        val films = dir.listFiles { f -> f.name.endsWith(".mka") && File(dir, f.nameWithoutExtension + ".srt").isFile && File(dir, f.nameWithoutExtension + ".sounds").isFile }
            .orEmpty().sortedBy { it.name }.mapNotNull(::load)
        val tuning = films.filter { it.name !in HapticBenchTest.HOLDOUT }
        assumeTrue("no tuning films with subtitles and sounds", tuning.size >= 2)
        for (f in films) println("%-14s %6d windows, %4d moments".format(f.name, f.y.size, f.y.count { it }))

        // Strongest penalty first, each fit starting from the last.
        val lambdas = listOf(0.02, 0.01, 0.005, 0.003, 0.002, 0.001)
        val auc = lambdas.associateWith { 0.0 }.toMutableMap()
        val kept = lambdas.associateWith { 0 }.toMutableMap()
        for (out in tuning) {
            val train = tuning - out
            var start: DoubleArray? = null
            for (l in lambdas) {
                val m = fit(train, l, start)
                start = m.z
                auc[l] = auc.getValue(l) + auc(out, m) / tuning.size
                kept[l] = kept.getValue(l) + m.classes().size
            }
        }
        for (l in lambdas) println("lambda %.3f: left-out AUC %.3f, %.1f classes".format(l, auc[l], kept.getValue(l) / tuning.size.toDouble()))
        // The fewest classes within 0.005 of the best: a handful of sounds is easier to trust.
        val best = auc.values.max()
        val lambda = lambdas.first { auc.getValue(it) >= best - 0.005 }
        var start: DoubleArray? = null
        lateinit var model: Model
        for (l in lambdas.takeWhile { it >= lambda }) { model = fit(tuning, l, start); start = model.z }
        for (f in films) println("%-14s AUC %.3f".format(f.name + if (f.name in HapticBenchTest.HOLDOUT) "*" else "", auc(f, model)))
        write(model, lambda, tuning.map { it.name })
    }

    private fun load(file: File): Film? {
        val name = file.nameWithoutExtension
        val cues = HapticFilmTest.cues(File(file.parentFile, "$name.srt").readText())
        val effects = cues.filter { c -> HapticMeaning.tags(listOf(c)).any { it.kind in EFFECTS } }
            .map { it.startMs - LEAD_MS..maxOf(it.endMs, it.startMs + LEAD_MS) }
        if (effects.isEmpty()) return null // plain subtitles: every window would read as still
        val film = HapticFilmTest()
        val raw = film.load(file).raw
        val sounds = film.sounds(File(file.parentFile, "$name.sounds"))
        val listened = HapticDirector.listened(raw, HapticDirector.Film(raw), sounds.size)
        val x = mutableListOf<FloatArray>()
        val y = mutableListOf<Boolean>()
        for (k in sounds.indices) {
            val l = listened[k]
            if (l[0] <= -1.9f && l[3] <= -1.2f && l[4] <= -3f) continue // nothing to feel: bass and hits far under the film's
            val from = k * HapticSounds.HOP_MS
            x += FloatArray(HapticSounds.CLASSES) { HapticSounds.logit(sounds[k][it]) } + l
            y += effects.any { from < it.last && it.first < from + HapticSounds.WINDOW_MS }
        }
        return Film(name, x, y.toBooleanArray())
    }

    /** A fit on standardised features ([z], intercept last) and the means and spreads it was standardised by. */
    private class Model(val z: DoubleArray, val mean: DoubleArray, val sd: DoubleArray) {
        fun logit(x: FloatArray): Double {
            var s = z.last()
            for (j in x.indices) if (sd[j] > 0) s += z[j] * (x[j] - mean[j]) / sd[j]
            return s
        }

        /** YAMNet classes with any weight. */
        fun classes() = (0 until HapticSounds.CLASSES).filter { z[it] != 0.0 || it == HapticSounds.SPEECH }
    }

    /** Mean log loss plus [lambda] times the weights' L1 norm (not the intercept), by FISTA. */
    private fun fit(films: List<Film>, lambda: Double, start: DoubleArray?): Model {
        val x = films.flatMap { it.x }
        val y = films.flatMap { it.y.toList() }
        val n = x.size
        val d = x[0].size
        val mean = DoubleArray(d) { j -> x.sumOf { it[j].toDouble() } / n }
        val sd = DoubleArray(d) { j -> Math.sqrt(x.sumOf { (it[j] - mean[j]).let { v -> v * v } } / n).let { if (it < 1e-6) 0.0 else it } }
        val m = FloatArray(n * (d + 1))
        for (i in 0 until n) {
            for (j in 0 until d) m[i * (d + 1) + j] = if (sd[j] > 0) ((x[i][j] - mean[j]) / sd[j]).toFloat() else 0f
            m[i * (d + 1) + d] = 1f
        }
        val step = 1 / lipschitz(m, n, d + 1)
        var w = start?.copyOf() ?: DoubleArray(d + 1)
        var v = w.copyOf()
        var t = 1.0
        val g = DoubleArray(d + 1)
        repeat(ITERATIONS) {
            g.fill(0.0)
            for (i in 0 until n) {
                var s = 0.0
                val o = i * (d + 1)
                for (j in 0..d) s += m[o + j] * v[j]
                val r = (1 / (1 + Math.exp(-s)) - if (y[i]) 1 else 0) / n
                for (j in 0..d) g[j] += r * m[o + j]
            }
            val next = DoubleArray(d + 1) { j ->
                val u = v[j] - step * g[j]
                if (j == d) u else Math.signum(u) * maxOf(0.0, Math.abs(u) - step * lambda)
            }
            val tn = (1 + Math.sqrt(1 + 4 * t * t)) / 2
            v = DoubleArray(d + 1) { j -> next[j] + (t - 1) / tn * (next[j] - w[j]) }
            w = next
            t = tn
        }
        return Model(w, mean, sd)
    }

    /** The log loss's Lipschitz constant, largest eigenvalue of MᵀM / 4n, by power iteration. */
    private fun lipschitz(m: FloatArray, n: Int, d: Int): Double {
        var v = DoubleArray(d) { 1.0 }
        var e = 1.0
        repeat(30) {
            val u = DoubleArray(d)
            for (i in 0 until n) {
                var s = 0.0
                for (j in 0 until d) s += m[i * d + j] * v[j]
                for (j in 0 until d) u[j] += s * m[i * d + j]
            }
            e = Math.sqrt(u.sumOf { it * it })
            v = DoubleArray(d) { u[it] / e }
        }
        return e / (4 * n)
    }

    /** Chance a moment window scores over a still one. */
    private fun auc(f: Film, m: Model): Double {
        val s = f.x.map(m::logit)
        val order = s.indices.sortedBy { s[it] }
        var rank = 0.0
        var pos = 0
        for ((r, i) in order.withIndex()) if (f.y[i]) { rank += r + 1; pos++ }
        val neg = f.y.size - pos
        return (rank - pos * (pos + 1) / 2.0) / (pos.toLong() * neg).coerceAtLeast(1)
    }

    /** The fit in raw features, as HapticSounds.kt's `<model>` block. */
    private fun write(m: Model, lambda: Double, names: List<String>) {
        val classes = m.classes()
        val raw = (classes + (HapticSounds.CLASSES until m.mean.size)).map { j -> if (m.sd[j] > 0) m.z[j] / m.sd[j] else 0.0 }
        val bias = m.z.last() - (classes + (HapticSounds.CLASSES until m.mean.size)).sumOf { j -> if (m.sd[j] > 0) m.z[j] * m.mean[j] / m.sd[j] else 0.0 }
        val map = File(HapticHarness.fixturesDir(), "yamnet/yamnet_class_map.csv").takeIf { it.isFile }?.readLines()?.drop(1)
            ?.associate { l -> l.substringBefore(',').toInt() to l.substringAfter(',').substringAfter(',').trim('"') }.orEmpty()
        println("kept: " + classes.joinToString { "$it ${map[it]} %+.2f".format(m.z[it]) })
        println("listened (bass, rise, body, hit, light): " + (HapticSounds.CLASSES until m.mean.size).joinToString { "%+.2f".format(m.z[it]) })
        val block = buildString {
            appendLine("    // <model> written by HapticMomentTrain from ${names.joinToString()} (lambda $lambda); don't edit by hand.")
            for (c in classes) appendLine("    // $c ${map[c] ?: ""}")
            appendLine("    val KEPT = intArrayOf(${classes.joinToString()})")
            appendLine("    val WEIGHTS = floatArrayOf(${(raw + bias).joinToString { "%.4ff".format(it) }})")
            append("    // </model>")
        }
        val file = File("src/main/java/com/glide/app/haptic/HapticSounds.kt")
        val text = file.readText()
        val updated = text.replace(Regex("    // <model>[\\s\\S]*?// </model>"), Regex.escapeReplacement(block))
        if (updated != text) { file.writeText(updated); println("model written: rerun to score it") }
    }

    companion object {
        private val EFFECTS = HapticMeaning.EFFECTS
        private const val LEAD_MS = 1000
        private const val ITERATIONS = 300
    }
}
