import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import AuthShell, { AuthField, AuthError } from '../components/AuthShell';
import Icon from '../components/ui/Icon';

const APP_STORE_URL = 'https://apps.apple.com/app/id6767338478';
// TODO: Add Google Play button once Android app is published.
// Restore this line and the button in the `done` screen below:
// const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.fieldopspro.app';

export default function AcceptInvitePage() {
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
      <AuthShell title="Check your email" center>
        <div className="fo-auth-badge" aria-hidden="true" style={{ backgroundColor: 'rgba(249, 115, 22, 0.12)', border: '2px solid #F97316', color: '#F97316' }}>
          <Icon name="mail" size={24} strokeWidth={2} />
        </div>
        <p style={{ color: '#C7CDD6', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          To set up your account, open the <strong style={{ color: '#F9FAFB' }}>FieldOps invitation email</strong> sent by Supabase and click the secure confirmation link inside it.
        </p>
        <p style={{ color: '#C7CDD6', fontSize: 13, lineHeight: 1.5, marginTop: 16 }}>
          Once you've clicked that link, this page will let you set your password.
        </p>
      </AuthShell>
    );
  }

  // Loading state while session check runs
  if (!ready) {
    return (
      <AuthShell title="Activate your account">
        <div role="status" aria-label="Checking your invitation" style={{ width: 120, height: 3, borderRadius: 2, backgroundColor: '#1A2235', overflow: 'hidden', marginTop: 16 }}>
          <div className="fo-loading-bar" style={{ width: '40%', height: '100%', borderRadius: 2, backgroundColor: '#F97316' }} />
        </div>
      </AuthShell>
    );
  }

  // Success state — show after password is set; direct workers to the mobile app
  if (done) {
    return (
      <AuthShell title="Account activated" center>
        <div className="fo-auth-badge" aria-hidden="true" style={{ backgroundColor: 'rgba(34, 197, 94, 0.12)', border: '2px solid #22C55E', color: '#22C55E' }}>
          <Icon name="check" size={26} strokeWidth={3} />
        </div>
        <p style={{ color: '#C7CDD6', fontSize: 14, lineHeight: 1.6, margin: '0 0 24px 0' }}>
          Your account is ready. Download the <strong style={{ color: '#F9FAFB' }}>FieldOps Pro</strong> mobile app to clock in, view tasks, and get started.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" className="fo-auth-btn">
            Download on the App Store
          </a>
          {/* TODO: Add Google Play button once Android app is published.
          <a
            href="https://play.google.com/store/apps/details?id=com.fieldopspro.app"
            target="_blank"
            rel="noopener noreferrer"
            className="fo-auth-btn"
            style={{ backgroundColor: 'transparent', border: '1px solid #2A3445', color: '#F9FAFB' }}
          >
            Get it on Google Play
          </a>
          */}
        </div>
        <p style={{ color: '#C7CDD6', fontSize: 13, marginTop: 20 }}>
          Log in with your email and the password you just created.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set your password" subtitle="Create a password to activate your account and join your team.">
      <AuthField
        id="invite-password"
        label="New password"
        hint="At least 8 characters."
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={e => setPassword(e.target.value)}
      />
      <AuthField
        id="invite-confirm"
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={e => setConfirm(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleSubmit()}
      />
      <div style={{ marginTop: 8 }}>
        {error && <AuthError>{error}</AuthError>}
        <button type="button" className="fo-auth-btn" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Activating...' : 'Activate account'}
        </button>
      </div>
    </AuthShell>
  );
}
