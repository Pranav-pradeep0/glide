package com.glide.app.player

import android.os.Process
import android.util.Log
import com.facebook.react.bridge.Promise
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Where the app's file and MediaStore work runs.
 *
 * Every caller here reads storage -- often the very file being played -- so what matters is
 * not finishing fast but staying out of playback's way. A bare `thread {}` runs at the
 * default (foreground) priority and competes with the decoder for CPU and IO, and several
 * at once is what made scrubbing stutter while subtitles were extracting. These threads run
 * at [Process.THREAD_PRIORITY_BACKGROUND], in the background cgroup, where the scheduler
 * gives playback the CPU first, and a burst of requests queues instead of thrashing the disk.
 *
 * Two lanes, so the slow work cannot stall the quick work behind it. [submitLong] is for
 * jobs that read a whole file or decode minutes of audio -- extracting a subtitle stream,
 * aligning against the soundtrack -- and runs them one at a time. [submit] is for library
 * scans and metadata reads, which a screen is waiting on; two threads, so the video and
 * music scans on a cold start do not queue behind each other either.
 *
 * ponytail: no cancellation -- a submitted task always runs, because every one of them owns
 * a JS Promise that has to settle. So an abandoned extraction still holds the long lane
 * until it finishes. Interrupting a running decode means a cancel flag threaded through
 * every loop; add it if that wait turns out to matter.
 */
object BackgroundWork {

    private fun lane(threads: Int, name: String): ExecutorService =
        Executors.newFixedThreadPool(threads) { runnable ->
            Thread({
                Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
                runnable.run()
            }, name)
        }

    private val quick = lane(2, "glide-background")
    private val long = lane(1, "glide-background-long")

    fun submit(promise: Promise, block: () -> Unit) = quick.execute(guarded(promise, block))

    fun submitLong(promise: Promise, block: () -> Unit) = long.execute(guarded(promise, block))

    /**
     * Callers catch [Exception], but an [Error] -- OOM on a huge library or a 4K frame,
     * a class that failed to initialise -- would escape to the pool thread and kill the
     * process with the Promise unsettled. Rejecting an already-settled Promise is a no-op.
     */
    private fun guarded(promise: Promise, block: () -> Unit) = Runnable {
        try {
            block()
        } catch (t: Throwable) {
            Log.e("BackgroundWork", "task failed", t)
            promise.reject("E_BACKGROUND", t.message ?: t.javaClass.simpleName, t)
        }
    }
}
