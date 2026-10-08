import { afterEach, describe, expect, it, vi } from 'vitest';
import { disposePinia, getActivePinia } from 'pinia';
import { flushPromises } from '@vue/test-utils';
import { getVersion } from '@tauri-apps/api/app';
import UpdateSection from '@/features/settings/components/UpdateSection.vue';
import { useNotificationStore } from '@/core/stores/notification';
import { useUpdateStore } from '@/core/stores/update';
import { invokeMock, listenMock } from '@/tests/mocks/tauri';
import { mountWithPinia } from '@/tests/utils/mount';

vi.mock('@/core/utils/platform', () => ({
  nativePlatform: 'ios', isAndroid: false, isIOS: true,
}));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '1.1.6') }));

afterEach(() => {
  const pinia = getActivePinia();
  if (pinia) disposePinia(pinia);
});

describe('iOS update explanation', () => {
  it('shows the installed version and explains self-signing without starting the APK updater', async () => {
    const wrapper = mountWithPinia(UpdateSection);
    try {
      await flushPromises();
      expect(getVersion).toHaveBeenCalledOnce();
      expect(wrapper.text()).toContain('1.1.6');
      const button = wrapper.findAll('button').find(item => item.text() === '查看');
      expect(button).toBeDefined();
      await button!.trigger('click');

      expect(invokeMock).not.toHaveBeenCalled();
      expect(listenMock).not.toHaveBeenCalled();
      expect(useUpdateStore().isPromptOpen).toBe(false);
      const notices = useNotificationStore().activeToasts;
      expect(notices).toHaveLength(1);
      expect(notices[0].message).toContain('自行签名');
    } finally {
      wrapper.unmount();
    }
  });
});
