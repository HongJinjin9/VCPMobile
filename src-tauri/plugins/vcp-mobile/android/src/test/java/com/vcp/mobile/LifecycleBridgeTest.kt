package com.vcp.mobile

import android.app.Activity
import android.content.res.Configuration
import androidx.lifecycle.LifecycleOwner
import app.tauri.plugin.JSObject
import io.mockk.every
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class LifecycleBridgeTest {
    @Test
    fun snapshotRetainsLatestTransitionBeforeNativeSubscription() {
        val bridge = LifecycleBridge()
        val owner = mockk<LifecycleOwner>()

        bridge.onResume(owner)
        bridge.onPause(owner)
        bridge.onStop(owner)
        bridge.onLowMemory()
        bridge.onConfigurationChanged(Configuration().apply {
            uiMode = Configuration.UI_MODE_NIGHT_YES
        })

        val background = bridge.snapshot()
        assertEquals("pause", background.getString("state"))
        assertEquals(2L, background.getLong("epoch"))

        bridge.onResume(owner)
        assertEquals("resume", bridge.snapshot().getString("state"))
        assertEquals(3L, bridge.snapshot().getLong("epoch"))
    }

    @Test
    fun pauseAndStopEmitOneTransitionAndDetachStopsNativeDelivery() {
        val activity = Robolectric.buildActivity(Activity::class.java).create().get()
        val plugin = mockk<VcpMobilePlugin>()
        val events = mutableListOf<Pair<String, JSObject>>()
        every { plugin.emitNativeEvent(any(), any()) } answers {
            events.add(firstArg<String>() to secondArg<JSObject>())
            Unit
        }
        val bridge = LifecycleBridge()
        val owner = mockk<LifecycleOwner>()
        bridge.attach(activity, plugin)
        try {
            bridge.onResume(owner)
            events.clear()
            bridge.onPause(owner)
            bridge.onStop(owner)
            assertEquals(1, events.size)
            assertEquals("lifecycle", events.single().first)
            assertEquals("pause", events.single().second.getString("state"))

            bridge.detach()
            bridge.onResume(owner)
            assertEquals(1, events.size)
        } finally {
            bridge.detach()
        }
    }
}
