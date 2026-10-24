'use client';

import { useEffect, useState } from 'react';

const SEEN_KEY = 'plantcare-gift-opened';

/** The words. Edit freely. */
const LINES = {
  to: 'Dearest Halina',
  note: 'A little app to help you look after the things you grow',
};

/** What falls into the pot, in order. */
const DROPS = ['☕', '✨', '🍄', '❤️', '☀️', '🍃', '💧', '🫶'];
const FIRST_DROP_S = 1.8; // once the pot has faded in
const DROP_GAP_S = 1.25;

/**
 * A one-time gift on first open: an empty terracotta pot fades in, eight little things fall into it, a plant
 * grows out and the note appears. Remembered on this device, so it shows once. `preview` always shows it.
 */
export function Unwrap({ preview = false }: { preview?: boolean }) {
  const [state, setState] = useState<'hidden' | 'playing' | 'leaving'>('hidden');

  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(SEEN_KEY) === '1';
    } catch {}
    if (preview || !seen) setState('playing');
  }, [preview]);

  if (state === 'hidden') return null;

  const done = () => {
    if (!preview) {
      try {
        window.localStorage.setItem(SEEN_KEY, '1');
      } catch {}
    }
    setState('leaving');
    window.setTimeout(() => setState('hidden'), 450);
  };

  return (
    <div className={`gift ${state === 'leaving' ? 'gift-leaving' : ''}`} role="dialog" aria-modal="true" aria-label="A note for you">
      <div className="gift-stage" aria-hidden="true">
        {DROPS.map((e, i) => (
          <span
            key={i}
            className="gift-drop"
            style={{ animationDelay: `${FIRST_DROP_S + i * DROP_GAP_S}s` }}
          >
            {e}
          </span>
        ))}
        <svg viewBox="0 0 200 260" width="200" height="260">
          <g className="gift-plant">
            <path d="M100 168 C100 140 100 118 100 96" stroke="var(--green)" strokeWidth="5" strokeLinecap="round" fill="none" />
            <path d="M100 112 C70 110 52 88 54 58 C84 58 102 80 100 112 Z" fill="var(--green)" />
            <path d="M100 98 C126 98 146 78 146 50 C118 50 100 70 100 98 Z" fill="var(--green)" opacity="0.85" />
          </g>
          <g className="gift-pot">
            <path d="M60 180 L140 180 L128 250 Q127 254 122 254 L78 254 Q73 254 72 250 Z" fill="var(--terracotta)" />
            <rect x="50" y="158" width="100" height="24" rx="5" fill="var(--terracotta-dark)" />
            <ellipse cx="100" cy="163" rx="44" ry="4.5" fill="var(--soil)" />
          </g>
        </svg>
      </div>

      <div className="gift-note" aria-live="polite">
        <p className="gift-to">{LINES.to}</p>
        <p className="gift-wink">{LINES.note}</p>
        <button className="primary gift-go" onClick={done}>
          Click me
        </button>
      </div>
    </div>
  );
}
