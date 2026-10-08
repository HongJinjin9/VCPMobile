import { onMounted, onUnmounted, ref, watch } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useAppLifecycleStore } from '../stores/appLifecycle';
import { useChatStreamStore } from '../stores/chatStreamStore';
import type { LifecycleSnapshotDto } from '../types/lifecycle';

export function useAppLifecycle() {
  const lifecycleStore = useAppLifecycleStore();
  const streamStore = useChatStreamStore();
  let unlisten: UnlistenFn | null = null;
  let recoveryPromise: Promise<void> | null = null;
  let disposed = false;
  const documentHidden = ref(typeof document !== 'undefined' && document.hidden);

  const reconcileInterruptedStreams = (source: string) => {
    if (lifecycleStore.state !== 'READY' || documentHidden.value) return;
    const phase = lifecycleStore.lifecycleSnapshot?.phase;
    if (phase && phase !== 'active') return;
    if (recoveryPromise) return recoveryPromise;
    console.log(`[useAppLifecycle] ${source}. Triggering stream recovery.`);
    recoveryPromise = streamStore.checkAndRecoverInterruptedStreams()
      .catch(err => {
        console.error(`[useAppLifecycle] Failed to recover streams (${source}):`, err);
      })
      .finally(() => {
        recoveryPromise = null;
      });
    return recoveryPromise;
  };

  // 中断流恢复属于应用生命周期调和：冷启动、WebView 重载均由 READY 转换覆盖。
  watch(
    () => lifecycleStore.state,
    (state, previous) => {
      if (state === 'READY' && previous !== 'READY') {
        void reconcileInterruptedStreams('Core ready');
      }
    },
  );

  // Browser visibility only pauses rendering. It never overwrites the native phase.
  watch([() => lifecycleStore.lifecycleSnapshot?.phase, documentHidden], ([phase, hidden]) => {
    const paused = hidden || (phase !== undefined && phase !== 'active');
    document.documentElement.classList.toggle('vcp-paused-animations', paused);
  }, { immediate: true });

  watch(() => lifecycleStore.lifecycleSnapshot?.phase, (phase, previous) => {
    if (phase === 'active' && previous !== 'active') {
      lifecycleStore.hydrateSystemStatus().catch((err) => {
        console.error("[useAppLifecycle] Failed to hydrate system status:", err);
      });
      void reconcileInterruptedStreams('App foreground');
    }
  });

  const handleVisibilityChange = () => {
    if (typeof document !== 'undefined') {
      documentHidden.value = document.hidden;
      if (!documentHidden.value) void reconcileInterruptedStreams('Document visible');
    }
  };

  const handleOnline = () => {
    void reconcileInterruptedStreams("Device online");
  };

  onMounted(async () => {
    if (typeof window !== 'undefined') {
      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("online", handleOnline);
    }

    try {
      const stopListening = await listen<LifecycleSnapshotDto>('vcp-lifecycle-changed', (event) => {
        if (!disposed) lifecycleStore.applyLifecycleSnapshot(event.payload);
      });
      if (disposed) {
        stopListening();
        return;
      }
      unlisten = stopListening;
      // Subscribe first, then replay the owner snapshot. Epoch ordering handles races.
      await lifecycleStore.hydrateSystemStatus();
    } catch (err) {
      console.error("[useAppLifecycle] Failed to setup Tauri lifecycle listener:", err);
    }
  });

  onUnmounted(() => {
    disposed = true;
    if (typeof window !== 'undefined') {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    }
    if (unlisten) {
      unlisten();
    }
  });
}
