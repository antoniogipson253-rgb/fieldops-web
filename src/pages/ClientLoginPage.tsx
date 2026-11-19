import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import AuthShell, { AuthField, AuthError } from '../components/AuthShell';
import Icon from '../components/ui/Icon';

export default function ClientLoginPage() {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setError(null);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          emailRedirectTo: `${window.location.origin}/client-portal`,
        },
      });
      if (otpError) throw otpError;
      setSent(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <AuthShell title="Check your email" center>
        <div className="fo-auth-badge" aria-hidden="true" style={{ backgroundColor: 'rgba(249, 115, 22, 0.12)', border: '2px solid #F97316', color: '#F97316' }}>
          <Icon name="mail" size={24} strokeWidth={2} />
        </div>
        <p style={{ margin: '0 0 24px 0', fontSize: 14, color: '#C7CDD6', lineHeight: 1.6 }}>
          We sent a login link to <strong style={{ color: '#F9FAFB', overflowWrap: 'anywhere' }}>{email}</strong>. Click it to access your project portal.
        </p>
        <button
          type="button"
          className="fo-auth-btn"
          onClick={() => { setSent(false); setEmail(''); setError(null); }}
          style={{ backgroundColor: 'transparent', border: '1px solid #2A3445', color: '#F9FAFB' }}
        >
          Use a different email
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Sign in to your project" subtitle="Client portal. Enter your email and we'll send you a secure login link.">
      <form onSubmit={handleSubmit}>
        <AuthField
          id="client-email"
          label="Email address"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          autoFocus
        />
        <div style={{ marginTop: 8 }}>
          {error && <AuthError>{error}</AuthError>}
          <button type="submit" className="fo-auth-btn" disabled={sending || !email.trim()}>
            {sending ? 'Sending…' : 'Send me a login link'}
          </button>
        </div>
      </form>
    </AuthShell>
  );
}
