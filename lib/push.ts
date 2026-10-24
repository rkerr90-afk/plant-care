import 'server-only';
import webpush from 'web-push';
import { adminClient, env } from './supabase';

let configured = false;
function configure() {
  if (configured) return;
  webpush.setVapidDetails(env('VAPID_SUBJECT'), env('NEXT_PUBLIC_VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  configured = true;
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

/** Sends to every device the user enabled. Drops subscriptions the push service says are gone. */
export async function sendToUser(userId: string, payload: PushPayload): Promise<number> {
  configure();
  const db = adminClient();
  const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', userId);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 6 },
      );
      sent++;
    } catch (err: unknown) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
      else console.error('push failed', code, err);
    }
  }
  return sent;
}
