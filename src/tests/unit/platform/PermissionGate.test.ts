import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import PermissionGate from '../../../components/layout/PermissionGate.vue';
import { invokeMock, mockInvoke } from '../../mocks/tauri';

vi.mock('/vcpmobile.svg', () => ({ default: '/vcpmobile.svg' }));
const native = vi.hoisted(() => ({ android: false }));
const bootstrap = vi.hoisted(() => vi.fn(async (_force: boolean) => {}));
vi.mock('../../../core/utils/platform', () => ({
  get isAndroid() { return native.android; },
}));
vi.mock('../../../core/stores/appLifecycle', () => ({
  useAppLifecycleStore: () => ({ bootstrap }),
}));

describe('shared permission guide', () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    native.android = false;
    bootstrap.mockClear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.useRealTimers();
  });

  it('continues startup without Android requests or a blocking surface when there are no current permission items', async () => {
    wrapper = mount(PermissionGate);
    await flushPromises();
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(30_000);
    await flushPromises();

    expect(wrapper.find('.vcp-permission-gate').exists()).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(bootstrap).toHaveBeenCalledOnce();
    expect(bootstrap).toHaveBeenCalledWith(true);
  });

  it('keeps Android permission requests and its existing storage check in the shared guide', async () => {
    native.android = true;
    mockInvoke('plugin:vcp-mobile|check_all_permissions', () => ({
      notification: false, storage: false, battery: false,
      microphone: false, camera: false, location: false,
    }));
    mockInvoke('plugin:vcp-mobile|check_notification_listener_permission', () => ({ enabled: false }));
    mockInvoke('plugin:vcp-mobile|get_free_disk_space', () => ({ freeGb: 2, totalGb: 64 }));
    mockInvoke('plugin:vcp-mobile|request_android_permission', () => undefined);
    wrapper = mount(PermissionGate);
    await flushPromises();

    const requests = wrapper.findAll('button').filter(button => button.text() === '去授权');
    expect(requests).toHaveLength(2);
    await requests[0].trigger('click');
    await requests[1].trigger('click');
    expect(invokeMock).toHaveBeenCalledWith('plugin:vcp-mobile|request_android_permission', { pType: 'notification' });
    expect(invokeMock).toHaveBeenCalledWith('plugin:vcp-mobile|request_android_permission', { pType: 'battery' });
    expect(wrapper.find('.vcp-permission-gate').exists()).toBe(true);
    expect(wrapper.findAll('button').some(button => button.text().includes('存储空间不足') && button.attributes('disabled') !== undefined)).toBe(true);
    expect(bootstrap).not.toHaveBeenCalled();
  });
});
