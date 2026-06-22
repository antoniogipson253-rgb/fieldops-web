import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    if (!email.trim()) {
      setError('Please enter your email.');
      return;
    }
    setLoading(true);
    setError('');
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: 'https://app.fieldopspro.org/set-password',
    });
    if (resetError) {
      setError(resetError.message);
      setLoading(false);
      return;
    }
    setSent(true);
    setLoading(false);
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0A0F1E', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>

        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ fontSize: 32, fontWeight: 900, color: '#FFFFFF', letterSpacing: 6, marginBottom: 8 }}>FIELDOPS</div>
          <div style={{ fontSize: 13, color: '#F97316', fontWeight: 600, letterSpacing: 3 }}>PRO DASHBOARD</div>
        </div>

        <div style={{ backgroundColor: '#111827', borderRadius: 16, padding: 32, border: '1px solid #1F2937' }}>
          <h2 style={{ color: '#FFFFFF', fontSize: 22, fontWeight: 800, margin: 0 }}>Reset Your Password</h2>
          <p style={{ color: '#6B7280', fontSize: 14, marginBottom: 24, marginTop: 6 }}>
            Enter your email and we'll send you a link to reset your password.
          </p>

          {error && (
            <div style={{ backgroundColor: '#EF444420', border: '1px solid #EF4444', borderRadius: 8, padding: '10px 14px', color: '#EF4444', fontSize: 13, marginBottom: 16 }}>{error}</div>
          )}

          {sent ? (
            <div style={{ backgroundColor: '#10B98120', border: '1px solid #10B981', borderRadius: 8, padding: '10px 14px', color: '#10B981', fontSize: 13, marginBottom: 16 }}>
              If an account exists with that email, a password reset link has been sent.
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>EMAIL</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  placeholder="you@company.com"
                  style={{ width: '100%', padding: '12px 16px', backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 10, color: '#FFFFFF', fontSize: 15, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <button
                onClick={handleSubmit}
                disabled={loading}
                style={{ width: '100%', padding: '14px 24px', backgroundColor: loading ? '#F9731680' : '#F97316', border: 'none', borderRadius: 10, color: '#0A0F1E', fontSize: 15, fontWeight: 900, letterSpacing: 2, cursor: loading ? 'not-allowed' : 'pointer' }}
              >
                {loading ? 'SENDING...' : 'SEND RESET LINK'}
              </button>
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', color: '#374151', fontSize: 12, marginTop: 24 }}>
          <Link to="/login" style={{ color: '#6B7280', textDecoration: 'none' }}>
            Back to Sign In
          </Link>
        </p>

      </div>
    </div>
  );
}
