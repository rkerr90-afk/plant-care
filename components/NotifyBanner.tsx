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

  // 'needs-install' shows nothing here: the sign-in page already asks for the home screen first.
  if (state === null || state === 'on' || state === 'unsupported' || state === 'needs-install') return null;

  if (state === 'denied') {
    return (
      <div className="banner">
        Notifications are blocked. Turn them on in iPhone Settings, Notifications, Grow.
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
