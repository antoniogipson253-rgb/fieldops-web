import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useIsMobile } from '../hooks/useIsMobile';

export default function LoginPage() {
  const isMobile = useIsMobile();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'signup') {
      setMode('signup');
    }
  }, []);

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.');
      return;
    }
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  }

  async function handleSignUp() {
    if (!name.trim() || !company.trim() || !email.trim() || !password.trim()) {
      setError('Please fill out all fields.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    setError('');
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
          company_name: company,
        }
      }
    });
    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }
    if (data.user) {
  // Wait a moment for the trigger to create the company
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Get the company that was just created
  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', data.user.id)
    .single();

  if (profile?.company_id) {
    // Create the storage bucket for this company
    const { data: { session } } = await supabase.auth.getSession();
    await fetch(
      `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/create-company-bucket`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          company_id: profile.company_id,
          company_name: company,
        }),
      }
    );
  }

  setSuccess('Account created! You can now sign in.');
}
    setLoading(false);
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0A0F1E', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: isMobile ? 0 : 24 }}>
      <div style={{ width: '100%', maxWidth: isMobile ? 'calc(100% - 32px)' : 420 }}>

        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ fontSize: 32, fontWeight: 900, color: '#FFFFFF', letterSpacing: 6, marginBottom: 8 }}>FIELDOPS</div>
          <div style={{ fontSize: 13, color: '#F97316', fontWeight: 600, letterSpacing: 3 }}>PRO DASHBOARD</div>
        </div>

        <div style={{ display: 'flex', backgroundColor: '#111827', borderRadius: 10, padding: 4, marginBottom: 16, border: '1px solid #1F2937' }}>
          {['login', 'signup'].map((m) => (
            <button key={m} onClick={() => { setMode(m); setError(''); setSuccess(''); }} style={{ flex: 1, padding: '10px', minHeight: isMobile ? 44 : undefined, border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13, letterSpacing: 1, backgroundColor: mode === m ? '#F97316' : 'transparent', color: mode === m ? '#0A0F1E' : '#6B7280' }}>
              {m === 'login' ? 'SIGN IN' : 'FREE TRIAL'}
            </button>
          ))}
        </div>

        <div style={{ backgroundColor: '#111827', borderRadius: 16, padding: isMobile ? 20 : 32, border: '1px solid #1F2937' }}>
          <h2 style={{ color: '#FFFFFF', fontSize: 22, fontWeight: 800, margin: 0 }}>
            {mode === 'login' ? 'Sign In' : 'Start Free Trial'}
          </h2>
          <p style={{ color: '#6B7280', fontSize: 14, marginBottom: 24, marginTop: 6 }}>
            {mode === 'login' ? 'Access your construction dashboard' : '14 days free - no credit card required'}
          </p>

          {error && (
            <div style={{ backgroundColor: '#EF444420', border: '1px solid #EF4444', borderRadius: 8, padding: '10px 14px', color: '#EF4444', fontSize: 13, marginBottom: 16 }}>{error}</div>
          )}

          {success && (
            <div style={{ backgroundColor: '#10B98120', border: '1px solid #10B981', borderRadius: 8, padding: '10px 14px', color: '#10B981', fontSize: 13, marginBottom: 16 }}>{success}</div>
          )}

          {mode === 'signup' && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>FULL NAME</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Smith" style={{ width: '100%', padding: '12px 16px', minHeight: isMobile ? 44 : undefined, backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 10, color: '#FFFFFF', fontSize: 15, outline: 'none', boxSizing: 'border-box' }} />
            </div>
          )}

          {mode === 'signup' && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>COMPANY / TEAM NAME</label>
              <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Smith Construction Co." style={{ width: '100%', padding: '12px 16px', minHeight: isMobile ? 44 : undefined, backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 10, color: '#FFFFFF', fontSize: 15, outline: 'none', boxSizing: 'border-box' }} />
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>EMAIL</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (mode === 'login' ? handleLogin() : handleSignUp())} placeholder="you@company.com" style={{ width: '100%', padding: '12px 16px', minHeight: isMobile ? 44 : undefined, backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 10, color: '#FFFFFF', fontSize: 15, outline: 'none', boxSizing: 'border-box' }} />
          </div>

          <div style={{ marginBottom: mode === 'login' ? 12 : 24 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>PASSWORD</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (mode === 'login' ? handleLogin() : handleSignUp())} placeholder="••••••••" style={{ width: '100%', padding: '12px 16px', minHeight: isMobile ? 44 : undefined, backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 10, color: '#FFFFFF', fontSize: 15, outline: 'none', boxSizing: 'border-box' }} />
          </div>

          {mode === 'login' && (
            <div style={{ textAlign: 'right', marginBottom: 24 }}>
              <Link to="/forgot-password" style={{ color: '#F97316', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                Forgot password?
              </Link>
            </div>
          )}

          <button onClick={mode === 'login' ? handleLogin : handleSignUp} disabled={loading} style={{ width: '100%', padding: '14px 24px', minHeight: isMobile ? 44 : undefined, backgroundColor: loading ? '#F9731680' : '#F97316', border: 'none', borderRadius: 10, color: '#0A0F1E', fontSize: 15, fontWeight: 900, letterSpacing: 2, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? (mode === 'login' ? 'SIGNING IN...' : 'CREATING ACCOUNT...') : (mode === 'login' ? 'SIGN IN' : 'START FREE TRIAL')}
          </button>
        </div>

        <p style={{ textAlign: 'center', color: '#374151', fontSize: 12, marginTop: 24 }}>
          {mode === 'login' ? "Don't have an account? Click FREE TRIAL above" : 'Already have an account? Click SIGN IN above'}
        </p>

      </div>
    </div>
  );
}