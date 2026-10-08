import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia';
import { useNotificationProcessor } from '@/core/composables/useNotificationProcessor';
import { useNotificationStore } from '@/core/stores/notification';

describe('background service failure notifications', () => {
  let pinia: Pinia;

  beforeEach(() => {
    vi.useFakeTimers();
    pinia = createPinia();
    setActivePinia(pinia);
  });

  afterEach(() => {
    disposePinia(pinia);
    vi.useRealTimers();
  });

  it.each([
    ['guardian', 'warning', '后台保活异常', '前台使用'],
    ['helper', 'error', '流式服务启动失败', '重试'],
    ['events', 'warning', '应用状态监听异常', '完全关闭应用'],
  ])('presents %s failures without exposing native error details', (service, type, title, guidance) => {
    const notification = useNotificationProcessor().processPayload({
      type: 'vcp-background-service-error',
      service,
      message: 'native exception with private file paths',
      data: { detail: 'internal stack trace' },
    });

    expect(notification).toMatchObject({
      id: `vcp_background_service_error_${service}`,
      type,
      title,
      duration: 0,
      isPreformatted: false,
    });
    expect(notification.oncePerWebview).toBe(service === 'events' ? true : undefined);
    expect(notification.message).toContain(guidance);
    expect(JSON.stringify(notification)).not.toContain('private file paths');
    expect(JSON.stringify(notification)).not.toContain('internal stack trace');
  });

  it('keeps one visible card and history entry per failed service after background time elapses', () => {
    const { processPayload } = useNotificationProcessor();
    const store = useNotificationStore();
    for (const service of ['guardian', 'guardian', 'helper', 'events', 'helper']) {
      store.addNotification(processPayload({ type: 'vcp-background-service-error', service }));
    }

    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(store.activeToasts).toHaveLength(3);
    expect(store.historyList).toHaveLength(3);
    expect(store.unreadCount).toBe(3);
    expect(new Set(store.activeToasts.map(item => item.id)).size).toBe(3);
  });

  it.each(['dismiss', 'remove', 'clear', 'evict'])(
    'does not repeat an events notice after %s and the normal cooldown', action => {
      const { processPayload } = useNotificationProcessor();
      const store = useNotificationStore();
      const notification = processPayload({ type: 'vcp-background-service-error', service: 'events' });
      store.addNotification(notification);
      store.activeToasts = [];

      if (action === 'remove') store.removeHistoryItem(notification.id!);
      if (action === 'clear') store.clearHistory();
      if (action === 'evict') {
        for (let index = 0; index < 100; index++) {
          store.addNotification({ id: `later_notice_${index}`, historyOnly: true });
        }
        expect(store.historyList.some(item => item.id === notification.id)).toBe(false);
      }

      const previousHistory = store.historyList.map(item => ({ ...item }));
      const previousUnreadCount = store.unreadCount;
      vi.advanceTimersByTime(60_000);
      store.addNotification(notification);

      expect(store.activeToasts).toHaveLength(0);
      expect(store.historyList).toEqual(previousHistory);
      expect(store.unreadCount).toBe(previousUnreadCount);
    },
  );

  it('accepts a notice while the drawer is open without replaying its toast later', () => {
    const store = useNotificationStore();
    const notification = useNotificationProcessor().processPayload({
      type: 'vcp-background-service-error', service: 'events',
    });
    store.isDrawerOpen = true;
    store.addNotification(notification);
    expect(store.activeToasts).toHaveLength(0);
    expect(store.historyList).toHaveLength(1);

    store.isDrawerOpen = false;
    vi.advanceTimersByTime(60_000);
    store.addNotification(notification);

    expect(store.activeToasts).toHaveLength(0);
    expect(store.historyList).toHaveLength(1);
    expect(store.unreadCount).toBe(1);
  });

  it('does not consume the once-per-WebView allowance for silent input', () => {
    const store = useNotificationStore();
    const notification = useNotificationProcessor().processPayload({
      type: 'vcp-background-service-error', service: 'events',
    });
    store.addNotification({ ...notification, silent: true });
    expect(store.historyList).toHaveLength(0);
    expect(store.activeToasts).toHaveLength(0);

    store.addNotification(notification);
    expect(store.historyList).toHaveLength(1);
    expect(store.activeToasts).toHaveLength(1);
    expect(store.unreadCount).toBe(1);
  });

  it('requires an explicit fixed ID for once-per-WebView suppression', () => {
    const store = useNotificationStore();
    store.addNotification({ oncePerWebview: true });
    store.addNotification({ oncePerWebview: true });

    expect(store.historyList).toHaveLength(2);
    expect(store.activeToasts).toHaveLength(2);
    expect(store.unreadCount).toBe(2);
  });

  it.each(['guardian', 'helper'])('preserves the normal %s cooldown and history-clear behavior', service => {
    const store = useNotificationStore();
    const notification = useNotificationProcessor().processPayload({ type: 'vcp-background-service-error', service });
    store.addNotification(notification);
    store.activeToasts = [];

    vi.advanceTimersByTime(20_000);
    store.addNotification(notification);
    expect(store.activeToasts).toHaveLength(0);

    vi.advanceTimersByTime(31_000);
    store.addNotification(notification);
    expect(store.activeToasts).toHaveLength(1);
    expect(store.historyList).toHaveLength(1);
    expect(store.unreadCount).toBe(1);

    store.activeToasts = [];
    store.clearHistory();
    store.addNotification(notification);
    expect(store.activeToasts).toHaveLength(1);
    expect(store.historyList).toHaveLength(1);
    expect(store.unreadCount).toBe(1);
  });

  it.each([undefined, null, '', 'unknown', '__proto__', {}])('ignores unknown service %j', service => {
    const notification = useNotificationProcessor().processPayload({
      type: 'vcp-background-service-error',
      service,
    });
    const store = useNotificationStore();
    store.addNotification(notification);

    expect(notification).toEqual({ silent: true });
    expect(store.activeToasts).toHaveLength(0);
    expect(store.historyList).toHaveLength(0);
  });
});
