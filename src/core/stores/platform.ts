import { invoke } from '@tauri-apps/api/core';
import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { parsePlatformCapabilities, type CapabilityName, type PlatformCapabilities } from '../types/platform';

/** Process-scoped capability snapshot; loaded by the existing app bootstrap owner. */
export const usePlatformStore = defineStore('platform', () => {
  const snapshot = shallowRef<PlatformCapabilities | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const platform = computed(() => snapshot.value?.platform ?? null);
  let inFlight: Promise<PlatformCapabilities> | null = null;

  function load(force = false): Promise<PlatformCapabilities> {
    if (inFlight) return inFlight;
    if (snapshot.value && !force) return Promise.resolve(snapshot.value);
    snapshot.value = null;
    loading.value = true;
    error.value = null;
    inFlight = invoke<unknown>('get_platform_capabilities')
      .then(parsePlatformCapabilities)
      .then((value) => {
        snapshot.value = value;
        return value;
      })
      .catch((cause: unknown) => {
        error.value = cause instanceof Error ? cause.message : String(cause);
        throw cause;
      })
      .finally(() => {
        loading.value = false;
        inFlight = null;
      });
    return inFlight;
  }

  // This permits an implementation entry, not a promise of authorization or native success.
  function isImplemented(name: CapabilityName): boolean {
    const feature = snapshot.value?.features[name];
    return feature?.support === 'supported' && feature.implementation === 'implemented';
  }

  function requireCapability(name: CapabilityName): void {
    if (!snapshot.value) throw new Error('平台能力尚未加载，请重试启动');
    const feature = snapshot.value.features[name];
    if (feature.support === 'unsupported') throw new Error('当前平台暂不支持此操作');
    if (feature.implementation !== 'implemented') throw new Error('此功能尚未完成当前平台的适配');
  }

  return { snapshot, loading, error, platform, load, isImplemented, require: requireCapability };
});
