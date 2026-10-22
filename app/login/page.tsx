'use client';

import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('error') === 'oauth') {
      setMessage('Google sign-in could not be completed. Please try again.');
    }
  }, []);

  async function signInWithGoogle() {
    setBusy(true);
    setMessage('');
    const callback = new URL('/auth/callback', window.location.origin);
    callback.searchParams.set('next', '/?view=explore');
    try {
      const { error } = await createSupabaseBrowserClient().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: callback.toString() }
      });
      if (error) throw error;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Google sign-in could not be completed. Please try again.');
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <a className="auth-brand" href="/" aria-label="App Competition Analysis">
          <span className="brand-mark"><span /><span /><span /><span /></span>
          <span>App Competition Analysis</span>
        </a>
        <div className="auth-eyebrow">YOUR MARKET RESEARCH WORKSPACE</div>
        <h1 id="auth-title">Continue with Google.</h1>
        <p className="auth-description">New here? Your Google account creates a profile. Returning users can sign in the same way.</p>
        <button className="google-signin" type="button" onClick={() => void signInWithGoogle()} disabled={busy}>
          <GoogleMark /> {busy ? 'Connecting to Google…' : 'Continue with Google'}
        </button>
        {message && <p className="auth-message" role="status">{message}</p>}
      </section>
      <p className="auth-footer">A clearer view of your competition.</p>
    </main>
  );
}

function GoogleMark() {
  return <svg aria-hidden="true" className="google-mark" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.91c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.37 38.02 46.98 31.93 46.98 24.55Z"/><path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a23.95 23.95 0 0 0 0 21.56l7.98-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-6c-2.15 1.45-4.9 2.3-8.17 2.3-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>;
}
