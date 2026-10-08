import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia';
import { useAppLifecycleStore } from '../../../core/stores/appLifecycle';
import { useNotificationStore } from '../../../core/stores/notification';
import { usePlatformStore } from '../../../core/stores/platform';
import { platformFixture } from '../../fixtures/platform';
import { invokeMock, mockInvoke } from '../../mocks/tauri';

vi.mock('../../../core/stores/assistant', () => ({
  useAssistantStore: () => ({ fetchAgentsAndGroups: async () => {} }),
}));
vi.mock('../../../core/stores/settings', () => ({
  useSettingsStore: () => ({ fetchSettings: async () => {} }),
}));
vi.mock('../../../core/stores/theme', () => ({
  useThemeStore: () => ({ initTheme: async () => {} }),
}));
vi.mock('../../../core/stores/chatSessionStore', () => ({
  useChatSessionStore: () => ({
    currentSelectedItem: null,
    currentTopicId: null,
    reconcileCurrentConversation: () => {},
  }),
}));
vi.mock('../../../core/stores/chatHistoryStore', () => ({
  useChatHistoryStore: () => ({ preloadHistory: async () => {} }),
}));
vi.mock('../../../core/stores/topicListManager', () => ({
  useTopicStore: () => ({ loadTopicList: async () => {} }),
}));
vi.mock('../../../core/stores/avatar', () => ({
  useAvatarStore: () => ({ preloadMetadata: async () => {} }),
}));
vi.mock('../../../core/utils/bootTrace', () => ({
  bootMark: () => {},
  reportBootTrace: async () => {},
  trackBootStage: (_name: string, promise: Promise<unknown>) => promise,
}));

describe('platform-aware bootstrap', () => {
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    mockInvoke('get_system_snapshot', () => ({
      lifecycle: null,
      core: 'ready',
      message: 'ready',
      log: 'connected',
      sync: 'disconnected',
      databaseRecovery: null,
      backgroundServiceFailures: [],
    }));
  });

  afterEach(() => disposePinia(pinia));

  it('stops before native permissions on capability failure and retries the same bootstrap owner', async () => {
    mockInvoke('get_platform_capabilities', async () => { throw new Error('bridge unavailable'); });
    const lifecycle = useAppLifecycleStore();

    await expect(lifecycle.bootstrap()).rejects.toThrow('bridge unavailable');
    expect(lifecycle.state).toBe('ERROR');
    expect(usePlatformStore().snapshot).toBeNull();
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(['get_platform_capabilities']);

    mockInvoke('get_platform_capabilities', () => platformFixture('ios'));
    await lifecycle.bootstrap(true);
    expect(lifecycle.state).toBe('READY');
    expect(lifecycle.errorMsg).toBeNull();
    expect(invokeMock.mock.calls.some(([command]) => command.startsWith('plugin:vcp-mobile|'))).toBe(false);
  });

  it('does not run Android permission checks or add Android warnings on iOS', async () => {
    mockInvoke('get_platform_capabilities', () => platformFixture('ios'));
    const lifecycle = useAppLifecycleStore();

    await lifecycle.bootstrap();

    expect(lifecycle.state).toBe('READY');
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      'get_platform_capabilities', 'get_system_snapshot',
    ]);
    expect(useNotificationStore().historyList).toHaveLength(0);
  });

  it('keeps the Android permission gate and rechecks native authorization before entering', async () => {
    mockInvoke('get_platform_capabilities', () => platformFixture('android'));
    mockInvoke('plugin:vcp-mobile|check_all_permissions', () => ({ notification: false, battery: true }));
    mockInvoke('plugin:vcp-mobile|check_notification_listener_permission', () => ({ enabled: true }));
    const lifecycle = useAppLifecycleStore();

    await lifecycle.bootstrap();
    expect(lifecycle.state).toBe('PERMISSIONS');
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      'get_platform_capabilities',
      'plugin:vcp-mobile|check_all_permissions',
      'plugin:vcp-mobile|check_notification_listener_permission',
    ]);

    mockInvoke('plugin:vcp-mobile|check_all_permissions', () => ({ notification: true, battery: true }));
    await lifecycle.bootstrap(true);
    expect(lifecycle.state).toBe('READY');
  });

  it('retains the Android foreground fallback with an explicit warning when its permission query fails', async () => {
    mockInvoke('get_platform_capabilities', () => platformFixture('android'));
    mockInvoke('plugin:vcp-mobile|check_all_permissions', async () => { throw new Error('permission query failed'); });

    await useAppLifecycleStore().bootstrap();

    expect(useAppLifecycleStore().state).toBe('READY');
    expect(useNotificationStore().historyList.some((item) => item.id === 'startup_permission_check_failed')).toBe(true);
  });
});
