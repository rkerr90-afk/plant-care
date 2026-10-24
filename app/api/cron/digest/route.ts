import { NextResponse } from 'next/server';
import { adminClient, env } from '@/lib/supabase';
import { sendToUser } from '@/lib/push';
import { daysBetween, timeIn, todayIn } from '@/lib/care';

export const dynamic = 'force-dynamic';

/**
 * Called hourly by Supabase cron. For each user whose digest time has passed today and who
 * has not had a digest yet, sends one push listing the plants due today or overdue.
 */
export async function POST(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${env('CRON_SECRET')}`) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }
  const db = adminClient();
  const { data: profiles, error } = await db.from('profiles').select('id, timezone, digest_time, digest_every_days, last_digest_on');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = new Date();
  const results: { user: string; due: number; sent: number }[] = [];

  for (const p of profiles ?? []) {
    const today = todayIn(p.timezone, now);
    if (p.last_digest_on === today) continue;
    // Not yet N days since the last reminder.
    if (p.last_digest_on && daysBetween(p.last_digest_on, today) < (p.digest_every_days ?? 1)) continue;
    if (timeIn(p.timezone, now) < String(p.digest_time).slice(0, 5)) continue;

    const { data: due } = await db
      .from('plants')
      .select('nickname, next_due_on')
      .eq('user_id', p.id)
      .eq('status', 'active')
      .lte('next_due_on', today)
      .order('next_due_on');

    let sent = 0;
    if (due && due.length > 0) {
      const names = due.map((d) => d.nickname);
      const shown = names.slice(0, 4).join(', ') + (names.length > 4 ? ` and ${names.length - 4} more` : '');
      sent = await sendToUser(p.id, {
        title: due.length === 1 ? '1 plant to check today' : `${due.length} plants to check today`,
        body: shown,
        url: '/',
        tag: `digest-${today}`,
      });
    }
    await db.from('profiles').update({ last_digest_on: today }).eq('id', p.id);
    results.push({ user: p.id.slice(0, 8), due: due?.length ?? 0, sent });
  }

  return NextResponse.json({ ran: now.toISOString(), results });
}
