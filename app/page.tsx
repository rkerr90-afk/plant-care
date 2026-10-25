import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminClient, currentUserId, userClient } from '@/lib/supabase';
import { contextOf, getProfile, latestFlags, PLANT_SELECT, type PlantWithSpecies } from '@/lib/plants';
import { adjustedDue, awayPhase, frostRisk, howToWater, riskScore, todayIn, wateringInterval, type Flag } from '@/lib/care';
import { currentFlag, dueLabel, sentence, shortDate } from '@/lib/format';
import { getWeather } from '@/lib/weather';
import { openCases, type HealthCase } from '@/lib/health';
import { signedPhotoUrls } from '@/lib/photos';
import { FeedbackButtons, WaterAllButton } from '@/components/FeedbackButtons';
import { NotifyBanner } from '@/components/NotifyBanner';
import { StatusChip } from '@/components/StatusChip';
import { Unwrap } from '@/components/Unwrap';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<{ gift?: string }> }) {
  const { gift } = await searchParams;
  const userId = await currentUserId();
  if (!userId) redirect('/login');
  const db = await userClient();
  const profile = await getProfile(db, userId);
  const today = todayIn(profile.timezone);
  // The first-open gift: every new account (made in the last 14 days) except the owner's, which is the
  // first account ever created. It shows once per device. Add ?gift=preview to see it yourself.
  const { data: me } = await db.auth.getUser();
  const { data: owner } = await adminClient().from('profiles').select('id').order('created_at').limit(1).maybeSingle();
  const createdAt = me.user?.created_at ? Date.parse(me.user.created_at) : 0;
  const isHers = owner?.id !== userId && Date.now() - createdAt < 14 * 864e5;
  const preview = gift === 'preview';

  const { data } = await db
    .from('plants')
    .select(PLANT_SELECT)
    .eq('status', 'active')
    .order('next_due_on', { ascending: true, nullsFirst: false });
  const plants = (data ?? []) as PlantWithSpecies[];
  const photos = await signedPhotoUrls(plants.map((p) => p.photo_path));
  const flags = await latestFlags(db, plants.map((p) => p.id));

  const hasOutdoor = plants.some((p) => p.setting === 'outdoor');
  const weather = hasOutdoor ? await getWeather(profile.latitude, profile.longitude, profile.timezone, today) : null;
  const rows = plants
    .map((p) => ({ plant: p, ...adjustedDue(p, weather, today) }))
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
  const cases = await openCases(db);
  const waterDue = (r: { date: string | null }) => !!r.date && r.date <= today;
  const checkDue = (id: string) => !!cases[id]?.next_check_on && cases[id].next_check_on! <= today;
  const due = rows.filter((r) => waterDue(r) || checkDue(r.plant.id));
  const later = rows.filter((r) => !(waterDue(r) || checkDue(r.plant.id)));

  const frost = weather
    ? plants.filter((p) => frostRisk(p, p.species.profile.min_temp_c, weather.lowTonight))
    : [];
  const phase = awayPhase(profile.away_from, profile.away_until, today);
  const until = profile.away_until ?? today;
  const beforeYouGo = phase === 'upcoming' ? rows.filter((r) => r.date && r.date <= until) : [];
  const sunny = phase === 'upcoming' ? plants.filter((p) => p.setting === 'indoor' && p.light === 'bright_direct') : [];
  const catchUp =
    phase === 'returned'
      ? rows
          .filter((r) => (r.date && r.date < today) || cases[r.plant.id])
          // Plants under treatment go first, then the thirstiest.
          .map((r) => ({ ...r, risk: (cases[r.plant.id] ? 100 : 0) + riskScore(r.date, wateringInterval(r.plant.species.profile, contextOf(r.plant), today), today) }))
          .sort((a, b) => b.risk - a.risk)
      : [];

  return (
    <>
      {(isHers || preview) && <Unwrap preview={preview} />}
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

      {frost.length > 0 && weather && (
        <div className="banner">
          <strong>Frost tonight</strong> (low about {Math.round(weather.lowTonight ?? 0)}°C). Bring in or fleece:{' '}
          {frost.map((p) => p.nickname).join(', ')}.
        </div>
      )}

      {phase === 'away' && (
        <div className="banner ok">
          Away until {shortDate(until)}. Reminders are paused and will start again when you are back.
        </div>
      )}

      {phase === 'upcoming' && profile.away_from && (
        <div className="card">
          <h3>Before you go ({shortDate(profile.away_from)} to {shortDate(until)})</h3>
          {beforeYouGo.length === 0 ? (
            <p className="small" style={{ margin: '6px 0 0' }}>Nothing will run dry while you are away.</p>
          ) : (
            <>
              <p className="small" style={{ margin: '6px 0' }}>
                These would be due before you are back. Water them the day you leave, most urgent first:
              </p>
              <ul className="history">
                {beforeYouGo.map((r) => (
                  <li key={r.plant.id}>
                    <span>{r.plant.nickname}</span>
                    <span>{dueLabel(r.date, today).text}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {sunny.length > 0 && (
            <p className="small" style={{ marginBottom: 0 }}>
              Move out of direct sun to slow drying: {sunny.map((p) => p.nickname).join(', ')}. Grouping indoor plants
              together in bright, indirect light also helps.
            </p>
          )}
        </div>
      )}

      {phase === 'returned' && catchUp.length > 0 && (
        <div className="card">
          <h3>Welcome back</h3>
          <p className="small" style={{ margin: '6px 0' }}>Start at the top. These are the ones that waited longest for their size of gap.</p>
          <ul className="history">
            {catchUp.map((r) => (
              <li key={r.plant.id}>
                <span>{r.plant.nickname}</span>
                <span>{cases[r.plant.id] ? `Treating: ${cases[r.plant.id].issue}` : dueLabel(r.date, today).text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
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
            {due.filter(waterDue).length > 1 && <WaterAllButton ids={due.filter(waterDue).map((r) => r.plant.id)} />}
          </div>
          {due.map((r) => (
            <PlantCard key={r.plant.id} plant={r.plant} due={r.date} note={r.note} today={today} photo={photos[r.plant.photo_path ?? '']} pets={profile.has_pets} flag={flags[r.plant.id] ?? null} healthCase={cases[r.plant.id]} showActions={waterDue(r)} />
          ))}
        </>
      )}

      {later.length > 0 && (
        <>
          <h2>Coming up</h2>
          {later.map((r) => (
            <PlantCard key={r.plant.id} plant={r.plant} due={r.date} note={r.note} today={today} photo={photos[r.plant.photo_path ?? '']} pets={profile.has_pets} flag={flags[r.plant.id] ?? null} healthCase={cases[r.plant.id]} />
          ))}
        </>
      )}

      <Link href="/plants/new" className="button primary fab">＋ Add a plant</Link>
    </>
  );
}

function PlantCard({
  plant,
  due,
  note,
  today,
  photo,
  pets,
  flag,
  healthCase,
  showActions = false,
}: {
  plant: PlantWithSpecies;
  due: string | null;
  note: string | null;
  today: string;
  photo?: string;
  pets: boolean;
  flag: Flag;
  healthCase?: HealthCase;
  showActions?: boolean;
}) {
  const checkIn = healthCase?.next_check_on && healthCase.next_check_on <= today;
  const label = dueLabel(due, today);
  const shown = currentFlag(flag, label);
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
            <StatusChip flag={shown} label={label} />
            {pets && profile.toxic_to_pets && <span className="chip warn">Toxic to pets</span>}
            {plant.needs_context && <span className="chip warn">Finish setup</span>}
            {healthCase && <span className="chip due">Treating: {healthCase.issue}</span>}
          </div>
          {note && <div className="small" style={{ marginTop: 4 }}>{note}</div>}
          {checkIn && <div className="small" style={{ marginTop: 4 }}>Check-in due: tap to log how it’s doing.</div>}
          {showActions && <div className="how">{sentence(howToWater(profile))} {sentence(profile.soil_check)}</div>}
        </div>
      </Link>
      {showActions && <FeedbackButtons plantId={plant.id} flag={shown} />}
    </div>
  );
}
