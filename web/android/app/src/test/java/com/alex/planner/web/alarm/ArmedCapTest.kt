package com.alex.planner.web.alarm

import org.junit.Assert.assertEquals
import org.junit.Test

/** With many reminders, only the nearest are set (AlarmManager's 500 limit, 194). */
class ArmedCapTest {
    @Test fun allAreSetWhenThereAreFew() {
        assertEquals(Long.MAX_VALUE, AlarmScheduler.horizon(listOf(5, 1, 3), cap = 3))
        assertEquals(Long.MAX_VALUE, AlarmScheduler.horizon(emptyList()))
    }

    @Test fun onlyTheNearestWhenThereAreMany() {
        assertEquals(3L, AlarmScheduler.horizon(listOf(9, 1, 3, 7, 2), cap = 3))
        val many = (1..1000L).shuffled()
        assertEquals(AlarmScheduler.MAX_ARMED.toLong(), AlarmScheduler.horizon(many))
    }
}
