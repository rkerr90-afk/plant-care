'use client';

import { useEffect, useState } from 'react';
import { enablePush, pushState, type PushState } from '@/lib/push-client';

export function NotifyBanner() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    pushState().then(setState).catch(() => setState('unsupported'));
  }, []);

  if (state === null || state === 'on' || state === 'unsupported') return null;

  if (state === 'needs-install') {
    return (
      <div className="banner">
        <strong>Get your daily reminder:</strong> tap the Share button, then <em>Add to Home Screen</em>, and open
        Plants from your home screen. iPhones only send notifications to installed apps.
      </div>
    );
  }

  if (state === 'denied') {
    return (
      <div className="banner">
        Notifications are blocked. Turn them on in iPhone Settings, Notifications, Plants.
      </div>
    );
  }

  return (
    <div className="banner">
      <div>Turn on your daily reminder so you know when plants need checking.</div>
      <div className="actions">
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              setState(await enablePush());
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not turn on notifications');
            }
            setBusy(false);
          }}
        >
          {busy ? <span className="spinner" /> : 'Turn on reminders'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
