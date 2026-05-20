import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function AcceptInvitePage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
  }, []);

  async function handleSubmit() {
    if (!password || password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found.');

      const { data: memberData, error: memberError } = await supabase
        .from('company_members')
        .select('company_id, role')
        .eq('user_id', user.id)
        .single();

      if (memberError || !memberData) throw new Error('Could not find your company assignment.');

      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          company_id: memberData.company_id,
          role: memberData.role,
        })
        .eq('id', user.id);

      if (profileError) throw profileError;

      window.location.href = '/';
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  }

  if (!ready) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#0A0F1E', color: '#F97316', fontSize: 24, fontWeight: 'bold', letterSpacing: 4 }}>
        FIELDOPS
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#0A0F1E' }}>
      <div style={{ backgroundColor: '#111827', borderRadius: 8, padding: 40, width: '100%', maxWidth: 420, border: '1px solid #1F2937' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#F97316', letterSpacing: 4, marginBottom: 16, textTransform: 'uppercase' as const }}>
          FieldOps Pro
        </div>
        <h2 style={{ color: '#FFFFFF', fontSize: 24, fontWeight: 900, margin: '0 0 8px 0', textTransform: 'uppercase' as const, letterSpacing: 1 }}>
          Set Your Password
        </h2>
        <p style={{ color: '#6B7280', fontSize: 14, margin: '0 0 32px 0' }}>
          Create a password to activate your account and join your team.
        </p>
        <div style={{ marginBottom: 16 }}>
          <label style={{ color: '#9CA3AF', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, display: 'block', marginBottom: 8 }}>
            New Password
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ width: '100%', padding: '12px 14px', backgroundColor: '#0A0F1E', border: '1px solid #1F2937', borderRadius: 6, color: '#FFFFFF', fontSize: 14, boxSizing: 'border-box' as const }}
          />
        </div>
        <div style={{ marginBottom: 24 }}>
          <label style={{ color: '#9CA3AF', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, display: 'block', marginBottom: 8 }}>
            Confirm Password
          </label>
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            style={{ width: '100%', padding: '12px 14px', backgroundColor: '#0A0F1E', border: '1px solid #1F2937', borderRadius: 6, color: '#FFFFFF', fontSize: 14, boxSizing: 'border-box' as const }}
          />
        </div>
        {error && (
          <div style={{ color: '#EF4444', fontSize: 13, marginBottom: 16 }}>{error}</div>
        )}
        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{ width: '100%', padding: '14px', backgroundColor: '#F97316', border: 'none', borderRadius: 6, color: '#FFFFFF', fontSize: 13, fontWeight: 800, letterSpacing: 2, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, textTransform: 'uppercase' as const }}
        >
          {loading ? 'Activating...' : 'Activate Account'}
        </button>
      </div>
    </div>
  );
}