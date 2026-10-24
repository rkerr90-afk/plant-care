'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { feedbackAction, waterAllDueAction } from '@/app/actions';
import type { Feedback, Flag } from '@/lib/care';

export function FeedbackButtons({ plantId, flag = null }: { plantId: string; flag?: Flag }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<Feedback | null>(null);
  const [error, setError] = useState('');

  const press = (f: Feedback) => {
    setWhich(f);
    setError('');
    start(async () => {
      const r = await feedbackAction(plantId, f);
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  };

  const label = (f: Feedback, text: string) => (pending && which === f ? <span className="spinner" /> : text);

  return (
    <>
      <div className="actions" role="group" aria-label="What did you find?">
        <button
          className={`grow choice ${flag === 'watered' ? 'on-watered' : ''}`}
          aria-pressed={flag === 'watered'}
          disabled={pending}
          onClick={() => press('watered')}
        >
          {label('watered', 'I watered it')}
        </button>
        <button
          className={`grow choice ${flag === 'still_moist' ? 'on-moist' : ''}`}
          aria-pressed={flag === 'still_moist'}
          disabled={pending}
          onClick={() => press('still_moist')}
          title="Soil still damp: check again in 2 days"
        >
          {label('still_moist', 'Still moist')}
        </button>
        <button
          className={`grow choice ${flag === 'bone_dry' ? 'on-dry' : ''}`}
          aria-pressed={flag === 'bone_dry'}
          disabled={pending}
          onClick={() => press('bone_dry')}
          title="Soil is very dry: needs water now"
        >
          {label('bone_dry', 'Bone dry')}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}

export function WaterAllButton({ count }: { count: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() =>
        start(async () => {
          await waterAllDueAction();
          router.refresh();
        })
      }
    >
      {pending ? <span className="spinner" /> : `Watered all ${count}`}
    </button>
  );
}
