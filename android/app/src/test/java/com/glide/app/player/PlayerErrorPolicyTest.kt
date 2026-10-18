package com.glide.app.player

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayerErrorPolicyTest {

    @Test
    fun `retries a dropped connection until the budget runs out`() {
        val unspecifiedIo = 2000
        assertTrue(PlayerErrorPolicy.shouldRetry(unspecifiedIo, 0))
        assertTrue(PlayerErrorPolicy.shouldRetry(unspecifiedIo, 2))
        assertFalse(PlayerErrorPolicy.shouldRetry(unspecifiedIo, 3))
    }

    /** Retrying these only delays the message the user needs to see. */
    @Test
    fun `never retries a failure that cannot change its mind`() {
        for (code in listOf(2004, 2005, 2006, 2007, 2008)) {
            assertFalse("error $code should not be retried", PlayerErrorPolicy.shouldRetry(code, 0))
        }
    }

    @Test
    fun `leaves failures outside the source range alone`() {
        assertFalse(PlayerErrorPolicy.shouldRetry(1002, 0)) // behind live window
        assertFalse(PlayerErrorPolicy.shouldRetry(3001, 0)) // malformed container
        assertFalse(PlayerErrorPolicy.shouldRetry(4001, 0)) // decoder init failed
    }

    @Test
    fun `rejoins the live edge only for a stream that fell behind`() {
        assertTrue(PlayerErrorPolicy.shouldRejoinLiveEdge(1002, 0))
        assertFalse(PlayerErrorPolicy.shouldRejoinLiveEdge(2005, 0))
        // A window that keeps outrunning the player gives up instead of looping.
        assertFalse(PlayerErrorPolicy.shouldRejoinLiveEdge(1002, PlayerErrorPolicy.MAX_IO_RETRIES))
    }

    @Test
    fun `restarts from the beginning only when a resume point is out of range`() {
        assertTrue(PlayerErrorPolicy.shouldRestartFromBeginning(2008, openingAtResumePoint = true))
        // Opened at zero, or already playing: starting over would not help, or would surprise.
        assertFalse(PlayerErrorPolicy.shouldRestartFromBeginning(2008, openingAtResumePoint = false))
        assertFalse(PlayerErrorPolicy.shouldRestartFromBeginning(2000, openingAtResumePoint = true))
    }
}
