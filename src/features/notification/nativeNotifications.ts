import { invoke } from '@tauri-apps/api/core';

export interface NotificationPermission {
  authorization: 'notDetermined' | 'denied' | 'authorized' | 'provisional' | 'ephemeral' | 'unknown';
}

export const readNotificationPermission = () =>
  invoke<NotificationPermission>('plugin:vcp-mobile|get_notification_permission');

export const requestNotificationPermission = () =>
  invoke<NotificationPermission>('plugin:vcp-mobile|request_notification_permission');

// Resolving means the system accepted opening Settings, not that permission changed.
export const openNotificationSettings = () =>
  invoke<void>('plugin:vcp-mobile|open_notification_settings');

export function isNotificationAuthorized(permission: NotificationPermission): boolean {
  return permission.authorization === 'authorized'
    || permission.authorization === 'provisional'
    || permission.authorization === 'ephemeral';
}
