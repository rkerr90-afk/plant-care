import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUserId, userClient } from '@/lib/supabase';
import { getProfile, latestFlags, PLANT_SELECT, type PlantWithSpecies } from '@/lib/plants';
import { todayIn, howToWater, type Flag } from '@/lib/care';
import { dueLabel, sentence } from '@/lib/format';
import { signedPhotoUrls } from '@/lib/photos';
import { FeedbackButtons, WaterAllButton } from '@/components/FeedbackButtons';
import { NotifyBanner } from '@/components/NotifyBanner';
import { StatusChip } from '@/components/StatusChip';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const userId = await currentUserId();
  if (!userId) redirect('/login');
  const db = await userClient();
  const profile = await getProfile(db, userId);
  const today = todayIn(profile.timezone);

  const { data } = await db
    .from('plants')
    .select(PLANT_SELECT)
    .eq('status', 'active')
    .order('next_due_on', { ascending: true, nullsFirst: false });
  const plants = (data ?? []) as PlantWithSpecies[];
  const photos = await signedPhotoUrls(plants.map((p) => p.photo_path));
  const flags = await latestFlags(db, plants.map((p) => p.id));

  const due = plants.filter((p) => p.next_due_on && p.next_due_on <= today);
  const later = plants.filter((p) => !(p.next_due_on && p.next_due_on <= today));

  return (
    <>
      <div className="topbar">
        <h1>Your plants</h1>
        <Link href="/settings" className="button" aria-label="Settings">⚙︎</Link>
      </div>
      <p className="sub">
        {plants.length === 0
          ? 'Nothing here yet.'
          : due.length === 0
            ? 'Nothing needs you today.'
            : `${due.length} to check today.`}
      </p>

      <NotifyBanner />
      {!profile.postcode && plants.length > 0 && (
        <div className="banner">
          Add your postcode in <Link href="/settings">Settings</Link> so outdoor plants can use the weather.
        </div>
      )}

      {plants.length === 0 && (
        <div className="empty">
          <div className="big">🪴</div>
          <p>Take a photo of your first plant to get started.</p>
        </div>
      )}

      {due.length > 0 && (
        <>
          <div className="topbar" style={{ marginTop: 20 }}>
            <h2 style={{ margin: 0 }}>Today</h2>
            {due.length > 1 && <WaterAllButton count={due.length} />}
          </div>
          {due.map((p) => (
            <PlantCard key={p.id} plant={p} today={today} photo={photos[p.photo_path ?? '']} pets={profile.has_pets} flag={flags[p.id] ?? null} showActions />
          ))}
        </>
      )}

      {later.length > 0 && (
        <>
          <h2>Coming up</h2>
          {later.map((p) => (
            <PlantCard key={p.id} plant={p} today={today} photo={photos[p.photo_path ?? '']} pets={profile.has_pets} flag={flags[p.id] ?? null} />
          ))}
        </>
      )}

      <Link href="/plants/new" className="button primary fab">＋ Add a plant</Link>
    </>
  );
}

function PlantCard({
  plant,
  today,
  photo,
  pets,
  flag,
  showActions = false,
}: {
  plant: PlantWithSpecies;
  today: string;
  photo?: string;
  pets: boolean;
  flag: Flag;
  showActions?: boolean;
}) {
  const label = dueLabel(plant.next_due_on, today);
  const profile = plant.species.profile;
  return (
    <div className="card">
      <Link href={`/plants/${plant.id}`} className="plant">
        {photo ? <img src={photo} alt="" className="thumb" /> : <div className="thumb">🌱</div>}
        <div>
          <div className="plant-name">{plant.nickname}</div>
          <div className="plant-meta">
            {plant.species.common_name}
            {plant.setting === 'outdoor' ? ' · outdoor' : plant.spot ? ` · ${plant.spot}` : ''}
          </div>
          <div style={{ marginTop: 6 }}>
            <StatusChip flag={flag} label={label} />
            {pets && profile.toxic_to_pets && <span className="chip warn">Toxic to pets</span>}
            {plant.needs_context && <span className="chip warn">Finish setup</span>}
          </div>
          {showActions && <div className="how">{sentence(howToWater(profile))} {sentence(profile.soil_check)}</div>}
        </div>
      </Link>
      {showActions && <FeedbackButtons plantId={plant.id} flag={flag} />}
    </div>
  );
}
