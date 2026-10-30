package com.alex.planner.web.alarm

import org.junit.Assert.assertEquals
import org.junit.Test

/** A ring restarted after the app was killed carries on for what's left of it (194). */
class RingStateTest {
    private val minute = 60_000L

    @Test fun carriesOnForWhatsLeft() {
        assertEquals(10 * minute, RingState.left(1_000, 10 * minute, 1_000))
        assertEquals(7 * minute, RingState.left(1_000, 10 * minute, 1_000 + 3 * minute))
    }

    @Test fun overOnceItsTimeIsUp() {
        assertEquals(0L, RingState.left(1_000, 10 * minute, 1_000 + 10 * minute))
        assertEquals(0L, RingState.left(1_000, 10 * minute, 1_000 + 60 * minute))
    }

    @Test fun aClockSetBackNeverMakesItLonger() {
        assertEquals(10 * minute, RingState.left(1_000 + 5 * minute, 10 * minute, 1_000))
    }
}
