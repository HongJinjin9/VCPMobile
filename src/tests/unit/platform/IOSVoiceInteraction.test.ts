import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disposePinia, getActivePinia } from 'pinia';
import type { VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import InputEnhancer from '@/features/chat/InputEnhancer.vue';
import { useNotificationStore } from '@/core/stores/notification';
import { invokeMock } from '@/tests/mocks/tauri';
import { mountWithPinia } from '@/tests/utils/mount';

vi.mock('@/core/utils/platform', () => ({
  nativePlatform: 'ios', isAndroid: false, isIOS: true,
}));

const getUserMedia = vi.fn(async () => { throw new Error('unexpected microphone request'); });
const speechStart = vi.fn();
const recognitionConstructor = vi.fn(function () {
  return { start: speechStart, stop: vi.fn(), abort: vi.fn() };
});
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
let wrapper: VueWrapper | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true, value: { getUserMedia },
  });
  vi.stubGlobal('SpeechRecognition', recognitionConstructor);
  wrapper = mountWithPinia(InputEnhancer, {
    global: {
      directives: { longpress: {}, guide: {} },
      stubs: {
        GroupStopAllButton: true,
        GroupInviteBar: true,
        StagedAttachmentPreview: true,
        VcpAvatar: true,
      },
    },
  });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  const pinia = getActivePinia();
  if (pinia) disposePinia(pinia);
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function expectExplanationWithoutRecording() {
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(recognitionConstructor).not.toHaveBeenCalled();
  expect(speechStart).not.toHaveBeenCalled();
  expect(invokeMock).not.toHaveBeenCalled();
  expect(wrapper!.find('textarea').exists()).toBe(true);
  expect(wrapper!.emitted('send')).toBeUndefined();
  const notices = useNotificationStore().activeToasts;
  expect(notices).toHaveLength(1);
  expect(notices[0].message).toContain('尚未提供语音输入');
}

describe('iOS voice explanation', () => {
  it.each([50, 700])('keeps text input after a %d ms touch without starting recording', async heldMs => {
    await wrapper!.get('textarea').setValue('未发送的文字');
    const voice = wrapper!.get('button[aria-label="语音输入（尚未开发）"]');
    const start = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(start, 'touches', { value: [{ clientY: 100 }] });
    voice.element.dispatchEvent(start);
    await nextTick();
    await vi.advanceTimersByTimeAsync(heldMs);
    voice.element.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true }));
    await nextTick();

    expect(start.defaultPrevented).toBe(true);
    expectExplanationWithoutRecording();
    expect((wrapper!.get('textarea').element as HTMLTextAreaElement).value).toBe('未发送的文字');
  });

  it('explains an independent pointer click without entering speech mode', async () => {
    await wrapper!.get('button[aria-label="语音输入（尚未开发）"]').trigger('click', { detail: 1 });
    expectExplanationWithoutRecording();
  });
});
