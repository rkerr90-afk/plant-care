'use client';

import { useState } from 'react';
import { browserClient } from '@/lib/supabase-browser';

// Email + password sign-in. Needs "Confirm email" switched off in Supabase
// (Authentication > Sign In / Providers > Email), so sign-up works with no email at all.
export default function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const auth = browserClient().auth;
    const creds = { email: email.trim(), password };
    const { data, error } = mode === 'signin' ? await auth.signInWithPassword(creds) : await auth.signUp(creds);
    setBusy(false);
    if (error) return setError(error.message);
    if (!data.session) {
      return setError('Account created, but Supabase still wants email confirmation. Turn off "Confirm email" in Supabase, then sign in.');
    }
    window.location.href = '/';
  }

  return (
    <div style={{ paddingTop: '12vh' }}>
      <h1>Grow 🍃</h1>
      <p className="sub">Photograph your plants. Get one reminder a day for the ones that need you.</p>

      <form onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
        />
        <div className="actions">
          <button className="primary block" disabled={busy || !email || password.length < 8}>
            {busy ? <span className="spinner" /> : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </div>
      </form>

      <p className="small" style={{ marginTop: 16 }}>
        {mode === 'signin' ? 'New here? ' : 'Already have an account? '}
        <a href="#" onClick={(e) => { e.preventDefault(); setError(''); setMode(mode === 'signin' ? 'signup' : 'signin'); }}>
          {mode === 'signin' ? 'Create an account' : 'Sign in'}
        </a>
      </p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
