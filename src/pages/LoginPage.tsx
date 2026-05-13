import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.');
      return;
    }

    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
    }

    setLoading(false);
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0A0F1E',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    }}>
      <div style={{
        width: '100%',
        maxWidth: 420,
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{
            fontSize: 32,
            fontWeight: 900,
            color: '#FFFFFF',
            letterSpacing: 6,
            marginBottom: 8,
          }}>FIELDOPS</div>
          <div style={{
            fontSize: 13,
            color: '#F97316',
            fontWeight: 600,
            letterSpacing: 3,
          }}>PRO DASHBOARD</div>
        </div>

        {/* Card */}
        <div style={{
          backgroundColor: '#111827',
          borderRadius: 16,
          padding: 32,
          border: '1px solid #1F2937',
        }}>
          <h2 style={{
            color: '#FFFFFF',
            fontSize: 22,
            fontWeight: 800,
            marginBottom: 8,
            margin: 0,
          }}>Sign In</h2>
          <p style={{
            color: '#6B7280',
            fontSize: 14,
            marginBottom: 24,
            marginTop: 6,
          }}>Access your construction dashboard</p>

          {error && (
            <div style={{
              backgroundColor: '#EF444420',
              border: '1px solid #EF4444',
              borderRadius: 8,
              padding: '10px 14px',
              color: '#EF4444',
              fontSize: 13,
              marginBottom: 16,
            }}>
              {error}
            </div>
          )}

          {/* Email */}
          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block',
              fontSize: 11,
              fontWeight: 700,
              color: '#6B7280',
              letterSpacing: 2,
              marginBottom: 8,
            }}>EMAIL</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="you@company.com"
              style={{
                width: '100%',
                padding: '12px 16px',
                backgroundColor: '#1F2937',
                border: '1px solid #374151',
                borderRadius: 10,
                color: '#FFFFFF',
                fontSize: 15,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: 24 }}>
            <label style={{
              display: 'block',
              fontSize: 11,
              fontWeight: 700,
              color: '#6B7280',
              letterSpacing: 2,
              marginBottom: 8,
            }}>PASSWORD</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="••••••••"
              style={{
                width: '100%',
                padding: '12px 16px',
                backgroundColor: '#1F2937',
                border: '1px solid #374151',
                borderRadius: 10,
                color: '#FFFFFF',
                fontSize: 15,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Button */}
          <button
            onClick={handleLogin}
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px 24px',
              backgroundColor: loading ? '#F9731680' : '#F97316',
              border: 'none',
              borderRadius: 10,
              color: '#0A0F1E',
              fontSize: 15,
              fontWeight: 900,
              letterSpacing: 2,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'SIGNING IN...' : 'SIGN IN'}
          </button>
        </div>

        <p style={{
          textAlign: 'center',
          color: '#374151',
          fontSize: 12,
          marginTop: 24,
        }}>
          Use your FieldOps mobile app credentials to sign in
        </p>
      </div>
    </div>
  );
}