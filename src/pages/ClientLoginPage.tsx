import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

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

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#111827', letterSpacing: 5 }}>FIELDOPS PRO</div>
          <div style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 600, letterSpacing: 3, textTransform: 'uppercase' as const, marginTop: 4 }}>client portal</div>
        </div>

        <div style={{ backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 16, padding: 32 }}>
          {!sent ? (
            <>
              <h2 style={{ margin: '0 0 8px 0', fontSize: 20, fontWeight: 700, color: '#111827' }}>Sign in to your portal</h2>
              <p style={{ margin: '0 0 24px 0', fontSize: 14, color: '#6B7280', lineHeight: 1.5 }}>Enter your email and we'll send you a secure login link.</p>
              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, textTransform: 'uppercase' as const, marginBottom: 6 }}>
                    Email address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoFocus
                    style={{ width: '100%', padding: '11px 14px', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 14, color: '#111827', backgroundColor: '#FFFFFF', outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' }}
                  />
                </div>
                {error && (
                  <div style={{ marginBottom: 16, padding: '10px 14px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 13, color: '#DC2626' }}>
                    {error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={sending || !email.trim()}
                  style={{ width: '100%', padding: 13, backgroundColor: (!email.trim() || sending) ? '#E5E7EB' : '#F97316', border: 'none', borderRadius: 8, color: (!email.trim() || sending) ? '#9CA3AF' : '#FFFFFF', fontSize: 14, fontWeight: 700, cursor: (!email.trim() || sending) ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                >
                  {sending ? 'Sending…' : 'Send me a login link'}
                </button>
              </form>
            </>
          ) : (
            <>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <div style={{ width: 52, height: 52, backgroundColor: '#FFF7ED', border: '2px solid #F97316', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, margin: '0 auto 16px' }}>
                  ✉️
                </div>
                <h2 style={{ margin: '0 0 10px 0', fontSize: 20, fontWeight: 700, color: '#111827' }}>Check your email</h2>
                <p style={{ margin: 0, fontSize: 14, color: '#6B7280', lineHeight: 1.6 }}>
                  We sent a login link to <strong style={{ color: '#111827' }}>{email}</strong>. Click it to access your project portal.
                </p>
              </div>
              <button
                onClick={() => { setSent(false); setEmail(''); setError(null); }}
                style={{ width: '100%', padding: '10px 14px', backgroundColor: 'transparent', border: '1px solid #E5E7EB', borderRadius: 8, color: '#6B7280', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Use a different email
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
