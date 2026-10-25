'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { checkInAction, diagnoseAction, type CheckInResult } from '@/app/actions';
import { compressPhoto } from '@/lib/image';
import type { CheckInOutcome } from '@/lib/care';

/** Hidden camera input plus a button, with a preview once a photo is chosen. */
function PhotoPicker({ photo, onPhoto, label }: { photo: string | null; onPhoto: (p: string | null) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            setError('');
            onPhoto(await compressPhoto(f));
          } catch {
            setError('Could not read that photo');
          }
        }}
      />
      {photo ? (
        <div className="health-photo">
          <img src={photo} alt="" />
          <button type="button" onClick={() => onPhoto(null)}>Remove</button>
        </div>
      ) : (
        <button type="button" className="block" onClick={() => ref.current?.click()}>📷 {label}</button>
      )}
      {error && <p className="error">{error}</p>}
    </>
  );
}

/** "Something's wrong?" Photo plus an optional note, sent for a diagnosis. */
export function StartHealthCheck({ plantId, nickname }: { plantId: string; nickname: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [error, setError] = useState('');

  if (!open) {
    return (
      <>
        {message && <div className={`banner ${message.tone === 'ok' ? 'ok' : ''}`}>{message.text}</div>}
        <button className="block" onClick={() => { setOpen(true); setMessage(null); }}>
          🔍 Something’s wrong?
        </button>
      </>
    );
  }

  return (
    <div className="card">
      <h3>What’s going on with {nickname}?</h3>
      <p className="small" style={{ margin: '6px 0 12px' }}>
        Take a close, well-lit photo of the problem. Include the undersides of leaves if you can: that is where pests hide.
      </p>
      <PhotoPicker photo={photo} onPhoto={setPhoto} label="Take a photo of the problem" />
      <label htmlFor="hnote">Anything you’ve noticed? (optional)</label>
      <textarea id="hnote" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. sticky leaves, tiny white dots, dropping leaves" />
      {message && <div className="banner">{message.text}</div>}
      <div className="actions">
        <button
          className="primary grow"
          disabled={pending || !photo}
          onClick={() =>
            start(async () => {
              setError('');
              setMessage(null);
              const r = await diagnoseAction(plantId, photo!, note);
              if (!r.ok) return setError(r.error);
              if (r.data.kind === 'retake') return setMessage({ tone: 'warn', text: r.data.message });
              setOpen(false);
              setPhoto(null);
              setNote('');
              if (r.data.kind === 'healthy') setMessage({ tone: 'ok', text: `Looks healthy. ${r.data.message}` });
              router.refresh();
            })
          }
        >
          {pending ? <><span className="spinner" /> Looking closely…</> : 'Check it'}
        </button>
        <button disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export type CaseView = {
  id: string;
  issue: string;
  confidence: 'high' | 'medium' | 'low' | null;
  signs: string;
  explanation: string;
  doNow: string[];
  repeat: string | null;
  alsoCouldBe: string;
  checkNearby: boolean;
  wateringChange: 'none' | 'water_less' | 'water_more';
  petsNote: boolean;
  dayNumber: number;
  nextCheck: { text: string; due: boolean } | null;
  /** Your last answer, shown as selected until the next check-in is due. */
  lastOutcome: 'better' | 'same' | 'worse' | null;
  latest: { kind: string; advice: string; steps: string[] } | null;
  timeline: { id: string; day: number; label: string; note: string | null; photo: string | null }[];
};

const SURE: Record<string, string> = { high: 'fairly sure', medium: 'likely', low: 'best guess' };
// Each answer's colour, used only when it is the selected one. Unselected buttons are plain.
const OUTCOMES: { value: CheckInOutcome; label: string; cls: string }[] = [
  { value: 'better', label: 'Better', cls: 'on-moist' },
  { value: 'same', label: 'Same', cls: 'on-same' },
  { value: 'worse', label: 'Worse', cls: 'on-dry' },
  { value: 'resolved', label: 'Resolved', cls: 'on-watered' },
];

/** An open health case: the plan, the latest advice, the timeline and the check-in buttons. */
export function HealthCase({ view }: { view: CaseView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<CheckInOutcome | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [error, setError] = useState('');

  const press = (o: CheckInOutcome) => {
    setWhich(o);
    setError('');
    start(async () => {
      const r = await checkInAction(view.id, o, photo, note);
      if (!r.ok) return setError(r.error);
      setResult(r.data);
      setPhoto(null);
      setNote('');
      router.refresh();
    });
  };

  return (
    <div className="card health-case">
      <div className="health-head">
        <span className="chip due">Treating</span>
        <span className="small">Day {view.dayNumber}</span>
      </div>
      <h3 style={{ marginTop: 6 }}>
        {view.issue}
        {view.confidence && <span className="small" style={{ fontWeight: 400 }}> ({SURE[view.confidence]})</span>}
      </h3>
      {view.signs && <p style={{ margin: '6px 0' }}>{view.signs}</p>}
      {view.explanation && <p className="small">{view.explanation}</p>}

      {view.latest && view.latest.kind !== 'diagnosis' ? (
        <div className="health-advice">
          <strong>Latest advice</strong>
          <p style={{ margin: '4px 0' }}>{view.latest.advice}</p>
          {view.latest.steps.length > 0 && (
            <ol className="health-list">{view.latest.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          )}
        </div>
      ) : (
        view.doNow.length > 0 && (
          <div className="health-advice">
            <strong>Do now</strong>
            <ol className="health-list">{view.doNow.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </div>
        )
      )}

      {view.repeat && <p className="small">Repeat: {view.repeat}.</p>}
      {view.checkNearby && <p className="small">This can spread. Check the plants nearby too.</p>}
      {view.wateringChange === 'water_less' && <p className="small">Watering has been eased off to help it recover.</p>}
      {view.wateringChange === 'water_more' && <p className="small">Watering has been brought forward: check the soil today.</p>}
      {view.alsoCouldBe && <p className="small">Also could be: {view.alsoCouldBe}</p>}

      {view.timeline.length > 0 && (
        <ul className="history" style={{ marginTop: 10 }}>
          {view.timeline.map((t) => (
            <li key={t.id}>
              <span>
                {t.photo && <img src={t.photo} alt="" className="health-thumb" />}
                Day {t.day}: {t.label}
                {t.note ? <span className="small"> · {t.note}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      <hr style={{ margin: '16px 0' }} />
      <strong>{view.nextCheck?.due ? 'Check-in due: how is it looking?' : `Next check-in: ${view.nextCheck?.text ?? 'any time'}`}</strong>
      <p className="small" style={{ margin: '4px 0 10px' }}>A new photo is optional, but it lets the app compare with the first one.</p>
      <PhotoPicker photo={photo} onPhoto={setPhoto} label="Add a photo (optional)" />
      <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" style={{ marginTop: 8 }} />
      <div className="actions" role="group" aria-label="How is it now?">
        {OUTCOMES.map((o) => {
          // At most one is highlighted: the one being saved, otherwise your last answer.
          const selected = pending ? which === o.value : view.lastOutcome === o.value;
          return (
          <button
            key={o.value}
            className={`grow choice ${selected ? o.cls : ''}`}
            aria-pressed={selected}
            disabled={pending}
            onClick={() => press(o.value)}
          >
            {pending && which === o.value ? <span className="spinner" /> : o.label}
          </button>
          );
        })}
      </div>
      {pending && (which === 'same' || which === 'worse') && <p className="small" style={{ marginTop: 8 }}>Comparing and working out the next step…</p>}
      {error && <p className="error">{error}</p>}
      {result && !pending && <p className="small" style={{ marginTop: 8 }}>Saved. {result.escalate ? 'Moving to a stronger treatment.' : ''}</p>}
    </div>
  );
}
