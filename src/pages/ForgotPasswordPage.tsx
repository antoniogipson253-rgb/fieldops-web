import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AuthShell, { AuthField, AuthError, AuthSuccess } from '../components/AuthShell';

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
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we'll send you a link to reset your password."
    >
      {sent ? (
        <AuthSuccess>If an account exists with that email, a password reset link has been sent.</AuthSuccess>
      ) : (
        <>
          <AuthField
            id="reset-email"
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="you@company.com"
          />
          <div style={{ marginTop: 8 }}>
            {error && <AuthError>{error}</AuthError>}
            <button type="button" className="fo-auth-btn" onClick={handleSubmit} disabled={loading}>
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
          </div>
        </>
      )}

      <p className="fo-auth-foot">
        <Link to="/login" className="fo-auth-link">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}
