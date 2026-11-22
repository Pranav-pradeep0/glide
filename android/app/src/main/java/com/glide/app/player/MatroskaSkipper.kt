package com.glide.app.player

import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.util.UnstableApi
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.channels.FileChannel

/**
 * A local Matroska/WebM file served as a smaller Matroska stream that holds only the blocks
 * of the tracks [keep] accepts (by TrackNumber). The blocks of every other track are seeked
 * past, never read: Media3's extractor reads a 9 GB film's every video frame to find its
 * subtitles, this reads the block headers.
 *
 * Out comes the EBML header, Info and Tracks as they are, then each Cluster that has a kept
 * block, holding its Timestamp and those blocks (SimpleBlock or whole BlockGroup) unchanged --
 * so lacing, BlockDuration and ContentEncoding are still Media3's to read. SeekHead and Cues
 * are left out (their offsets would be wrong), so the stream can't be seeked; Attachments,
 * Chapters and Tags too, which the extractor doesn't use. When the Cues give every kept
 * block's place (mkvmerge and ffmpeg index each subtitle block), only those are read: a few
 * thousand reads instead of a header per block across the film, which on flash costs nearly
 * what reading it all does. [keep] is first asked once the
 * Tracks are out, so it can look at what the extractor made of them.
 *
 * With [startUs] (audio: its Cues index clusters, not every block) the Cues only say where to
 * start: the last cluster cued at or before [startUs]; from there every cluster is walked, and
 * only as far as the reader reads.
 *
 * Throws [IOException] on anything it can't follow; callers fall back to the whole file.
 */
@UnstableApi
internal class MatroskaSkipper(
    private val channel: FileChannel,
    private val startUs: Long? = null,
    private val keep: (Long) -> Boolean,
) : DataReader {

    private var pos = 0L
    private val size = channel.size()
    private var segmentEnd = size
    private var chunk = ByteArray(0)
    private var chunkPos = 0
    private var started = false
    private var segmentStart = 0L
    private var cuesAt = -1L
    private var timestampScale = 1_000_000L
    private val trackNumbers = ArrayList<Long>()
    private var planned = false
    /** The kept blocks' positions by cluster, from the Cues; null walks every cluster instead. */
    private var plan: Iterator<Map.Entry<Long, List<Long>>>? = null

    /** Whether the kept blocks were found through the Cues rather than by walking every cluster. */
    val usesIndex get() = plan != null

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        while (chunkPos == chunk.size) {
            chunk = nextChunk() ?: return C.RESULT_END_OF_INPUT
            chunkPos = 0
        }
        val n = minOf(length, chunk.size - chunkPos)
        System.arraycopy(chunk, chunkPos, buffer, offset, n)
        chunkPos += n
        return n
    }

    /** The next piece of the output stream, or null at the end of the segment. */
    private fun nextChunk(): ByteArray? {
        val out = ByteArrayOutputStream()
        if (!started) {
            started = true
            val ebml = header(0) ?: throw IOException("empty file")
            val ebmlEnd = ebml.end
            if (ebml.id != ID_EBML || ebmlEnd == null) throw IOException("not Matroska")
            copy(0, ebmlEnd, out)
            val segment = header(ebmlEnd)
            if (segment?.id != ID_SEGMENT) throw IOException("no Segment")
            segment.size?.let { segmentEnd = minOf(size, segment.dataStart + it) }
            pos = segment.dataStart
            segmentStart = segment.dataStart
            out.write(vintId(ID_SEGMENT))
            out.write(UNKNOWN_SIZE)
        }
        while (pos < segmentEnd) {
            val e = header(pos) ?: break
            when (e.id) {
                ID_INFO, ID_TRACKS -> {
                    val end = e.end ?: throw IOException("unknown-size ${e.id}")
                    copy(pos, end, out)
                    pos = end
                    if (e.id == ID_INFO) children(e).firstOrNull { it.id == ID_TIMESTAMP_SCALE }?.let { timestampScale = uint(it) }
                    if (e.id == ID_TRACKS) {
                        for (entry in children(e)) if (entry.id == ID_TRACK_ENTRY) {
                            children(entry).firstOrNull { it.id == ID_TRACK_NUMBER }?.let { trackNumbers += uint(it) }
                        }
                        return out.toByteArray()
                    }
                }
                ID_SEEK_HEAD -> {
                    for (seek in children(e)) if (seek.id == ID_SEEK) {
                        val fields = children(seek).associate { it.id to uint(it) }
                        if (fields[ID_SEEK_ID] == ID_CUES) fields[ID_SEEK_POSITION]?.let { cuesAt = segmentStart + it }
                    }
                    pos = e.end ?: throw IOException("unknown-size SeekHead")
                }
                ID_CLUSTER -> {
                    if (!planned) {
                        planned = true
                        if (startUs != null) {
                            pos = startCluster(startUs)
                            continue
                        }
                        plan = cuePlan()?.entries?.iterator()
                    }
                    val plan = plan
                    if (plan != null) {
                        while (plan.hasNext()) {
                            val (cluster, blocks) = plan.next()
                            indexedCluster(cluster, blocks, out)
                            if (out.size() > 0) return out.toByteArray()
                        }
                        break
                    }
                    pos = cluster(e, out)
                    if (out.size() > 0) return out.toByteArray()
                }
                ID_EBML, ID_SEGMENT -> break // a chained segment: the extractor stops at the first too
                else -> pos = e.end ?: throw IOException("unknown-size ${e.id}")
            }
        }
        pos = segmentEnd
        return out.toByteArray().takeIf { it.isNotEmpty() }
    }

    /** Writes [cluster] with only its kept blocks to [out] (nothing if none). Returns where the next element starts. */
    private fun cluster(cluster: Element, out: ByteArrayOutputStream): Long {
        val end = cluster.end ?: segmentEnd
        val body = ByteArrayOutputStream()
        var kept = false
        var p = cluster.dataStart
        while (p < end) {
            val e = header(p) ?: break
            // An unknown-size cluster ends where the next top-level element starts.
            if (cluster.size == null && e.id in TOP_LEVEL) break
            val eEnd = e.end ?: throw IOException("unknown-size ${e.id} in cluster")
            when (e.id) {
                ID_TIMESTAMP -> copy(p, eEnd, body)
                ID_SIMPLE_BLOCK -> if (keep(trackNumber(e.dataStart))) { copy(p, eEnd, body); kept = true }
                ID_BLOCK_GROUP -> if (keep(blockGroupTrack(e))) { copy(p, eEnd, body); kept = true }
            }
            p = eEnd
        }
        if (kept) writeCluster(body, out)
        return if (cluster.size == null) p else end
    }

    private fun writeCluster(body: ByteArrayOutputStream, out: ByteArrayOutputStream) {
        out.write(vintId(ID_CLUSTER))
        out.write(vintSize(body.size().toLong()))
        body.writeTo(out)
    }

    /**
     * Where the kept tracks' blocks are, by cluster (segment offsets), when the Cues list every
     * kept track with CueRelativePosition -- mkvmerge and ffmpeg index each subtitle block --
     * so the clusters need not be walked; null otherwise.
     */
    // ponytail: trusts that a track listed in the Cues is listed whole, as both muxers do; a
    // muxer indexing only some of a subtitle's blocks would lose the rest. Walk if one shows up.
    private fun cuePlan(): Map<Long, List<Long>>? {
        val kept = trackNumbers.filter(keep).toSet()
        if (kept.isEmpty()) return emptyMap()
        val cues = cues() ?: return null
        val blocks = java.util.TreeMap<Long, java.util.TreeSet<Long>>()
        val listed = HashSet<Long>()
        for (point in children(cues)) if (point.id == ID_CUE_POINT) {
            for (positions in children(point)) if (positions.id == ID_CUE_TRACK_POSITIONS) {
                val fields = children(positions).associate { it.id to uint(it) }
                val track = fields[ID_CUE_TRACK] ?: continue
                if (track !in kept) continue
                val cluster = fields[ID_CUE_CLUSTER_POSITION] ?: return null
                val relative = fields[ID_CUE_RELATIVE_POSITION] ?: return null
                blocks.getOrPut(cluster) { java.util.TreeSet() }.add(relative)
                listed += track
            }
        }
        return if (listed == kept) blocks.mapValues { it.value.toList() } else null
    }

    private fun cues() = cuesAt.takeIf { it >= 0 }?.let(::header)?.takeIf { it.id == ID_CUES && it.size != null }

    /** Where the last cluster cued at or before [startUs] starts (file offset); [pos] for 0. */
    private fun startCluster(startUs: Long): Long {
        if (startUs <= 0) return pos
        val cues = cues() ?: throw IOException("no Cues to start at $startUs")
        var best = -1L
        var bestUs = -1L
        for (point in children(cues)) if (point.id == ID_CUE_POINT) {
            val fields = children(point)
            val us = (fields.firstOrNull { it.id == ID_CUE_TIME } ?: continue).let(::uint) * timestampScale / 1000
            if (us > startUs || us < bestUs) continue
            val cluster = fields.filter { it.id == ID_CUE_TRACK_POSITIONS }.firstNotNullOfOrNull { positions ->
                children(positions).firstOrNull { it.id == ID_CUE_CLUSTER_POSITION }?.let(::uint)
            } ?: continue
            best = cluster
            bestUs = us
        }
        return if (best < 0) pos else segmentStart + best
    }

    /** Writes the cluster at [cluster] holding its Timestamp and the blocks at [blocks] (cluster-relative). */
    private fun indexedCluster(cluster: Long, blocks: List<Long>, out: ByteArrayOutputStream) {
        val e = header(segmentStart + cluster)?.takeIf { it.id == ID_CLUSTER } ?: throw IOException("Cues point off a Cluster")
        val body = ByteArrayOutputStream()
        var p = e.dataStart
        while (true) {
            val child = header(p) ?: throw IOException("no Timestamp in Cluster at $cluster")
            if (child.id == ID_SIMPLE_BLOCK || child.id == ID_BLOCK_GROUP) throw IOException("no Timestamp in Cluster at $cluster")
            val end = child.end ?: throw IOException("unknown-size ${child.id} in cluster")
            if (child.id == ID_TIMESTAMP) { copy(p, end, body); break }
            p = end
        }
        for (relative in blocks) {
            val at = e.dataStart + relative
            val block = header(at) ?: throw IOException("Cues point past the end")
            val track = when (block.id) {
                ID_SIMPLE_BLOCK -> trackNumber(block.dataStart)
                ID_BLOCK_GROUP -> blockGroupTrack(block)
                else -> throw IOException("Cues point at ${block.id}, not a block")
            }
            if (!keep(track)) throw IOException("Cues point at track $track's block")
            copy(at, block.end ?: throw IOException("unknown-size block"), body)
        }
        writeCluster(body, out)
    }

    private fun children(parent: Element): List<Element> {
        val end = parent.end ?: throw IOException("unknown-size ${parent.id}")
        val list = ArrayList<Element>()
        var p = parent.dataStart
        while (p < end) {
            val e = header(p) ?: break
            list += e
            p = e.end ?: break
        }
        return list
    }

    private fun uint(e: Element): Long {
        var v = 0L
        for (i in 0 until (e.size ?: 0L).toInt().coerceAtMost(8)) v = (v shl 8) or byteAt(e.dataStart + i).toLong()
        return v
    }

    private fun blockGroupTrack(group: Element): Long {
        var p = group.dataStart
        while (p < group.end!!) {
            val e = header(p) ?: break
            if (e.id == ID_BLOCK) return trackNumber(e.dataStart)
            p = e.end ?: break
        }
        throw IOException("BlockGroup without a Block")
    }

    // --- Reading -----------------------------------------------------------------------------

    private class Element(val id: Long, val dataStart: Long, val size: Long?) {
        val end get() = size?.let { dataStart + it }
    }

    /** One small page around each header: the blocks between them are never read. */
    private val window = ByteBuffer.allocate(WINDOW)
    private var windowStart = -1L
    private var windowLength = 0

    private fun byteAt(p: Long): Int {
        if (windowStart < 0 || p < windowStart || p >= windowStart + windowLength) {
            window.clear()
            var n = 0
            while (n < WINDOW) {
                val r = channel.read(window, p + n)
                if (r <= 0) break
                n += r
            }
            if (n == 0) throw IOException("unexpected end of file at $p")
            windowStart = p
            windowLength = n
        }
        return window.get((p - windowStart).toInt()).toInt() and 0xFF
    }

    /** A variable-length integer at [p]: its value (marker bit kept for ids) and length. */
    private fun vint(p: Long, keepMarker: Boolean): Pair<Long, Int> {
        val first = byteAt(p)
        val length = Integer.numberOfLeadingZeros(first) - 23
        if (length > 8) throw IOException("bad EBML length at $p")
        var value = (if (keepMarker) first else first and (0xFF shr length)).toLong()
        for (i in 1 until length) value = (value shl 8) or byteAt(p + i).toLong()
        return value to length
    }

    /** The element header at [p], or null at the end of the file. */
    private fun header(p: Long): Element? {
        if (p >= size) return null
        val (id, idLength) = vint(p, keepMarker = true)
        val (value, sizeLength) = vint(p + idLength, keepMarker = false)
        val unknown = value == (1L shl (7 * sizeLength)) - 1
        val element = Element(id, p + idLength + sizeLength, if (unknown) null else value)
        if (element.end?.let { it > size } == true) throw IOException("element past the end of the file at $p")
        return element
    }

    private fun trackNumber(blockStart: Long) = vint(blockStart, keepMarker = false).first

    private fun copy(from: Long, to: Long, out: ByteArrayOutputStream) {
        val buffer = ByteBuffer.allocate((to - from).toInt())
        while (buffer.hasRemaining()) {
            if (channel.read(buffer, from + buffer.position()) <= 0) throw IOException("unexpected end of file at $from")
        }
        out.write(buffer.array(), 0, buffer.position())
    }

    companion object {
        private const val WINDOW = 4096
        private const val ID_EBML = 0x1A45DFA3L
        private const val ID_SEGMENT = 0x18538067L
        private const val ID_INFO = 0x1549A966L
        private const val ID_TRACKS = 0x1654AE6BL
        private const val ID_CLUSTER = 0x1F43B675L
        private const val ID_TIMESTAMP = 0xE7L
        private const val ID_SIMPLE_BLOCK = 0xA3L
        private const val ID_BLOCK_GROUP = 0xA0L
        private const val ID_BLOCK = 0xA1L
        private const val ID_TRACK_ENTRY = 0xAEL
        private const val ID_TRACK_NUMBER = 0xD7L
        private const val ID_SEEK_HEAD = 0x114D9B74L
        private const val ID_SEEK = 0x4DBBL
        private const val ID_SEEK_ID = 0x53ABL
        private const val ID_SEEK_POSITION = 0x53ACL
        private const val ID_CUES = 0x1C53BB6BL
        private const val ID_CUE_POINT = 0xBBL
        private const val ID_CUE_TIME = 0xB3L
        private const val ID_TIMESTAMP_SCALE = 0x2AD7B1L
        private const val ID_CUE_TRACK_POSITIONS = 0xB7L
        private const val ID_CUE_TRACK = 0xF7L
        private const val ID_CUE_CLUSTER_POSITION = 0xF1L
        private const val ID_CUE_RELATIVE_POSITION = 0xF0L
        private val TOP_LEVEL = setOf(
            ID_CLUSTER, ID_INFO, ID_TRACKS, ID_EBML, ID_SEGMENT,
            0x114D9B74L /* SeekHead */, 0x1C53BB6BL /* Cues */, 0x1941A469L /* Attachments */,
            0x1043A770L /* Chapters */, 0x1254C367L, /* Tags */
        )
        private val UNKNOWN_SIZE = byteArrayOf(0x01, -1, -1, -1, -1, -1, -1, -1)

        private fun vintId(id: Long): ByteArray {
            val length = (64 - java.lang.Long.numberOfLeadingZeros(id) + 7) / 8
            return ByteArray(length) { (id shr (8 * (length - 1 - it))).toByte() }
        }

        /** An 8-byte size, which every reader takes. */
        private fun vintSize(value: Long) = ByteArray(8) { (value shr (8 * (7 - it))).toByte() }.also { it[0] = 0x01 }
    }
}
