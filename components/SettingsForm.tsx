'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteAccountAction, saveSettingsAction, sendTestPushAction, signOutAction } from '@/app/actions';
import { NotifyBanner } from './NotifyBanner';

export function SettingsForm({ postcode: p0, digestTime: t0, hasPets: pets0 }: { postcode: string; digestTime: string; hasPets: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [postcode, setPostcode] = useState(p0);
  const [time, setTime] = useState(t0);
  const [pets, setPets] = useState(pets0);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  return (
    <>
      <NotifyBanner />
      <div className="card">
        <label htmlFor="pc" style={{ marginTop: 0 }}>Home postcode</label>
        <input id="pc" type="text" autoCapitalize="characters" value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="SW16 1AA" />
        <p className="small" style={{ marginTop: 6 }}>Used only to look up local weather for outdoor plants.</p>

        <label htmlFor="time">Daily reminder time</label>
        <input id="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />

        <label className="toggle">
          <span>I have pets (warn me about toxic plants)</span>
          <input type="checkbox" checked={pets} onChange={(e) => setPets(e.target.checked)} />
        </label>

        <div className="actions" style={{ marginTop: 20 }}>
          <button
            className="primary grow"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setMsg(''); setError('');
                const r = await saveSettingsAction({ postcode, digest_time: time, has_pets: pets });
                if (!r.ok) return setError(r.error);
                setPostcode(r.data.postcode);
                setMsg('Saved.');
                router.refresh();
              })
            }
          >
            {pending ? <span className="spinner" /> : 'Save settings'}
          </button>
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setMsg(''); setError('');
                const r = await sendTestPushAction();
                if (!r.ok) setError(r.error); else setMsg('Test notification sent.');
              })
            }
          >
            Send test notification
          </button>
        </div>
        {msg && <p className="small" style={{ marginTop: 8 }}>{msg}</p>}
        {error && <p className="error">{error}</p>}
      </div>

      <h2>Account</h2>
      <div className="card">
        <form action={signOutAction}>
          <button className="block">Sign out</button>
        </form>
        <hr />
        <button
          className="block danger"
          disabled={pending}
          onClick={() => {
            if (!window.confirm('Delete your account, all plants, photos and history? This cannot be undone.')) return;
            start(async () => {
              const r = await deleteAccountAction();
              if (!r.ok) return setError(r.error);
              window.location.href = '/login';
            });
          }}
        >
          Delete my account
        </button>
      </div>
    </>
  );
}
