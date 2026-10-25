import { NextResponse } from 'next/server';
import { adminClient, env } from '@/lib/supabase';
import { sendToUser } from '@/lib/push';
import { adjustedDue, awayPhase, daysBetween, frostRisk, timeIn, todayIn } from '@/lib/care';
import { PLANT_SELECT, type PlantWithSpecies } from '@/lib/plants';
import { shortDate } from '@/lib/format';
import { getWeather } from '@/lib/weather';

export const dynamic = 'force-dynamic';

const list = (names: string[], max = 4) => names.slice(0, max).join(', ') + (names.length > max ? ` and ${names.length - max} more` : '');

/**
 * Called hourly by Supabase cron. For each user whose reminder time has passed today:
 * - sends the watering digest if one is due (every N days), using weather-adjusted due dates;
 * - adds a frost warning for outdoor plants that cannot take tonight's low, even on days the digest is skipped;
 * - stays silent while the user is away.
 */
export async function POST(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${env('CRON_SECRET')}`) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }
  const db = adminClient();
  const { data: profiles, error } = await db.from('profiles').select('*');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = new Date();
  const results: { user: string; due: number; checkIns: number; frost: number; sent: number }[] = [];

  for (const p of profiles ?? []) {
    const today = todayIn(p.timezone, now);
    if (timeIn(p.timezone, now) < String(p.digest_time).slice(0, 5)) continue;
    const phase = awayPhase(p.away_from ?? null, p.away_until ?? null, today);
    if (phase === 'away') continue;

    const digestDue =
      p.last_digest_on !== today && !(p.last_digest_on && daysBetween(p.last_digest_on, today) < (p.digest_every_days ?? 1));
    const frostDue = p.last_frost_on !== today;
    if (!digestDue && !frostDue) continue;

    const { data } = await db.from('plants').select(PLANT_SELECT).eq('user_id', p.id).eq('status', 'active');
    const plants = (data ?? []) as PlantWithSpecies[];
    const weather = plants.some((x) => x.setting === 'outdoor')
      ? await getWeather(p.latitude, p.longitude, p.timezone, today)
      : null;

    const dueRows = plants
      .map((x) => ({ plant: x, ...adjustedDue(x, weather, today) }))
      .filter((r) => r.date && r.date <= today)
      .sort((a, b) => (a.date as string).localeCompare(b.date as string));
    const frost = frostDue && weather
      ? plants.filter((x) => frostRisk(x, x.species.profile.min_temp_c, weather.lowTonight))
      : [];
    // Health check-ins that are due. Missing tables (SQL not run yet) just mean none.
    const { data: caseRows } = digestDue
      ? await db.from('health_cases').select('plant_id, issue, opened_on').eq('user_id', p.id).eq('status', 'open').lte('next_check_on', today)
      : { data: [] as { plant_id: string; issue: string; opened_on: string }[] };
    const nameOf = Object.fromEntries(plants.map((x) => [x.id, x.nickname]));
    const checkIns = (caseRows ?? []).filter((c) => nameOf[c.plant_id]);

    const leaving =
      digestDue && phase === 'upcoming' && p.away_until
        ? plants.filter((x) => adjustedDue(x, weather, today).date! <= p.away_until).length
        : 0;

    const parts: string[] = [];
    let title = '';
    const ids = digestDue ? dueRows.map((r) => r.plant.id) : [];
    if (digestDue && dueRows.length > 0) {
      title = dueRows.length === 1 ? '1 plant to check today' : `${dueRows.length} plants to check today`;
      parts.push(list(dueRows.map((r) => r.plant.nickname)));
    }
    if (checkIns.length > 0) {
      parts.push(
        'Check-in: ' +
          checkIns.map((c) => `${nameOf[c.plant_id]} (${c.issue.toLowerCase()}, day ${daysBetween(c.opened_on, today) + 1})`).join(', ') +
          '.',
      );
      if (!title) title = checkIns.length === 1 ? `Check-in: ${nameOf[checkIns[0].plant_id]}` : `${checkIns.length} plant check-ins`;
    }
    if (frost.length > 0) {
      const low = Math.round(weather?.lowTonight ?? 0);
      parts.push(`Frost tonight (${low}°C): bring in or fleece ${list(frost.map((f) => f.nickname), 3)}.`);
      if (!title) title = 'Frost tonight';
    }
    if (leaving > 0 && p.away_from) {
      parts.push(`Leaving ${shortDate(p.away_from)}: ${leaving} ${leaving === 1 ? 'plant needs' : 'plants need'} water before you are back.`);
      if (!title) title = 'Away soon';
    }

    let sent = 0;
    if (parts.length > 0) {
      sent = await sendToUser(p.id, {
        title,
        body: parts.join('\n'),
        url: '/',
        tag: `digest-${today}`,
        ...(ids.length > 0
          ? { ids, actions: [{ action: 'water' as const, title: 'Mark watered' }, { action: 'snooze' as const, title: 'Snooze a day' }] }
          : {}),
      });
    }
    await db
      .from('profiles')
      .update({
        ...(digestDue ? { last_digest_on: today } : {}),
        ...(frost.length > 0 ? { last_frost_on: today } : {}),
      })
      .eq('id', p.id);
    results.push({ user: p.id.slice(0, 8), due: dueRows.length, checkIns: checkIns.length, frost: frost.length, sent });
  }

  return NextResponse.json({ ran: now.toISOString(), results });
}
