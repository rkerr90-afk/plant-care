'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { movePlantAction } from '@/app/actions';
import { ContextFields, type ContextState } from './ContextFields';

/** One tap to say a plant has moved indoors or outside, then confirm where it now sits. */
export function MoveSwitch({ plantId, nickname, context }: { plantId: string; nickname: string; context: ContextState }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState<ContextState>(context);
  const [error, setError] = useState('');
  const toIndoor = context.setting === 'outdoor';

  const begin = () => {
    setCtx(
      toIndoor
        ? { ...context, setting: 'indoor', spot: '', light: 'medium', near_heat: false, exposure: null }
        : { ...context, setting: 'outdoor', spot: '', light: 'bright_direct', near_heat: false, exposure: 'exposed' },
    );
    setError('');
    setOpen(true);
  };

  if (!open) {
    return (
      <button className="block" onClick={begin}>
        {toIndoor ? 'Moved indoors' : 'Moved outside'}
      </button>
    );
  }

  return (
    <div>
      <p className="small" style={{ marginTop: 0 }}>
        Where is {nickname} now? The watering schedule starts fresh for the new spot.
      </p>
      <ContextFields value={ctx} onChange={setCtx} />
      <div className="actions" style={{ marginTop: 16 }}>
        <button
          className="primary grow"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await movePlantAction(plantId, { nickname, ...ctx });
              if (!r.ok) return setError(r.error);
              setOpen(false);
              router.refresh();
            })
          }
        >
          {pending ? <span className="spinner" /> : 'Confirm move'}
        </button>
        <button disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
