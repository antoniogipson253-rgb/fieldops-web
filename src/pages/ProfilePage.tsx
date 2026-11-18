import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useUserRole } from '../lib/useIsAdmin';
import { useIsMobile } from '../hooks/useIsMobile';
import { btn, card, colors, fonts, input, radius, tint } from '../theme';
import PageHeader from '../components/ui/PageHeader';
import StatusChip from '../components/ui/StatusChip';
import Skeleton from '../components/ui/Skeleton';
import Icon from '../components/ui/Icon';

const MIN_PASSWORD_LENGTH = 8;

const planLabels: Record<string, string> = {
  trial: 'Free Trial',
  field: 'Field Plan',
  crew: 'Crew Plan',
  project: 'Project Plan',
  enterprise: 'Enterprise Plan',
};

type SectionKey = 'profile' | 'security' | 'company' | 'billing';
const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'security', label: 'Security' },
  { key: 'company', label: 'Company' },
  { key: 'billing', label: 'Billing' },
];

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: colors.text2, marginBottom: 6 };
const cardTitle: React.CSSProperties = { margin: 0, fontFamily: fonts.display, fontSize: 22, fontWeight: 700, letterSpacing: '0.02em', color: colors.text };
const cardHint: React.CSSProperties = { margin: '4px 0 0', fontSize: 13, color: colors.text3 };

function Message({ text, ok }: { text: string; ok: boolean }) {
  return (
    <div role={ok ? 'status' : 'alert'} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: radius.control, fontSize: 13, fontWeight: 600, color: ok ? colors.green : colors.red, backgroundColor: tint(ok ? colors.green : colors.red, 0.12), border: `1px solid ${tint(ok ? colors.green : colors.red, 0.5)}` }}>
      <Icon name={ok ? 'check' : 'alert'} size={14} strokeWidth={ok ? 3 : 2.25} />
      {text}
    </div>
  );
}

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { data: userRole } = useUserRole();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [activeSection, setActiveSection] = useState<SectionKey>('profile');

  // change email
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailMsg, setEmailMsg] = useState('');

  // change password
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState('');

  // billing
  const [loadingBilling, setLoadingBilling] = useState(false);
  const [billingMsg, setBillingMsg] = useState('');

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

  // Plan and seats: the same queries (and cache keys) the Team page uses.
  const { data: companyPlan } = useQuery({
    queryKey: ['web-company'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from('company_members')
        .select('company:company_id (id, name, plan, max_members, max_admins, max_project_managers, max_workers)')
        .eq('user_id', user.id)
        .single();
      return (data as any)?.company ?? null;
    },
  });

  const { data: companyMembers } = useQuery({
    queryKey: ['web-company-members'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data: memberData } = await supabase
        .from('company_members')
        .select('company_id')
        .eq('user_id', user.id)
        .single();
      if (!memberData) return [];
      const { data, error } = await supabase
        .from('company_members')
        .select('*, profile:user_id (id, full_name, role, phone, avatar_url)')
        .eq('company_id', memberData.company_id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name ?? '');
      setPhone(profile.phone ?? '');
    }
  }, [profile]);

  async function handleSave() {
    if (!fullName.trim()) {
      setProfileMsg({ text: 'Please enter your full name.', ok: false });
      return;
    }
    setSaving(true);
    setProfileMsg(null);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: fullName.trim(), phone: phone.trim() || null })
        .eq('id', currentUser!.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['web-profile'] });
      queryClient.invalidateQueries({ queryKey: ['web-company-members'] });
      setProfileMsg({ text: 'Changes saved.', ok: true });
      setTimeout(() => setProfileMsg((m) => (m?.ok ? null : m)), 3000);
    } catch (e: any) {
      setProfileMsg({ text: e.message, ok: false });
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
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordMsg(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
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

  async function handleManageBilling() {
    setLoadingBilling(true);
    setBillingMsg('');
    try {
      const { data, error } = await supabase.functions.invoke('create-billing-portal-session');
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, '_blank');
      } else {
        throw new Error('Unable to open billing portal. Please try again.');
      }
    } catch (e: any) {
      setBillingMsg(e.message ?? 'Unable to open billing portal. Please try again.');
    } finally {
      setLoadingBilling(false);
    }
  }

  function goTo(key: SectionKey) {
    setActiveSection(key);
    document.getElementById(`settings-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const displayName = fullName || profile?.full_name || '';
  const initials = displayName
    ? displayName.split(' ').filter(Boolean).map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : '?';
  const roleKey = userRole ?? 'worker';
  const seatsUsed = companyMembers?.length ?? 0;
  const maxSeats = companyPlan?.max_members ?? 10;
  const seatPct = maxSeats > 0 ? Math.min(100, Math.round((seatsUsed / maxSeats) * 100)) : 0;
  const plan = companyPlan?.plan ?? 'trial';
  const passwordTooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH;

  const sectionCard: React.CSSProperties = { ...card, padding: isMobile ? 16 : 24, marginBottom: 16, scrollMarginTop: 16 };
  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '14px 0', borderTop: `1px solid ${colors.border}` };

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: colors.text, maxWidth: 1080 }}>
      <PageHeader title="Settings & Profile" subtitle="Your account, security and company in one place" />

      {isLoading || !currentUser ? (
        <div role="status" aria-label="Loading" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Skeleton height={112} radius={12} />
          <Skeleton height={220} radius={12} />
        </div>
      ) : (
        <>
          {/* Header card */}
          <div style={{ ...card, padding: isMobile ? 16 : 24, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <div aria-hidden="true" style={{ width: 64, height: 64, borderRadius: 32, flexShrink: 0, backgroundColor: colors.surface2, boxShadow: `0 0 0 2px ${colors.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.display, fontSize: 24, fontWeight: 700, color: colors.text }}>
              {initials}
            </div>
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <div style={{ fontFamily: fonts.display, fontSize: 26, fontWeight: 700, lineHeight: 1.1, letterSpacing: '0.01em', overflowWrap: 'anywhere' }}>{displayName || 'Your name'}</div>
              <div style={{ fontSize: 14, color: colors.text2, marginTop: 4, overflowWrap: 'anywhere' }}>{currentUser?.email}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                <StatusChip status={roleKey} label={roleKey === 'project_manager' ? 'PM' : undefined} />
                {company && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: radius.pill, border: `1px solid ${colors.border}`, color: colors.text2, fontSize: 12, fontWeight: 600 }}>
                    {company.name}
                  </span>
                )}
              </div>
            </div>
            <button type="button" onClick={() => supabase.auth.signOut()} {...btn('secondary')}>
              <Icon name="logout" size={15} /> Sign out
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : '200px minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
            {/* Section menu: a side list on desktop, chips on phones */}
            {isMobile ? (
              <div role="navigation" aria-label="Settings sections" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {SECTIONS.map((s) => (
                  <button key={s.key} type="button" className={`fo-pill${activeSection === s.key ? ' is-active' : ''}`} aria-current={activeSection === s.key ? 'true' : undefined} onClick={() => goTo(s.key)}>
                    {s.label}
                  </button>
                ))}
              </div>
            ) : (
              <nav aria-label="Settings sections" style={{ position: 'sticky', top: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {SECTIONS.map((s) => (
                  <button key={s.key} type="button" className={`fo-menu-item${activeSection === s.key ? ' is-active' : ''}`} aria-current={activeSection === s.key ? 'true' : undefined} onClick={() => goTo(s.key)}>
                    {s.label}
                  </button>
                ))}
              </nav>
            )}

            <div style={{ minWidth: 0 }}>
              {/* Profile */}
              <section id="settings-profile" style={sectionCard} aria-labelledby="settings-profile-title">
                <h2 id="settings-profile-title" style={cardTitle}>Profile</h2>
                <p style={cardHint}>Your name and phone number as your team sees them.</p>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))', gap: 14, marginTop: 18 }}>
                  <div>
                    <label htmlFor="profile-name" style={labelStyle}>Full name</label>
                    <input id="profile-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your full name" style={input} autoComplete="name" />
                  </div>
                  <div>
                    <label htmlFor="profile-phone" style={labelStyle}>Phone</label>
                    <input id="profile-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-0123" style={input} autoComplete="tel" />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
                  {profileMsg && <Message text={profileMsg.text} ok={profileMsg.ok} />}
                  <button type="button" onClick={handleSave} disabled={saving} {...btn('primary')}>
                    {saving ? 'Saving...' : 'Save changes'}
                  </button>
                </div>
              </section>

              {/* Sign-in and security */}
              <section id="settings-security" style={sectionCard} aria-labelledby="settings-security-title">
                <h2 id="settings-security-title" style={cardTitle}>Sign-in and security</h2>
                <p style={cardHint}>How you sign in to FieldOps.</p>
                <div style={{ marginTop: 14 }}>
                  <div style={row}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>Email</div>
                      <div style={{ fontSize: 13, color: colors.text2, marginTop: 2, overflowWrap: 'anywhere' }}>{currentUser?.email}</div>
                    </div>
                    <button type="button" aria-expanded={showEmailForm} onClick={() => { setShowEmailForm(!showEmailForm); setEmailMsg(''); }} {...btn('secondary', { padding: '8px 14px', fontSize: 13 })}>
                      {showEmailForm ? 'Cancel' : 'Change email'}
                    </button>
                  </div>
                  {showEmailForm && (
                    <div style={{ padding: '4px 0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div>
                        <label htmlFor="new-email" style={labelStyle}>New email</label>
                        <input id="new-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="new@email.com" style={input} autoComplete="email" />
                      </div>
                      {emailMsg && <Message text={emailMsg} ok={emailMsg.includes('sent')} />}
                      <div>
                        <button type="button" onClick={handleChangeEmail} disabled={savingEmail || !newEmail.trim()} {...btn('secondary')}>
                          {savingEmail ? 'Sending...' : 'Update email'}
                        </button>
                      </div>
                    </div>
                  )}

                  <div style={row}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>Password</div>
                      <div style={{ fontSize: 13, color: colors.text2, marginTop: 2 }}>Use at least {MIN_PASSWORD_LENGTH} characters</div>
                    </div>
                    <button type="button" aria-expanded={showPasswordForm} onClick={() => { setShowPasswordForm(!showPasswordForm); setPasswordMsg(''); }} {...btn('secondary', { padding: '8px 14px', fontSize: 13 })}>
                      {showPasswordForm ? 'Cancel' : 'Change password'}
                    </button>
                  </div>
                  {showPasswordForm && (
                    <div style={{ padding: '4px 0 4px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
                        <div>
                          <label htmlFor="new-password" style={labelStyle}>New password</label>
                          <input id="new-password" type="password" minLength={MIN_PASSWORD_LENGTH} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} style={input} autoComplete="new-password" aria-describedby="password-hint" />
                          <div id="password-hint" style={{ fontSize: 12, marginTop: 6, color: passwordTooShort ? colors.amber : colors.text3 }}>
                            {passwordTooShort ? `${MIN_PASSWORD_LENGTH - newPassword.length} more character${MIN_PASSWORD_LENGTH - newPassword.length === 1 ? '' : 's'} needed` : `Minimum ${MIN_PASSWORD_LENGTH} characters`}
                          </div>
                        </div>
                        <div>
                          <label htmlFor="confirm-password" style={labelStyle}>Confirm password</label>
                          <input id="confirm-password" type="password" minLength={MIN_PASSWORD_LENGTH} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Type it again" style={input} autoComplete="new-password" />
                        </div>
                      </div>
                      {passwordMsg && <Message text={passwordMsg} ok={passwordMsg.includes('successfully')} />}
                      <div>
                        <button type="button" onClick={handleChangePassword} disabled={savingPassword || !newPassword || !confirmPassword} {...btn('secondary')}>
                          {savingPassword ? 'Updating...' : 'Update password'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* Company */}
              <section id="settings-company" style={sectionCard} aria-labelledby="settings-company-title">
                <h2 id="settings-company-title" style={cardTitle}>Company</h2>
                {company ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
                    <div aria-hidden="true" style={{ width: 48, height: 48, borderRadius: 10, flexShrink: 0, backgroundColor: colors.surface2, border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.display, fontSize: 24, fontWeight: 700 }}>
                      {(company.name ?? '?').trim().charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, overflowWrap: 'anywhere' }}>{company.name}</div>
                      <div style={{ fontSize: 13, color: colors.text2, marginTop: 2 }}>
                        {companyPlan ? `${planLabels[plan] ?? plan} · ${seatsUsed} of ${maxSeats} seats used` : <Skeleton width={160} height={12} />}
                      </div>
                      {companyPlan && (
                        <div style={{ height: 6, backgroundColor: colors.track, borderRadius: 3, overflow: 'hidden', marginTop: 8, maxWidth: 320 }} role="progressbar" aria-valuemin={0} aria-valuemax={maxSeats} aria-valuenow={seatsUsed} aria-label="Seats used">
                          <div style={{ height: '100%', width: `${seatPct}%`, backgroundColor: colors.accent, borderRadius: 3 }} />
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={() => navigate('/team')} {...btn('secondary')}>Manage team</button>
                  </div>
                ) : (
                  <p style={{ ...cardHint, marginTop: 12 }}>You are not part of a company yet. Set up your company from the mobile app.</p>
                )}
              </section>

              {/* Billing */}
              <section id="settings-billing" style={sectionCard} aria-labelledby="settings-billing-title">
                <h2 id="settings-billing-title" style={cardTitle}>Billing</h2>
                <p style={cardHint}>View invoices, update your payment method, or change your subscription.</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
                  <button type="button" onClick={handleManageBilling} disabled={loadingBilling} {...btn('secondary')}>
                    {loadingBilling ? 'Opening...' : 'Manage billing & subscription'}
                  </button>
                  {billingMsg && <Message text={billingMsg} ok={false} />}
                </div>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
