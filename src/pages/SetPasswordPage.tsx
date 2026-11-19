import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AuthShell, { AuthField, AuthError } from '../components/AuthShell';

export default function SetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }
    navigate('/');
  }

  return (
    <AuthShell title="Choose a new password" subtitle="Your new password must be at least 8 characters.">
      <AuthField
        id="new-password"
        label="New password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        placeholder="••••••••"
      />
      <AuthField
        id="confirm-password"
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        placeholder="••••••••"
      />
      <div style={{ marginTop: 8 }}>
        {error && <AuthError>{error}</AuthError>}
        <button type="button" className="fo-auth-btn" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Saving...' : 'Update password'}
        </button>
      </div>
    </AuthShell>
  );
}
