'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { changeSpeciesAction, deletePlantAction, updateContextAction } from '@/app/actions';
import { ContextFields, type ContextState } from './ContextFields';

export function PlantEditor({
  plantId,
  nickname: initialNickname,
  scientificName,
  context,
}: {
  plantId: string;
  nickname: string;
  scientificName: string;
  context: ContextState;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [nickname, setNickname] = useState(initialNickname);
  const [ctx, setCtx] = useState<ContextState>(context);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [fixing, setFixing] = useState(false);
  const [common, setCommon] = useState('');
  const [sci, setSci] = useState('');

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError('');
      setSaved(false);
      const r = await fn();
      if (!r.ok) return setError((r as { error: string }).error);
      setSaved(true);
      after?.();
      router.refresh();
    });

  return (
    <div className="card">
      <label htmlFor="nickname" style={{ marginTop: 0 }}>Name</label>
      <input id="nickname" type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} />

      <ContextFields value={ctx} onChange={setCtx} />

      <div className="actions" style={{ marginTop: 20 }}>
        <button className="primary grow" disabled={pending} onClick={() => run(() => updateContextAction(plantId, { nickname, ...ctx }))}>
          {pending ? <span className="spinner" /> : 'Save details'}
        </button>
      </div>
      {saved && <p className="small" style={{ marginTop: 8 }}>Saved. Watering schedule updated.</p>}
      {error && <p className="error">{error}</p>}

      <hr />

      {!fixing ? (
        <button className="block" onClick={() => setFixing(true)}>This isn’t the right species</button>
      ) : (
        <>
          <p className="small">Currently <em>{scientificName}</em>. Changing it rebuilds the care profile and keeps the history.</p>
          <label htmlFor="fixcommon">Common name</label>
          <input id="fixcommon" type="text" value={common} onChange={(e) => setCommon(e.target.value)} placeholder="e.g. Swiss cheese plant" />
          <label htmlFor="fixsci">Scientific name</label>
          <input id="fixsci" type="text" value={sci} onChange={(e) => setSci(e.target.value)} placeholder="e.g. Monstera deliciosa" />
          <div className="actions">
            <button
              className="primary grow"
              disabled={pending || !(sci.trim() || common.trim())}
              onClick={() => run(() => changeSpeciesAction(plantId, sci.trim() || common.trim(), common.trim()), () => setFixing(false))}
            >
              {pending ? <span className="spinner" /> : 'Change species'}
            </button>
            <button onClick={() => setFixing(false)}>Cancel</button>
          </div>
        </>
      )}

      <hr />
      <button
        className="block danger"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Delete ${nickname}? This removes its photo and history.`)) return;
          start(async () => {
            await deletePlantAction(plantId);
            router.push('/');
            router.refresh();
          });
        }}
      >
        Delete this plant
      </button>
    </div>
  );
}
