'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { feedbackAction, waterAllDueAction } from '@/app/actions';
import type { Feedback } from '@/lib/care';

export function FeedbackButtons({ plantId }: { plantId: string }) {
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
      <div className="actions">
        <button className="primary grow" disabled={pending} onClick={() => press('watered')}>
          {label('watered', 'Watered')}
        </button>
        <button disabled={pending} onClick={() => press('still_moist')} title="Soil still damp: check again in 2 days">
          {label('still_moist', 'Still moist')}
        </button>
        <button disabled={pending} onClick={() => press('bone_dry')} title="Watered, and it was very dry">
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
