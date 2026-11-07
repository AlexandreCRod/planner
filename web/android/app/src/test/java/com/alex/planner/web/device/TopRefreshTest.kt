package com.alex.planner.web.device

import com.alex.planner.web.device.TopRefresh.Mode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TopRefreshTest {
    private val hd60 = Mode(1, 1220, 2712, 60f)
    private val hd120 = Mode(2, 1220, 2712, 120f)
    private val hd90 = Mode(3, 1220, 2712, 90f)
    private val fhd144 = Mode(4, 1440, 3200, 144f)

    @Test fun picksTheFastestModeAtTheSameResolution() {
        // A faster mode at another resolution is never picked: the screen would switch resolution.
        assertEquals(hd120, TopRefresh.fastest(hd60, listOf(hd60, hd90, fhd144, hd120)))
    }

    @Test fun asksNothingWhenAlreadyFastest() {
        assertNull(TopRefresh.fastest(hd120, listOf(hd60, hd90, hd120)))
        // The emulator: one 60 Hz mode.
        assertNull(TopRefresh.fastest(hd60, listOf(hd60)))
        // 60.000004 vs 60: the same rate.
        assertNull(TopRefresh.fastest(hd60, listOf(hd60, Mode(5, 1220, 2712, 60.000004f))))
    }
}
