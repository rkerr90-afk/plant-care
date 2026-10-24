'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { addPlantAction, identifyAction } from '@/app/actions';
import type { Identification } from '@/lib/claude';
import type { LastWatered } from '@/lib/care';
import { compressPhoto } from '@/lib/image';
import { ContextFields, DEFAULT_CONTEXT, type ContextState } from '@/components/ContextFields';

type Stage = 'photo' | 'identifying' | 'confirm' | 'context';
type Pick = { common_name: string; scientific_name: string };

const LAST_WATERED: { value: LastWatered; label: string }[] = [
  { value: 'today', label: 'Just now' },
  { value: 'few_days', label: 'A few days ago' },
  { value: 'week_plus', label: 'A week or more' },
  { value: 'not_sure', label: 'Not sure' },
];

export default function NewPlantPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('photo');
  const [photo, setPhoto] = useState<string | null>(null);
  const [ident, setIdent] = useState<Identification | null>(null);
  const [picked, setPicked] = useState<Pick | null>(null);
  const [manual, setManual] = useState(false);
  const [nickname, setNickname] = useState('');
  const [ctx, setCtx] = useState<ContextState>(DEFAULT_CONTEXT);
  const [last, setLast] = useState<LastWatered>('not_sure');
  const [quick, setQuick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError('');
    setStage('identifying');
    try {
      const dataUrl = await compressPhoto(file);
      setPhoto(dataUrl);
      const res = await identifyAction(dataUrl);
      if (!res.ok) throw new Error(res.error);
      setIdent(res.data);
      setPicked(res.data.candidates[0] ?? null);
      setManual(res.data.candidates.length === 0);
      setStage('confirm');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that photo');
      setStage('photo');
    }
  }

  function defaultNickname(p: Pick, spot: string) {
    return spot.trim() ? `${spot.trim().split(/[,/]/)[0]} ${p.common_name.toLowerCase()}` : p.common_name;
  }

  async function save(isQuick: boolean) {
    if (!picked) return;
    setBusy(true);
    setError('');
    const res = await addPlantAction({
      photoBase64: photo,
      scientific_name: picked.scientific_name,
      common_name: picked.common_name,
      nickname: nickname.trim() || defaultNickname(picked, ctx.spot),
      quick: isQuick,
      ...ctx,
      last_watered: last,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    if (isQuick) {
      // Quick-add: reset for the next plant.
      setPhoto(null); setIdent(null); setPicked(null); setManual(false); setNickname('');
      setCtx(DEFAULT_CONTEXT); setLast('not_sure'); setStage('photo');
      setQuick(true);
    } else {
      router.push('/');
      router.refresh();
    }
  }

  return (
    <>
      <Link href="/" className="back">‹ Back</Link>
      <h1>Add a plant</h1>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }}
      />

      {stage === 'photo' && (
        <>
          <p className="sub">{quick ? 'Saved. Snap the next one.' : 'Take a clear photo of the leaves.'}</p>
          <div className="actions">
            <button className="primary block" onClick={() => fileRef.current?.click()}>📷 Take or choose a photo</button>
          </div>
          <p className="small" style={{ marginTop: 12 }}>
            Prefer to skip the photo?{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); setManual(true); setPicked({ common_name: '', scientific_name: '' }); setStage('confirm'); }}>
              Type the species instead
            </a>.
          </p>
        </>
      )}

      {stage === 'identifying' && (
        <div className="empty">
          {photo && <img src={photo} alt="" className="hero-photo" style={{ marginBottom: 16 }} />}
          <p><span className="spinner" /> &nbsp;Working out what it is…</p>
        </div>
      )}

      {stage === 'confirm' && (
        <>
          {photo && <img src={photo} alt="Your plant" className="hero-photo" />}
          {ident && !ident.is_plant && <div className="banner">That doesn’t look like a plant. Try another photo, or type the species.</div>}
          {!manual && ident && ident.candidates.length > 0 && (
            <>
              <h2>Which one is it?</h2>
              {ident.candidates.map((c) => (
                <button
                  key={c.scientific_name}
                  className="candidate"
                  aria-pressed={picked?.scientific_name === c.scientific_name}
                  onClick={() => setPicked({ common_name: c.common_name, scientific_name: c.scientific_name })}
                >
                  <div className="plant-name">
                    {c.common_name} <span className={`chip ${c.confidence === 'high' ? '' : 'warn'}`}>{c.confidence}</span>
                  </div>
                  <div className="small"><em>{c.scientific_name}</em></div>
                  <div className="small">{c.why}</div>
                </button>
              ))}
              <button className="block" onClick={() => setManual(true)}>None of these: type it</button>
            </>
          )}
          {manual && (
            <>
              <label htmlFor="common">Common name</label>
              <input id="common" type="text" value={picked?.common_name ?? ''} placeholder="e.g. Swiss cheese plant"
                onChange={(e) => setPicked({ common_name: e.target.value, scientific_name: picked?.scientific_name || e.target.value })} />
              <label htmlFor="sci">Scientific name (optional)</label>
              <input id="sci" type="text" value={picked?.scientific_name ?? ''} placeholder="e.g. Monstera deliciosa"
                onChange={(e) => setPicked({ common_name: picked?.common_name ?? '', scientific_name: e.target.value })} />
            </>
          )}
          <div className="actions">
            <button className="primary grow" disabled={!picked?.scientific_name.trim()} onClick={() => setStage('context')}>
              Continue
            </button>
            <button onClick={() => { setStage('photo'); setPhoto(null); setIdent(null); }}>Retake</button>
          </div>
        </>
      )}

      {stage === 'context' && picked && (
        <>
          <p className="sub">{picked.common_name || picked.scientific_name}</p>

          <label htmlFor="nick">Name</label>
          <input id="nick" type="text" value={nickname} onChange={(e) => setNickname(e.target.value)}
            placeholder={defaultNickname(picked, ctx.spot)} />

          <label>When did you last water it?</label>
          <div className="seg">
            {LAST_WATERED.map((o) => (
              <button type="button" key={o.value} aria-pressed={last === o.value} onClick={() => setLast(o.value)}>{o.label}</button>
            ))}
          </div>

          <ContextFields value={ctx} onChange={setCtx} />

          <div className="actions" style={{ marginTop: 24 }}>
            <button className="primary grow" disabled={busy} onClick={() => save(false)}>
              {busy ? <span className="spinner" /> : 'Save plant'}
            </button>
          </div>
          <div className="actions">
            <button className="block" disabled={busy} onClick={() => save(true)}>
              Save now, finish details later, add another
            </button>
          </div>
        </>
      )}

      {error && <p className="error">{error}</p>}
    </>
  );
}
