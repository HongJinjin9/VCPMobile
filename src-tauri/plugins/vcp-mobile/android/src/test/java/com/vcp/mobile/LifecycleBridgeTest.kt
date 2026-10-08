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
    fun sequenceContinuesWhenNativeBridgeIsRecreated() {
        val owner = mockk<LifecycleOwner>()
        val original = LifecycleBridge()
        original.onResume(owner)
        val oldSequence = original.snapshot().getLong("nativeSequence")
        original.detach()

        val replacement = LifecycleBridge()
        replacement.onResume(owner)
        assertEquals(oldSequence + 1L, replacement.snapshot().getLong("nativeSequence"))
    }

    @Test
    fun snapshotRetainsLatestTransitionBeforeNativeSubscription() {
        val bridge = LifecycleBridge()
        val owner = mockk<LifecycleOwner>()

        bridge.onResume(owner)
        val resumeSequence = bridge.snapshot().getLong("nativeSequence")
        bridge.onPause(owner)
        bridge.onStop(owner)
        bridge.onLowMemory()
        bridge.onConfigurationChanged(Configuration().apply {
            uiMode = Configuration.UI_MODE_NIGHT_YES
        })

        val background = bridge.snapshot()
        assertEquals("background", background.getString("phase"))
        assertEquals(resumeSequence + 1L, background.getLong("nativeSequence"))
        assertEquals(true, background.getBoolean("snapshot"))

        bridge.onResume(owner)
        assertEquals("active", bridge.snapshot().getString("phase"))
        assertEquals(resumeSequence + 2L, bridge.snapshot().getLong("nativeSequence"))
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
            assertEquals("background", events.single().second.getString("phase"))
            assertEquals(false, events.single().second.getBoolean("snapshot"))
            assertEquals(bridge.snapshot().getLong("nativeSequence"), events.single().second.getLong("nativeSequence"))

            bridge.detach()
            bridge.onResume(owner)
            assertEquals(1, events.size)
        } finally {
            bridge.detach()
        }
    }
}
