'use client';

import { savePushSubscriptionAction } from '@/app/actions';

export type PushState = 'unsupported' | 'needs-install' | 'off' | 'denied' | 'on';

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export async function pushState(): Promise<PushState> {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return 'off';
  // Re-save in case the server dropped it; cheap and keeps things in sync.
  await savePushSubscriptionAction(sub.toJSON() as never);
  return 'on';
}

/** Must be called from a tap: iOS only allows the permission prompt in response to a user gesture. */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToBytes(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
    }));
  const res = await savePushSubscriptionAction(sub.toJSON() as never);
  if (!res.ok) throw new Error(res.error);
  return 'on';
}

function base64ToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const padded = (b64url + '='.repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
