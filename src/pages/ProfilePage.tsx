import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

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
      setPhone(profile.phone ?? '');
    }
  }, [profile]);

  async function handleSave() {
    if (!fullName.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: fullName.trim(), phone: phone.trim() || null })
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


  const initials = fullName
    ? fullName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : '??';

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
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: '#1F2937',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
              fontWeight: 800,
              color: '#F97316',
              border: '2px solid #F97316',
            }}>
              {initials}
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{fullName || 'Your Name'}</div>
              <div style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>{currentUser?.email}</div>
              {company && (
                <div style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: '#F97316',
                  backgroundColor: '#F9731620',
                  padding: '2px 10px',
                  borderRadius: 20,
                  display: 'inline-block',
                  fontWeight: 600,
                }}>
                  🏢 {company.name}
                </div>
              )}
            </div>
          </div>

          {/* Form */}
          <div style={{ backgroundColor: '#111827', borderRadius: 14, padding: 24, border: '1px solid #1F2937', marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 20px 0', fontSize: 16, fontWeight: 700 }}>Edit Profile</h3>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>FULL NAME</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
                style={{ width: '100%', padding: '12px 14px', backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 10, color: '#FFFFFF', fontSize: 15, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>PHONE (OPTIONAL)</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
                style={{ width: '100%', padding: '12px 14px', backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 10, color: '#FFFFFF', fontSize: 15, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>


            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                width: '100%',
                padding: '13px',
                backgroundColor: saved ? '#22C55E' : saving ? '#374151' : '#F97316',
                border: 'none',
                borderRadius: 10,
                color: saved || !saving ? '#0A0F1E' : '#6B7280',
                fontSize: 14,
                fontWeight: 900,
                letterSpacing: 2,
                cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              {saved ? '✅ SAVED!' : saving ? 'SAVING...' : 'SAVE PROFILE'}
            </button>
          </div>

          {/* Company */}
          <div style={{ backgroundColor: '#111827', borderRadius: 14, padding: 24, border: '1px solid #1F2937', marginBottom: 20 }}>
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
          <div style={{ backgroundColor: '#111827', borderRadius: 14, padding: 24, border: '1px solid #1F2937' }}>
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