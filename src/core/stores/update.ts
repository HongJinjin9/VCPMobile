import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isAndroid } from '../utils/platform';
import {
  UPDATE_STATUS_EVENT,
  type UpdateState,
  type UpdateStatus,
} from '../types/update';

const IDLE_STATUS: UpdateStatus = {
  state: 'idle',
  info: null,
  downloaded: 0,
  total: null,
  error: null,
};

/**
 * OTA 更新状态的唯一前端入口。
 *
 * 状态由 Rust `UpdateSession` 持有，本 store 只做镜像：
 * - `init()` 订阅 `vcp-update://status` 事件并补拉一次当前状态；
 * - 所有命令返回最新快照并直接落库，事件广播保证其他入口同步。
 */
export const useUpdateStore = defineStore('update', () => {
  const status = ref<UpdateStatus>({ ...IDLE_STATUS });
  const isPromptOpen = ref(false);
  let initialized = false;
  let initPromise: Promise<void> | null = null;
  let unlistenStatus: (() => void) | null = null;
  let disposed = false;

  const requireUpdater = () => {
    if (!isAndroid) throw new Error('应用内 APK 更新仅适用于 Android');
    if (disposed) throw new Error('更新状态已释放');
  };

  onScopeDispose(() => {
    disposed = true;
    unlistenStatus?.();
    unlistenStatus = null;
  });

  const state = computed<UpdateState>(() => status.value.state);
  const info = computed(() => status.value.info);
  const error = computed(() => status.value.error);
  const isBusy = computed(() =>
    ['checking', 'downloading', 'verifying', 'installing'].includes(status.value.state),
  );
  const progressPercent = computed(() => {
    const { downloaded, total } = status.value;
    if (!total || total <= 0) return 0;
    return Math.min(100, Math.round((downloaded / total) * 100));
  });

  const applyStatus = (next: UpdateStatus) => {
    status.value = next;
  };

  /** 幂等初始化：订阅 Rust 状态广播并补拉当前快照。 */
  const init = async () => {
    requireUpdater();
    if (initialized) return;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const release = await listen<UpdateStatus>(UPDATE_STATUS_EVENT, (event) => {
        if (!disposed) applyStatus(event.payload);
      });
      if (disposed) {
        release();
        throw new Error('更新状态已释放');
      }
      unlistenStatus = release;
      try {
        const snapshot = await invoke<UpdateStatus>('get_update_status');
        requireUpdater();
        applyStatus(snapshot);
        initialized = true;
      } catch (error) {
        unlistenStatus?.();
        unlistenStatus = null;
        throw error;
      }
    })();
    try {
      await initPromise;
    } finally {
      initPromise = null;
    }
  };

  const check = async (): Promise<UpdateStatus> => {
    requireUpdater();
    await init();
    const next = await invoke<UpdateStatus>('check_for_update');
    applyStatus(next);
    return next;
  };

  const startDownload = async (): Promise<UpdateStatus> => {
    requireUpdater();
    await init();
    const next = await invoke<UpdateStatus>('start_update_download');
    applyStatus(next);
    return next;
  };

  const cancelDownload = async (): Promise<UpdateStatus> => {
    requireUpdater();
    const next = await invoke<UpdateStatus>('cancel_update_download');
    applyStatus(next);
    return next;
  };

  const install = async (): Promise<UpdateStatus> => {
    requireUpdater();
    const next = await invoke<UpdateStatus>('install_update');
    applyStatus(next);
    return next;
  };

  const openPrompt = () => {
    requireUpdater();
    isPromptOpen.value = true;
  };

  const closePrompt = () => {
    isPromptOpen.value = false;
  };

  return {
    status,
    state,
    info,
    error,
    isBusy,
    progressPercent,
    isPromptOpen,
    init,
    check,
    startDownload,
    cancelDownload,
    install,
    openPrompt,
    closePrompt,
  };
});
