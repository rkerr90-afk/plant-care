'use client';

import { useState } from 'react';
import { browserClient } from '@/lib/supabase-browser';

// Sign-in uses a 6-digit email code rather than a magic link: on iPhone a link opens in Safari,
// not in the home-screen app, so the app would never see the session. A typed code avoids that.
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await browserClient().auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setStage('code');
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await browserClient().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setError(error.message);
    else window.location.href = '/';
  }

  return (
    <div style={{ paddingTop: '12vh' }}>
      <div style={{ fontSize: 44 }}>🌿</div>
      <h1>Plant Care</h1>
      <p className="sub">Photograph your plants. Get one reminder a day for the ones that need you.</p>

      {stage === 'email' ? (
        <form onSubmit={sendCode}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
          <div className="actions">
            <button className="primary block" disabled={busy || !email}>
              {busy ? <span className="spinner" /> : 'Send me a code'}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={verify}>
          <p style={{ marginTop: 20 }}>We sent a 6-digit code to <strong>{email}</strong>.</p>
          <label htmlFor="code">Code</label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={10}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
          />
          <div className="actions">
            <button className="primary grow" disabled={busy || code.length < 6}>
              {busy ? <span className="spinner" /> : 'Sign in'}
            </button>
            <button type="button" onClick={() => { setStage('email'); setCode(''); }}>
              Change email
            </button>
          </div>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
