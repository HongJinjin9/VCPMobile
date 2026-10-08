import { isTauri } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';

// Platform identity is injected by the native host before the frontend starts.
// A browser preview has no native platform and does not impersonate a phone.
export const nativePlatform = isTauri() ? platform() : null;
export const isAndroid = nativePlatform === 'android';
export const isIOS = nativePlatform === 'ios';
