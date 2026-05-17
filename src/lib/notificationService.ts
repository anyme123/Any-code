/**
 * AI 回复完成通知服务
 * 当窗口不在前台时，AI 回复完成后发送桌面通知
 */

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

let permissionGranted = false;

export async function initNotification(): Promise<void> {
  try {
    permissionGranted = await isPermissionGranted();
    if (!permissionGranted) {
      const permission = await requestPermission();
      permissionGranted = permission === 'granted';
    }
  } catch (e) {
    console.warn('[Notification] Failed to initialize:', e);
  }
}

export function notifyResponseComplete(engine: string = 'Claude'): void {
  if (!permissionGranted) return;

  // 只在窗口不聚焦时通知
  if (document.hasFocus()) return;

  try {
    sendNotification({
      title: 'Any Code',
      body: `${engine} 回复完成`,
    });
  } catch (e) {
    console.warn('[Notification] Failed to send:', e);
  }
}
