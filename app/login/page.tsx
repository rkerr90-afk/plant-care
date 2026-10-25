'use client';

import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase-browser';

/** True when opened from the home-screen icon rather than in a browser tab. */
function isInstalled(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

/** iPhone or iPad (iPads report themselves as Macs with touch). */
function isAppleMobile(): boolean {
  const ua = window.navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

const IOS_BLUE = '#0a84ff';

function ShareIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 18 22" aria-hidden="true">
      <path d="M9 1v13M4.5 5.5 9 1l4.5 4.5" fill="none" stroke={IOS_BLUE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 9H3.5A1.5 1.5 0 0 0 2 10.5v8A1.5 1.5 0 0 0 3.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 14.5 9H12" fill="none" stroke={IOS_BLUE} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function AddToHomeIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5v9M7.5 12h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** One install step: a picture of what to tap, then the words. */
function Step({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="step">
      <span className="step-n">{n}</span>
      <span className="step-icon">{icon}</span>
      <span className="step-text">{children}</span>
    </li>
  );
}

// Email + password sign-in. Needs "Confirm email" switched off in Supabase
// (Authentication > Sign In / Providers > Email), so sign-up works with no email at all.
export default function LoginPage() {
  const [screen, setScreen] = useState<'checking' | 'install' | 'account'>('checking');
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // In Safari on an iPhone, ask for the home screen first: reminders only work from there.
  useEffect(() => {
    setScreen(isAppleMobile() && !isInstalled() ? 'install' : 'account');
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const auth = browserClient().auth;
    const creds = { email: email.trim(), password };
    const { data, error } = mode === 'signin' ? await auth.signInWithPassword(creds) : await auth.signUp(creds);
    setBusy(false);
    if (error) {
      if (/already registered|already exists/i.test(error.message)) {
        return setError('That email already has an account. Tap “Sign in” below.');
      }
      if (/invalid login/i.test(error.message)) {
        return setError('That email and password don’t match. New here? Tap “Create an account” below.');
      }
      return setError(error.message);
    }
    if (!data.session) {
      return setError('Account created, but Supabase still wants email confirmation. Turn off "Confirm email" in Supabase, then sign in.');
    }
    window.location.href = '/';
  }

  if (screen === 'checking') return null;

  if (screen === 'install') {
    return (
      <div style={{ paddingTop: '10vh' }}>
        <h1>Grow 🍃</h1>
        <p className="sub">First, put Grow on your home screen.</p>

        <ol className="steps card">
          <Step n={1} icon={<ShareIcon />}>
            Tap <strong>Share</strong> at the bottom of Safari.
            <span className="small step-hint">Can’t see it? Tap <strong>•••</strong> first.</span>
          </Step>
          <Step n={2} icon={<AddToHomeIcon />}>
            Scroll down and tap <strong>Add to Home Screen</strong>.
          </Step>
          <Step n={3} icon={<span className="ios-add">Add</span>}>
            Check the name says <strong>Grow 🍃</strong>, then tap <strong>Add</strong> at the top right.
          </Step>
          <Step n={4} icon={<img src="/icons/apple-touch-icon.png" alt="" className="step-app" />}>
            Close Safari and open <strong>Grow 🍃</strong> from your home screen.
          </Step>
        </ol>

        <p className="small" style={{ marginTop: 16 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); setScreen('account'); }}>
            Continue in Safari instead
          </a>
        </p>
      </div>
    );
  }

  return (
    <div style={{ paddingTop: '12vh' }}>
      <h1>Grow 🍃</h1>
      <p className="sub">
        {mode === 'signup' ? 'Create your account to get started.' : 'Welcome back.'}
      </p>

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
        <label htmlFor="password">{mode === 'signup' ? 'Choose a password' : 'Password'}</label>
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

      {error && <p className="error">{error}</p>}
      <p className="small" style={{ marginTop: 16 }}>
        {mode === 'signup' ? 'Already have an account? ' : 'New here? '}
        <a href="#" onClick={(e) => { e.preventDefault(); setError(''); setMode(mode === 'signup' ? 'signin' : 'signup'); }}>
          {mode === 'signup' ? 'Sign in' : 'Create an account'}
        </a>
      </p>
    </div>
  );
}
