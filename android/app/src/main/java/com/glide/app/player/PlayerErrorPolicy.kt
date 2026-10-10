package com.glide.app.player

import androidx.media3.common.PlaybackException

/**
 * What to do with a playback failure. Pure, so the decision can be tested without a player.
 *
 * A source or IO failure leaves ExoPlayer in STATE_IDLE permanently: playback is dead until
 * something calls prepare() again. ExoPlayer's own DefaultLoadErrorHandlingPolicy has
 * already retried the load before the error surfaces, so retrying here is a last resort --
 * bounded, and only for failures that can actually change their mind.
 */
object PlayerErrorPolicy {

    const val MAX_IO_RETRIES = 3
    const val IO_RETRY_DELAY_MS = 1500L

    private val IO_ERROR_CODES = 2000..2999

    /**
     * Source errors that never come back on their own: a file that is not there, a
     * permission that has lapsed, a URL the server answered 4xx for. Retrying these only
     * holds the message back by the retry budget -- about five seconds -- before showing
     * the user the same failure.
     */
    private val PERMANENT = setOf(
        PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,          // 2004
        PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND,           // 2005
        PlaybackException.ERROR_CODE_IO_NO_PERMISSION,            // 2006
        PlaybackException.ERROR_CODE_IO_CLEARTEXT_NOT_PERMITTED,  // 2007
    )

    /**
     * Whether a failed load is worth another prepare(). The transient half of the IO range
     * -- a dropped connection, a timeout, a server that refused one range request --
     * recovers; the rest does not.
     */
    @JvmStatic
    fun shouldRetry(errorCode: Int, retriesSoFar: Int): Boolean =
        errorCode in IO_ERROR_CODES &&
            errorCode !in PERMANENT &&
            retriesSoFar < MAX_IO_RETRIES

    /**
     * A live stream that fell behind its window is not broken; it must rejoin the edge.
     * Bounded like IO retries: a stream whose window keeps moving past the player (a
     * server publishing faster than the device can load) would otherwise loop forever.
     */
    @JvmStatic
    fun shouldRejoinLiveEdge(errorCode: Int, retriesSoFar: Int): Boolean =
        errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW &&
            retriesSoFar < MAX_IO_RETRIES
}
