import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentUserId, userClient } from '@/lib/supabase';
import { getProfile, latestFlags, PLANT_SELECT, type PlantWithSpecies } from '@/lib/plants';
import { adjustedDue, daysBetween, howToWater, todayIn } from '@/lib/care';
import type { HealthCase as Case, HealthUpdate } from '@/lib/health';
import { HealthCase, StartHealthCheck, type CaseView } from '@/components/HealthCheck';
import { getWeather } from '@/lib/weather';
import { currentFlag, daysAgo, dueLabel, EVENT_LABEL, LIGHT_LABEL, sentence, shortDate } from '@/lib/format';
import { signedPhotoUrls } from '@/lib/photos';
import { FeedbackButtons } from '@/components/FeedbackButtons';
import { MoveSwitch } from '@/components/MoveSwitch';
import { PlantEditor } from '@/components/PlantEditor';
import { StatusChip } from '@/components/StatusChip';

export const dynamic = 'force-dynamic';

export default async function PlantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) redirect('/login');
  const db = await userClient();
  const profile = await getProfile(db, userId);
  const today = todayIn(profile.timezone);

  const { data } = await db.from('plants').select(PLANT_SELECT).eq('id', id).maybeSingle();
  if (!data) notFound();
  const plant = data as PlantWithSpecies;
  const sp = plant.species.profile;
  const photos = await signedPhotoUrls([plant.photo_path]);
  const photo = plant.photo_path ? photos[plant.photo_path] : undefined;
  const weather = plant.setting === 'outdoor' ? await getWeather(profile.latitude, profile.longitude, profile.timezone, today) : null;
  const adj = adjustedDue(plant, weather, today);
  const label = dueLabel(adj.date, today);
  const flag = currentFlag((await latestFlags(db, [plant.id]))[plant.id] ?? null, label);

  // Open health case, if any (quietly absent until the health SQL has been run).
  const { data: caseRow } = await db.from('health_cases').select('*').eq('plant_id', plant.id).eq('status', 'open').maybeSingle();
  let caseView: CaseView | null = null;
  if (caseRow) {
    const c = caseRow as Case;
    const { data: ups } = await db.from('health_updates').select('*').eq('case_id', c.id).order('created_at');
    const updates = (ups ?? []) as HealthUpdate[];
    const urls = await signedPhotoUrls(updates.map((u) => u.photo_path));
    const last = updates[updates.length - 1];
    const LABEL: Record<string, string> = { diagnosis: 'found', better: 'better', same: 'same', worse: 'worse', resolved: 'resolved' };
    const next = c.next_check_on ? dueLabel(c.next_check_on, today) : null;
    caseView = {
      id: c.id,
      issue: c.issue,
      confidence: c.confidence,
      signs: c.plan.signs ?? '',
      explanation: c.plan.explanation ?? '',
      doNow: c.plan.do_now ?? [],
      repeat: c.repeat_every_days && c.plan.repeat_action ? `${c.plan.repeat_action}, every ${c.repeat_every_days} days` : null,
      alsoCouldBe: c.plan.also_could_be ?? '',
      checkNearby: !!c.plan.check_nearby,
      wateringChange: c.plan.watering_change ?? 'none',
      petsNote: profile.has_pets,
      dayNumber: daysBetween(c.opened_on, today) + 1,
      nextCheck: next ? { text: next.text, due: next.due } : null,
      lastOutcome:
        last && (last.kind === 'better' || last.kind === 'same' || last.kind === 'worse') && !next?.due ? last.kind : null,
      latest: last ? { kind: last.kind, advice: last.advice ?? '', steps: last.next_steps ?? [] } : null,
      timeline: updates.map((u) => ({
        id: u.id,
        day: daysBetween(c.opened_on, u.created_at.slice(0, 10)) + 1,
        label: LABEL[u.kind] ?? u.kind,
        note: u.note,
        photo: u.photo_path ? urls[u.photo_path] ?? null : null,
      })),
    };
  }

  const { data: events } = await db
    .from('events')
    .select('id, kind, detail, created_at')
    .eq('plant_id', id)
    .order('created_at', { ascending: false })
    .limit(15);

  return (
    <>
      <Link href="/" className="back">‹ Plants</Link>
      {photo ? <img src={photo} alt={plant.nickname} className="hero-photo" /> : null}
      <h1 style={{ marginTop: 14 }}>{plant.nickname}</h1>
      <p className="sub">
        {plant.species.common_name} · <em>{plant.species.scientific_name}</em>
      </p>

      <div className="card">
        <StatusChip flag={flag} label={label} />
        {plant.last_watered_on && (
          <span className="small">Last watered {shortDate(plant.last_watered_on)} ({daysAgo(plant.last_watered_on, today)})</span>
        )}
        {adj.note && <div className="small" style={{ marginTop: 6 }}>{adj.note}</div>}
        <div className="how">{sentence(howToWater(sp))} {sentence(sp.soil_check)}</div>
        <FeedbackButtons plantId={plant.id} flag={flag} />
      </div>

      {caseView ? <HealthCase view={caseView} /> : <StartHealthCheck plantId={plant.id} nickname={plant.nickname} />}

      {sp.toxic_to_pets && (
        <div className="banner">
          <strong>Toxic to pets.</strong> {sentence(sp.toxicity_note) || 'Keep away from dogs and cats.'}
        </div>
      )}

      {plant.needs_context && (
        <div className="banner">Finish setup below so the watering schedule can use where this plant lives.</div>
      )}

      <h2>Care</h2>
      <div className="card">
        <p>{sp.care_summary}</p>
        <p className="small">
          Prefers: {sp.light_preference}. Currently: {plant.setting === 'outdoor' ? 'outdoors' : 'indoors'}
          {plant.light ? `, ${LIGHT_LABEL[plant.light].toLowerCase()}` : ''}
          {plant.spot ? `, ${plant.spot}` : ''}.
        </p>
        <p className="small" style={{ marginBottom: 0 }}>
          Watering adapts to the season and to your “still moist” and “bone dry” taps
          {plant.feedback_factor !== 1 ? ` (currently adjusted to ${Number(plant.feedback_factor).toFixed(2)}×)` : ''}.
        </p>
      </div>

      <h2>Details</h2>
      <div className="card">
        <MoveSwitch
          plantId={plant.id}
          nickname={plant.nickname}
          context={{
            setting: plant.setting,
            spot: plant.spot ?? '',
            light: plant.light,
            near_heat: plant.near_heat,
            exposure: plant.exposure,
            pot_material: plant.pot_material,
            has_drainage: plant.has_drainage,
            pot_size: plant.pot_size,
          }}
        />
      </div>
      <PlantEditor
        plantId={plant.id}
        nickname={plant.nickname}
        scientificName={plant.species.scientific_name}
        context={{
          setting: plant.setting,
          spot: plant.spot ?? '',
          light: plant.light,
          near_heat: plant.near_heat,
          exposure: plant.exposure,
          pot_material: plant.pot_material,
          has_drainage: plant.has_drainage,
          pot_size: plant.pot_size,
        }}
      />

      <h2>History</h2>
      <div className="card">
        <ul className="history">
          {(events ?? []).map((e) => (
            <li key={e.id}>
              <span>{e.detail && e.kind === 'species_changed' ? `Species: ${e.detail}` : e.kind === 'note' && e.detail ? e.detail : EVENT_LABEL[e.kind] ?? e.kind}</span>
              <span>{shortDate(e.created_at.slice(0, 10))}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
