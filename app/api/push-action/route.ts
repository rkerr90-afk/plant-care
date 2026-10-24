import { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/supabase';
import { feedbackAction, snoozeAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

/** Called by the service worker when an action button on a reminder is tapped. Uses the signed-in session cookie. */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { action?: string; ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? (body!.ids as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 100) : [];
  if (ids.length === 0) return NextResponse.json({ error: 'no plants' }, { status: 400 });

  if (body?.action === 'water') {
    for (const id of ids) await feedbackAction(id, 'watered');
    return NextResponse.json({ ok: true, count: ids.length });
  }
  if (body?.action === 'snooze') {
    const r = await snoozeAction(ids);
    return NextResponse.json(r.ok ? { ok: true, count: r.data.count } : { error: r.error }, { status: r.ok ? 200 : 500 });
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
