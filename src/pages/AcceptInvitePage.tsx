import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useIsMobile } from '../hooks/useIsMobile';

const APP_STORE_URL = 'https://apps.apple.com/app/id6767338478';
// TODO: Add Google Play button once Android app is published.
// Restore this line and the button in the `done` screen below:
// const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.fieldopspro.app';

export default function AcceptInvitePage() {
  const isMobile = useIsMobile();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [noSession, setNoSession] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setReady(true);
      } else {
        // No magic-link session — user probably clicked the branded email instead of the Supabase invite email
        setNoSession(true);
      }
    });
  }, []);

  async function handleSubmit() {
    if (!password || password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found.');

      const { data: invite, error: inviteError } = await supabase
        .from('invitations')
        .select('company_id, role, project_id')
        .eq('email', user.email!.toLowerCase())
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (inviteError || !invite) throw new Error('Could not find your invitation.');

      if (invite.role === 'client') {
        await supabase
          .from('profiles')
          .update({ role: 'client' })
          .eq('id', user.id);

        if (invite.project_id && invite.company_id) {
          await supabase
            .from('client_projects')
            .insert({
              client_id: user.id,
              project_id: invite.project_id,
              company_id: invite.company_id,
            });
        }

        // Clients go to the client portal
        window.location.href = '/client-portal';
        return;
      }

      // Add to company members
      const { error: memberError } = await supabase
        .from('company_members')
        .insert({ company_id: invite.company_id, user_id: user.id, role: invite.role });

      if (memberError && memberError.code !== '23505') throw memberError;

      // Add to project members if invited to a specific project
      if (invite.project_id) {
        await supabase
          .from('project_members')
          .insert({ project_id: invite.project_id, user_id: user.id, role: 'member' });
      }

      // Update profile
      await supabase
        .from('profiles')
        .update({ company_id: invite.company_id, role: invite.role })
        .eq('id', user.id);

      await supabase
        .from('invitations')
        .update({ status: 'accepted' })
        .eq('email', user.email!.toLowerCase())
        .eq('status', 'pending');

      // Show mobile app download screen — do NOT redirect workers to the web dashboard
      setDone(true);
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  }

  // Wrong-email-link state: user clicked the branded email CTA instead of the Supabase magic link
  if (noSession) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#0A0F1E', padding: 24 }}>
        <div style={{ backgroundColor: '#111827', borderRadius: 8, padding: isMobile ? 20 : 40, width: '100%', maxWidth: isMobile ? 'calc(100% - 32px)' : 420, border: '1px solid #1F2937', textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#F97316', letterSpacing: 4, marginBottom: 20, textTransform: 'uppercase' as const }}>
            FieldOps Pro
          </div>
          <div style={{ fontSize: 32, marginBottom: 16 }}>📧</div>
          <h2 style={{ color: '#FFFFFF', fontSize: 20, fontWeight: 800, margin: '0 0 12px 0' }}>
            Check Your Email
          </h2>
          <p style={{ color: '#9CA3AF', fontSize: 14, lineHeight: 1.6, margin: '0 0 0 0' }}>
            To set up your account, open the <strong style={{ color: '#F97316' }}>FieldOps invitation email</strong> sent by Supabase and click the secure confirmation link inside it.
          </p>
          <p style={{ color: '#6B7280', fontSize: 13, marginTop: 16 }}>
            Once you've clicked that link, this page will let you set your password.
          </p>
        </div>
      </div>
    );
  }

  // Loading state while session check runs
  if (!ready) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#0A0F1E', color: '#F97316', fontSize: 24, fontWeight: 'bold', letterSpacing: 4 }}>
        FIELDOPS
      </div>
    );
  }

  // Success state — show after password is set; direct workers to the mobile app
  if (done) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#0A0F1E', padding: 24 }}>
        <div style={{ backgroundColor: '#111827', borderRadius: 8, padding: isMobile ? 20 : 40, width: '100%', maxWidth: isMobile ? 'calc(100% - 32px)' : 440, border: '1px solid #1F2937', textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#F97316', letterSpacing: 4, marginBottom: 20, textTransform: 'uppercase' as const }}>
            FieldOps Pro
          </div>
          <div style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#22C55E20', border: '2px solid #22C55E', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 28 }}>
            ✓
          </div>
          <h2 style={{ color: '#FFFFFF', fontSize: 22, fontWeight: 900, margin: '0 0 10px 0', textTransform: 'uppercase' as const, letterSpacing: 1 }}>
            Account Activated!
          </h2>
          <p style={{ color: '#9CA3AF', fontSize: 14, lineHeight: 1.6, margin: '0 0 28px 0' }}>
            Your account is ready. Download the <strong style={{ color: '#F97316' }}>FieldOps Pro</strong> mobile app to clock in, view tasks, and get started.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '14px 24px', backgroundColor: '#F97316', borderRadius: 8, color: '#FFFFFF', fontSize: 14, fontWeight: 800, textDecoration: 'none', letterSpacing: 1 }}
            >
              <span style={{ fontSize: 18 }}>🍎</span> Download on the App Store
            </a>
            {/* TODO: Add Google Play button once Android app is published.
            <a
              href="https://play.google.com/store/apps/details?id=com.fieldopspro.app"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '14px 24px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 8, color: '#9CA3AF', fontSize: 14, fontWeight: 700, textDecoration: 'none', letterSpacing: 1 }}
            >
              <span style={{ fontSize: 18 }}>▶</span> Get it on Google Play
            </a>
            */}
          </div>
          <p style={{ color: '#4B5563', fontSize: 12, marginTop: 20 }}>
            Log in with your email and the password you just created.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#0A0F1E' }}>
      <div style={{ backgroundColor: '#111827', borderRadius: 8, padding: isMobile ? 20 : 40, width: '100%', maxWidth: isMobile ? 'calc(100% - 32px)' : 420, border: '1px solid #1F2937' }}>
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
            style={{ width: '100%', padding: '12px 14px', minHeight: isMobile ? 44 : undefined, backgroundColor: '#0A0F1E', border: '1px solid #1F2937', borderRadius: 6, color: '#FFFFFF', fontSize: 14, boxSizing: 'border-box' as const, outline: 'none' }}
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
            style={{ width: '100%', padding: '12px 14px', minHeight: isMobile ? 44 : undefined, backgroundColor: '#0A0F1E', border: '1px solid #1F2937', borderRadius: 6, color: '#FFFFFF', fontSize: 14, boxSizing: 'border-box' as const, outline: 'none' }}
          />
        </div>
        {error && (
          <div style={{ color: '#EF4444', fontSize: 13, marginBottom: 16 }}>{error}</div>
        )}
        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{ width: '100%', padding: '14px', minHeight: isMobile ? 44 : undefined, backgroundColor: '#F97316', border: 'none', borderRadius: 6, color: '#FFFFFF', fontSize: 13, fontWeight: 800, letterSpacing: 2, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, textTransform: 'uppercase' as const }}
        >
          {loading ? 'Activating...' : 'Activate Account'}
        </button>
      </div>
    </div>
  );
}
