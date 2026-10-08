import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia';
import { useUpdateStore } from '../../../core/stores/update';
import { emitTauriEvent, invokeMock, listenMock, mockInvoke } from '../../mocks/tauri';
import { UPDATE_STATUS_EVENT, type UpdateStatus } from '../../../core/types/update';
import { usePlatformStore } from '../../../core/stores/platform';
import { platformFixture } from '../../fixtures/platform';

const idle: UpdateStatus = {
  state: 'idle',
  info: null,
  downloaded: 0,
  total: null,
  error: null,
};

const available: UpdateStatus = {
  ...idle,
  state: 'available',
  info: {
    hasUpdate: true,
    currentVersion: '1.1.4',
    latestVersion: '1.2.0',
    releasePageUrl: 'https://github.com/MRiecy/VCPMobile/releases/tag/v1.2.0',
    releaseNotes: 'notes',
    apkSize: 100 * 1024 * 1024,
    apkSha256: 'a'.repeat(64),
  },
  total: 100 * 1024 * 1024,
};

describe('update store', () => {
  let pinia: Pinia;
  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    mockInvoke('get_platform_capabilities', () => platformFixture('android'));
    await usePlatformStore().load();
  });

  afterEach(() => disposePinia(pinia));

  it('init pulls the current snapshot once and then follows broadcast events', async () => {
    mockInvoke('get_update_status', () => idle);
    const store = useUpdateStore();

    await store.init();
    await store.init();
    expect(store.state).toBe('idle');
    expect(
      invokeMock.mock.calls.filter(([command]) => command === 'get_update_status'),
    ).toHaveLength(1);

    emitTauriEvent(UPDATE_STATUS_EVENT, {
      ...available,
      state: 'downloading',
      downloaded: 50 * 1024 * 1024,
    });
    expect(store.state).toBe('downloading');
    expect(store.progressPercent).toBe(50);
    expect(store.isBusy).toBe(true);
  });

  it('command results are applied to the mirrored status', async () => {
    mockInvoke('get_update_status', () => idle);
    mockInvoke('check_for_update', () => available);
    mockInvoke('start_update_download', () => ({
      ...available,
      state: 'readyToInstall',
      downloaded: available.info!.apkSize!,
    }));
    mockInvoke('install_update', () => ({ ...available, state: 'idle' as const }));

    const store = useUpdateStore();
    await store.init();

    const checked = await store.check();
    expect(checked.state).toBe('available');
    expect(store.info?.latestVersion).toBe('1.2.0');

    const downloaded = await store.startDownload();
    expect(downloaded.state).toBe('readyToInstall');
    expect(store.state).toBe('readyToInstall');

    const installed = await store.install();
    expect(installed.state).toBe('idle');
  });

  it('surfaces structured errors from the state machine', async () => {
    mockInvoke('get_update_status', () => idle);
    mockInvoke('start_update_download', () => ({
      ...available,
      state: 'failed' as const,
      error: { stage: 'download', message: '网络停滞超过 30 秒', retryable: true },
    }));

    const store = useUpdateStore();
    await store.init();
    const result = await store.startDownload();

    expect(result.state).toBe('failed');
    expect(store.error?.stage).toBe('download');
    expect(store.error?.retryable).toBe(true);
  });

  it('rejects every APK entry before capabilities load or on iOS without invoking updater commands', async () => {
    const platform = usePlatformStore();
    platform.snapshot = null;
    invokeMock.mockClear();
    const store = useUpdateStore();

    for (const action of [store.init, store.check, store.startDownload, store.cancelDownload, store.install]) {
      await expect(action()).rejects.toThrow('平台能力尚未加载');
    }
    expect(() => store.openPrompt()).toThrow('平台能力尚未加载');
    expect(invokeMock).not.toHaveBeenCalled();
    expect(listenMock).not.toHaveBeenCalled();

    mockInvoke('get_platform_capabilities', () => platformFixture('ios'));
    await platform.load();
    invokeMock.mockClear();
    for (const action of [store.init, store.check, store.startDownload, store.cancelDownload, store.install]) {
      await expect(action()).rejects.toThrow('不支持');
    }
    expect(() => store.openPrompt()).toThrow('不支持');
    expect(invokeMock).not.toHaveBeenCalled();
    expect(listenMock).not.toHaveBeenCalled();
  });

  it('retries a failed subscription and stops consuming events when disposed', async () => {
    mockInvoke('get_update_status', () => idle);
    listenMock.mockRejectedValueOnce(new Error('listener unavailable'));
    const store = useUpdateStore();

    await expect(store.init()).rejects.toThrow('listener unavailable');
    await store.init();
    expect(listenMock).toHaveBeenCalledTimes(2);
    emitTauriEvent(UPDATE_STATUS_EVENT, available);
    expect(store.state).toBe('available');

    store.$dispose();
    emitTauriEvent(UPDATE_STATUS_EVENT, idle);
    expect(store.state).toBe('available');
  });

  it('releases a failed snapshot subscription and permits a later retry', async () => {
    mockInvoke('get_update_status', async () => { throw new Error('snapshot unavailable'); });
    const store = useUpdateStore();

    await expect(store.init()).rejects.toThrow('snapshot unavailable');
    emitTauriEvent(UPDATE_STATUS_EVENT, available);
    expect(store.state).toBe('idle');

    mockInvoke('get_update_status', () => available);
    await store.init();
    expect(store.state).toBe('available');
    expect(listenMock).toHaveBeenCalledTimes(2);
  });
});
