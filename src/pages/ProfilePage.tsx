import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // change email
  const [newEmail, setNewEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailMsg, setEmailMsg] = useState('');

  // change password
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUser(user);
    });
  }, []);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['web-profile', currentUser?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!currentUser,
  });

  const { data: company } = useQuery({
    queryKey: ['web-profile-company', currentUser?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('company_members')
        .select(`company:company_id (id, name)`)
        .eq('user_id', currentUser!.id)
        .single();
      return (data as any)?.company ?? null;
    },
    enabled: !!currentUser,
  });

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name ?? '');
    }
  }, [profile]);

  async function handleSave() {
    if (!fullName.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: fullName.trim() })
        .eq('id', currentUser!.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['web-profile'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleChangeEmail() {
    if (!newEmail.trim()) return;
    setSavingEmail(true);
    setEmailMsg('');
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
      if (error) throw error;
      setEmailMsg('Confirmation sent to your new email. Check your inbox.');
      setNewEmail('');
    } catch (e: any) {
      setEmailMsg(e.message);
    } finally {
      setSavingEmail(false);
    }
  }

  async function handleChangePassword() {
    if (!newPassword || newPassword !== confirmPassword) {
      setPasswordMsg('Passwords do not match.');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMsg('Password must be at least 6 characters.');
      return;
    }
    setSavingPassword(true);
    setPasswordMsg('');
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordMsg('Password updated successfully.');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e: any) {
      setPasswordMsg(e.message);
    } finally {
      setSavingPassword(false);
    }
  }

  const initials = fullName
    ? fullName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : '??';

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 14px',
    backgroundColor: '#1F2937',
    border: '1px solid #374151',
    borderRadius: 10,
    color: '#FFFFFF',
    fontSize: 15,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    fontWeight: 700,
    color: '#6B7280',
    letterSpacing: 2,
    marginBottom: 8,
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 24,
    border: '1px solid #1F2937',
    marginBottom: 20,
  };

  return (
    <div style={{ padding: 32, color: '#FFFFFF', maxWidth: 600 }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, marginBottom: 4 }}>Profile & Settings</h1>
        <p style={{ color: '#6B7280', fontSize: 14, margin: 0 }}>Manage your account information</p>
      </div>

      {isLoading ? (
        <div style={{ color: '#F97316' }}>Loading...</div>
      ) : (
        <>
          {/* Avatar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 32 }}>
            <div style={{
              width: 72, height: 72, borderRadius: 36,
              backgroundColor: '#1F2937', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 24, fontWeight: 800, color: '#F97316',
              border: '2px solid #F97316',
            }}>
              {initials}
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{fullName || 'Your Name'}</div>
              <div style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>{currentUser?.email}</div>
              {company && (
                <div style={{ marginTop: 6, fontSize: 12, color: '#F97316', backgroundColor: '#F9731620', padding: '2px 10px', borderRadius: 20, display: 'inline-block', fontWeight: 600 }}>
                  🏢 {company.name}
                </div>
              )}
            </div>
          </div>

          {/* Edit Name */}
          <div style={cardStyle}>
            <h3 style={{ margin: '0 0 20px 0', fontSize: 16, fontWeight: 700 }}>Edit Profile</h3>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>FULL NAME</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
                style={inputStyle}
              />
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                width: '100%', padding: '13px',
                backgroundColor: saved ? '#22C55E' : saving ? '#374151' : '#F97316',
                border: 'none', borderRadius: 10,
                color: saved || !saving ? '#0A0F1E' : '#6B7280',
                fontSize: 14, fontWeight: 900, letterSpacing: 2,
                cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              {saved ? '✅ SAVED!' : saving ? 'SAVING...' : 'SAVE PROFILE'}
            </button>
          </div>

          {/* Change Email */}
          <div style={cardStyle}>
            <h3 style={{ margin: '0 0 6px 0', fontSize: 16, fontWeight: 700 }}>Change Email</h3>
            <p style={{ color: '#6B7280', fontSize: 13, margin: '0 0 16px 0' }}>
              Current: <span style={{ color: '#9CA3AF' }}>{currentUser?.email}</span>
            </p>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>NEW EMAIL</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="new@email.com"
                style={inputStyle}
              />
            </div>
            {emailMsg && (
              <p style={{ fontSize: 13, color: emailMsg.includes('sent') ? '#22C55E' : '#EF4444', margin: '0 0 12px 0' }}>
                {emailMsg}
              </p>
            )}
            <button
              onClick={handleChangeEmail}
              disabled={savingEmail || !newEmail.trim()}
              style={{
                width: '100%', padding: '13px',
                backgroundColor: savingEmail || !newEmail.trim() ? '#374151' : '#F97316',
                border: 'none', borderRadius: 10,
                color: savingEmail || !newEmail.trim() ? '#6B7280' : '#0A0F1E',
                fontSize: 14, fontWeight: 900, letterSpacing: 2,
                cursor: savingEmail || !newEmail.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {savingEmail ? 'SENDING...' : 'UPDATE EMAIL'}
            </button>
          </div>

          {/* Change Password */}
          <div style={cardStyle}>
            <h3 style={{ margin: '0 0 6px 0', fontSize: 16, fontWeight: 700 }}>Change Password</h3>
            <p style={{ color: '#6B7280', fontSize: 13, margin: '0 0 16px 0' }}>
              Choose a strong password at least 6 characters long.
            </p>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>NEW PASSWORD</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                style={inputStyle}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>CONFIRM PASSWORD</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                style={inputStyle}
              />
            </div>
            {passwordMsg && (
              <p style={{ fontSize: 13, color: passwordMsg.includes('successfully') ? '#22C55E' : '#EF4444', margin: '0 0 12px 0' }}>
                {passwordMsg}
              </p>
            )}
            <button
              onClick={handleChangePassword}
              disabled={savingPassword || !newPassword || !confirmPassword}
              style={{
                width: '100%', padding: '13px',
                backgroundColor: savingPassword || !newPassword || !confirmPassword ? '#374151' : '#F97316',
                border: 'none', borderRadius: 10,
                color: savingPassword || !newPassword || !confirmPassword ? '#6B7280' : '#0A0F1E',
                fontSize: 14, fontWeight: 900, letterSpacing: 2,
                cursor: savingPassword || !newPassword || !confirmPassword ? 'not-allowed' : 'pointer',
              }}
            >
              {savingPassword ? 'UPDATING...' : 'UPDATE PASSWORD'}
            </button>
          </div>

          {/* Company */}
          <div style={cardStyle}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 700 }}>Company</h3>
            {company ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 28 }}>🏢</span>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{company.name}</div>
                  <div style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>Your company team</div>
                </div>
              </div>
            ) : (
              <p style={{ color: '#4B5563', fontSize: 14, margin: 0 }}>
                You are not part of a company yet. Set up your company from the mobile app.
              </p>
            )}
          </div>

          {/* Sign Out */}
          <div style={cardStyle}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 700 }}>Sign Out</h3>
            <p style={{ color: '#6B7280', fontSize: 13, margin: '0 0 16px 0' }}>
              You will be returned to the login screen.
            </p>
            <button
              onClick={() => supabase.auth.signOut()}
              style={{
                padding: '10px 24px',
                backgroundColor: 'transparent',
                border: '1px solid #EF4444',
                borderRadius: 10,
                color: '#EF4444',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  );
}