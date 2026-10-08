import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { invoke } from '@tauri-apps/api/core';
import { usePlatformStore } from '@/core/stores/platform';
import { parsePlatformCapabilities } from '@/core/types/platform';
import { platformFixture } from '../../fixtures/platform';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  setActivePinia(createPinia());
  invokeMock.mockReset();
});

describe('platform capability boundary', () => {
  it('rejects missing fields and malformed enum values instead of granting defaults', () => {
    const missing = platformFixture();
    Reflect.deleteProperty(missing.features, 'apkUpdate');
    expect(() => parsePlatformCapabilities(missing)).toThrow('apkUpdate');
    const malformed = platformFixture();
    Object.assign(malformed.features.filePicker, { implementation: ['implemented'] });
    expect(() => parsePlatformCapabilities(malformed)).toThrow('filePicker');
    expect(() => parsePlatformCapabilities({ ...platformFixture(), platform: ['android'] })).toThrow();
  });

  it('keeps native entries closed until one coalesced capability request completes', async () => {
    let complete!: (value: unknown) => void;
    invokeMock.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    const store = usePlatformStore();
    const first = store.load();
    const second = store.load(true);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(store.isImplemented('apkUpdate')).toBe(false);
    expect(() => store.require('apkUpdate')).toThrow('尚未加载');
    complete(platformFixture());
    await Promise.all([first, second]);
    expect(store.platform).toBe('android');
    expect(store.isImplemented('apkUpdate')).toBe(true);
    // Entry availability does not rewrite a permission observation.
    expect(store.snapshot?.features.apkUpdate.authorization).toBe('unknown');
  });

  it('retries a rejected native query without retaining success or a stuck flight', async () => {
    invokeMock.mockRejectedValueOnce(new Error('bridge unavailable'));
    const store = usePlatformStore();
    await expect(store.load()).rejects.toThrow('bridge unavailable');
    expect(store.snapshot).toBeNull();
    expect(store.loading).toBe(false);
    expect(store.error).toBe('bridge unavailable');
    invokeMock.mockResolvedValueOnce(platformFixture('ios'));
    await store.load();
    expect(store.platform).toBe('ios');
    expect(store.error).toBeNull();
    expect(() => store.require('apkUpdate')).toThrow('不支持');
  });

  it('distinguishes planned implementation from unsupported and clears a failed refresh', async () => {
    const planned = platformFixture('ios');
    planned.features.filePicker.support = 'supported';
    invokeMock.mockResolvedValueOnce(planned);
    const store = usePlatformStore();
    await store.load();
    expect(() => store.require('filePicker')).toThrow('尚未完成');
    invokeMock.mockRejectedValueOnce(new Error('refresh failed'));
    await expect(store.load(true)).rejects.toThrow('refresh failed');
    expect(store.snapshot).toBeNull();
  });
});
