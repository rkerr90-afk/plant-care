'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteAccountAction, saveAwayAction, saveSettingsAction, sendTestPushAction, signOutAction } from '@/app/actions';
import { NotifyBanner } from './NotifyBanner';

export function SettingsForm({
  postcode: p0,
  digestTime: t0,
  everyDays: n0,
  hasPets: pets0,
  awayFrom: af0,
  awayUntil: au0,
}: {
  postcode: string;
  digestTime: string;
  everyDays: number;
  hasPets: boolean;
  awayFrom: string;
  awayUntil: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [postcode, setPostcode] = useState(p0);
  const [time, setTime] = useState(t0);
  const [every, setEvery] = useState(n0);
  const [pets, setPets] = useState(pets0);
  const [awayFrom, setAwayFrom] = useState(af0);
  const [awayUntil, setAwayUntil] = useState(au0);
  const [awayMsg, setAwayMsg] = useState('');
  const [awayError, setAwayError] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  return (
    <>
      <NotifyBanner />
      <div className="card">
        <label htmlFor="pc" style={{ marginTop: 0 }}>Home postcode</label>
        <input id="pc" type="text" autoCapitalize="characters" value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="SW16 1AA" />
        <p className="small" style={{ marginTop: 6 }}>Used only to look up local weather for outdoor plants.</p>

        <label htmlFor="time">Reminder time</label>
        <input id="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />

        <label htmlFor="every">How often</label>
        <select id="every" value={every} onChange={(e) => setEvery(Number(e.target.value))}>
          <option value={1}>Every day</option>
          {[2, 3, 4, 5, 6, 7].map((n) => (
            <option key={n} value={n}>Every {n} days</option>
          ))}
        </select>
        <p className="small" style={{ marginTop: 6 }}>
          Each reminder lists everything due or overdue. Your plant list in the app is always up to date.
        </p>

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
                const r = await saveSettingsAction({ postcode, digest_time: time, digest_every_days: every, has_pets: pets });
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

      <h2>Away</h2>
      <div className="card">
        <p className="small" style={{ marginTop: 0 }}>
          Going away? Reminders pause between these dates. Before you leave the app lists what to water first, and
          when you are back it lists what needs you most.
        </p>
        <label htmlFor="af" style={{ marginTop: 0 }}>Leaving</label>
        <input id="af" type="date" value={awayFrom} onChange={(e) => setAwayFrom(e.target.value)} />
        <label htmlFor="au">Back on</label>
        <input id="au" type="date" value={awayUntil} min={awayFrom || undefined} onChange={(e) => setAwayUntil(e.target.value)} />
        <div className="actions" style={{ marginTop: 16 }}>
          <button
            className="primary grow"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setAwayMsg(''); setAwayError('');
                const r = await saveAwayAction(awayFrom || null, awayUntil || null);
                if (!r.ok) return setAwayError(r.error);
                setAwayMsg('Saved.');
                router.refresh();
              })
            }
          >
            Save dates
          </button>
          {(awayFrom || awayUntil) && (
            <button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setAwayMsg(''); setAwayError('');
                  const r = await saveAwayAction(null, null);
                  if (!r.ok) return setAwayError(r.error);
                  setAwayFrom(''); setAwayUntil('');
                  setAwayMsg('Cleared.');
                  router.refresh();
                })
              }
            >
              Clear
            </button>
          )}
        </div>
        {awayMsg && <p className="small" style={{ marginTop: 8 }}>{awayMsg}</p>}
        {awayError && <p className="error">{awayError}</p>}
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
