import { useState, useEffect, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AuthShell, { AuthField, AuthError, AuthSuccess } from '../components/AuthShell';

export default function LoginPage() {
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
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
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
      setSuccess('Account created! You can now sign in.');
    }
    setLoading(false);
  }

  const isLogin = mode === 'login';
  const submit = () => (isLogin ? handleLogin() : handleSignUp());
  const onEnter = (e: KeyboardEvent) => { if (e.key === 'Enter') submit(); };
  const switchMode = (m: string) => { setMode(m); setError(''); setSuccess(''); };

  return (
    <AuthShell
      title={isLogin ? 'Sign in' : 'Create your account'}
      subtitle={isLogin ? 'Welcome back.' : '30 days free - no credit card required'}
    >
      {!isLogin && (
        <AuthField id="signup-name" label="Full name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Smith" />
      )}
      {!isLogin && (
        <AuthField id="signup-company" label="Company / team name" type="text" autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Smith Construction Co." />
      )}

      <AuthField
        id="auth-email"
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={onEnter}
        placeholder="you@company.com"
      />

      <AuthField
        id="auth-password"
        label="Password"
        labelAside={isLogin ? <Link to="/forgot-password" className="fo-auth-link">Forgot password?</Link> : undefined}
        hint={isLogin ? undefined : 'At least 8 characters.'}
        type="password"
        autoComplete={isLogin ? 'current-password' : 'new-password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={onEnter}
        placeholder="••••••••"
      />

      <div style={{ marginTop: 8 }}>
        {error && <AuthError>{error}</AuthError>}
        {success && <AuthSuccess>{success}</AuthSuccess>}
        <button type="button" className="fo-auth-btn" onClick={isLogin ? handleLogin : handleSignUp} disabled={loading}>
          {loading ? (isLogin ? 'Signing in...' : 'Creating account...') : (isLogin ? 'Sign in' : 'Start free trial')}
        </button>
      </div>

      <p className="fo-auth-foot">
        {isLogin ? (
          <>New company? <button type="button" className="fo-auth-link" onClick={() => switchMode('signup')}>Create an account</button></>
        ) : (
          <>Already have an account? <button type="button" className="fo-auth-link" onClick={() => switchMode('login')}>Sign in</button></>
        )}
      </p>
    </AuthShell>
  );
}
