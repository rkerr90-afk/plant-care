import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUserId, userClient } from '@/lib/supabase';
import { getProfile } from '@/lib/plants';
import { SettingsForm } from '@/components/SettingsForm';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const userId = await currentUserId();
  if (!userId) redirect('/login');
  const db = await userClient();
  const profile = await getProfile(db, userId);
  const { data } = await db.auth.getUser();

  return (
    <>
      <Link href="/" className="back">‹ Plants</Link>
      <h1>Settings</h1>
      <p className="sub">{data.user?.email}</p>
      <SettingsForm
        postcode={profile.postcode ?? ''}
        digestTime={String(profile.digest_time).slice(0, 5)}
        hasPets={profile.has_pets}
      />
    </>
  );
}
