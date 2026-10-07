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
    ['events', 'warning', '后台状态监听异常', '前台使用'],
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
