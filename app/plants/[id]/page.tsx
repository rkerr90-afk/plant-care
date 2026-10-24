import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentUserId, userClient } from '@/lib/supabase';
import { getProfile, latestFlags, PLANT_SELECT, type PlantWithSpecies } from '@/lib/plants';
import { howToWater, todayIn } from '@/lib/care';
import { currentFlag, daysAgo, dueLabel, EVENT_LABEL, LIGHT_LABEL, sentence, shortDate } from '@/lib/format';
import { signedPhotoUrls } from '@/lib/photos';
import { FeedbackButtons } from '@/components/FeedbackButtons';
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
  const label = dueLabel(plant.next_due_on, today);
  const flag = currentFlag((await latestFlags(db, [plant.id]))[plant.id] ?? null, label);

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
        <div className="how">{sentence(howToWater(sp))} {sentence(sp.soil_check)}</div>
        <FeedbackButtons plantId={plant.id} flag={flag} />
      </div>

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
