export const CAPABILITY_NAMES = [
  'androidPermissionGate', 'apkUpdate', 'nativeInsets', 'incomingShare',
  'systemNotifications', 'moveTaskToBack', 'rootAccess', 'cli', 'distributed',
  'voiceRecording', 'camera', 'filePicker', 'photoPicker', 'gallerySave',
  'fileExport', 'outgoingShare', 'fileOpen', 'batteryStatus', 'networkStatus',
  'diskSpace', 'keepScreenOn', 'backgroundExecution', 'lifecycle', 'webviewCache',
] as const;

export type CapabilityName = typeof CAPABILITY_NAMES[number];
export type Platform = 'android' | 'ios' | 'host';

export interface CapabilityStatus {
  support: 'supported' | 'unsupported';
  implementation: 'implemented' | 'notImplemented';
  authorization: 'notRequired' | 'unknown' | 'granted' | 'denied';
  runtime: 'available' | 'unknown' | 'unavailable';
}

export interface PlatformCapabilities {
  platform: Platform;
  features: Record<CapabilityName, CapabilityStatus>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isChoice(value: unknown, choices: readonly string[]): boolean {
  return typeof value === 'string' && choices.includes(value);
}

/** An incomplete/mismatched native response must never grant capabilities by default. */
export function parsePlatformCapabilities(value: unknown): PlatformCapabilities {
  if (!isRecord(value) || !isChoice(value.platform, ['android', 'ios', 'host']) || !isRecord(value.features)) {
    throw new Error('平台能力响应格式无效');
  }
  const features = {} as Record<CapabilityName, CapabilityStatus>;
  for (const name of CAPABILITY_NAMES) {
    const feature = value.features[name];
    if (!isRecord(feature)
      || !isChoice(feature.support, ['supported', 'unsupported'])
      || !isChoice(feature.implementation, ['implemented', 'notImplemented'])
      || !isChoice(feature.authorization, ['notRequired', 'unknown', 'granted', 'denied'])
      || !isChoice(feature.runtime, ['available', 'unknown', 'unavailable'])) {
      throw new Error(`平台能力字段无效：${name}`);
    }
    features[name] = {
      support: feature.support as CapabilityStatus['support'],
      implementation: feature.implementation as CapabilityStatus['implementation'],
      authorization: feature.authorization as CapabilityStatus['authorization'],
      runtime: feature.runtime as CapabilityStatus['runtime'],
    };
  }
  return { platform: value.platform as Platform, features };
}
