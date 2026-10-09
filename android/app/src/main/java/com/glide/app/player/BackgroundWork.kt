package com.glide.app.player

import android.os.Process
import java.util.concurrent.Executors

/**
 * The one thread the app's file and MediaStore work runs on.
 *
 * Every caller here reads storage -- often the very file being played -- so what matters is
 * not finishing fast but staying out of playback's way. A bare `thread {}` runs at the
 * default (foreground) priority and competes with the decoder for CPU and IO, and several
 * at once is what made scrubbing stutter while subtitles were extracting. One thread at
 * [Process.THREAD_PRIORITY_BACKGROUND] puts all of it in the background cgroup, where the
 * scheduler gives playback the CPU first, and serialising means a burst of requests queues
 * instead of thrashing the disk.
 *
 * ponytail: no cancellation -- a submitted task always runs, because every one of them owns
 * a JS Promise that has to settle. Repeated scans are coalesced on the JS side, where the
 * waiting callers can share one answer. Interrupting a running decode would mean a cancel
 * flag threaded through every loop; add it if an abandoned extraction turns out to matter.
 */
object BackgroundWork {

    private val executor = Executors.newSingleThreadExecutor { runnable ->
        Thread({
            Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
            runnable.run()
        }, "glide-background")
    }

    fun submit(block: () -> Unit) = executor.execute(block)
}
