import type { Pinia } from 'pinia';
import { usePlatformStore } from '@/core/stores/platform';
import { CAPABILITY_NAMES, type Platform, type PlatformCapabilities } from '@/core/types/platform';

/** Explicit platform inputs for feature tests; no global default grants native capabilities. */
export function platformFixture(platform: Platform = 'android'): PlatformCapabilities {
  return {
    platform,
    features: Object.fromEntries(CAPABILITY_NAMES.map(name => [name, {
      support: platform === 'android' ? 'supported' : 'unsupported',
      implementation: platform === 'android' ? 'implemented' : 'notImplemented',
      authorization: 'unknown',
      runtime: 'unknown',
    }])) as PlatformCapabilities['features'],
  };
}

export function configureAndroidPlatform(pinia: Pinia): void {
  usePlatformStore(pinia).snapshot = platformFixture('android');
}
