import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useIsAdmin } from '../lib/useIsAdmin';
import { useIsMobile } from '../hooks/useIsMobile';
import { btn, card, colors, fonts, input, radius, tint } from '../theme';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusChip from '../components/ui/StatusChip';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import SegmentedControl from '../components/ui/SegmentedControl';
import Icon from '../components/ui/Icon';

const ROLES = ['admin', 'project_manager', 'worker'] as const;
type Role = typeof ROLES[number];

const roleLabels: Record<Role, string> = {
  admin: 'Admin',
  project_manager: 'Project Manager',
  worker: 'Worker',
};

const roleDescriptions: Record<Role, string> = {
  admin: 'Full control — manage projects, users, reports',
  project_manager: 'Can manage tasks, edit project details',
  worker: 'Views assigned tasks and invited projects only',
};

const planLabels: Record<string, string> = {
  trial: 'Free Trial',
  field: 'Field Plan',
  crew: 'Crew Plan',
  project: 'Project Plan',
  enterprise: 'Enterprise Plan',
};

function getInitials(name: string | null) {
  if (!name) return '??';
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

export default function TeamPage() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { data: isAdmin } = useIsAdmin();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('worker');
  const [inviting, setInviting] = useState(false);
  const [message, setMessage] = useState('');
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<Role>('worker');
  const [showClientInvite, setShowClientInvite] = useState(false);
  const [clientInviteEmail, setClientInviteEmail] = useState('');
  const [clientInviteProject, setClientInviteProject] = useState('');
  const [clientInviting, setClientInviting] = useState(false);
  const [clientMessage, setClientMessage] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [addToProjectClientId, setAddToProjectClientId] = useState<string | null>(null);
  const [addToProjectId, setAddToProjectId] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  const { data: companyMembers, isLoading } = useQuery({
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

  const { data: company } = useQuery({
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

  const { data: projects } = useQuery({
    queryKey: ['web-projects-for-client'],
    queryFn: async () => {
      const { data } = await supabase
        .from('projects')
        .select('id, name')
        .eq('archived', false)
        .order('name', { ascending: true });
      return data ?? [];
    },
    enabled: !!isAdmin,
  });

  const { data: allClients } = useQuery({
    queryKey: ['web-all-clients'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data: memberData } = await supabase
        .from('company_members')
        .select('company_id')
        .eq('user_id', user.id)
        .single();
      if (!memberData) return [];

      // Get all user IDs belonging to this company
      const { data: companyUsers } = await supabase
        .from('company_members')
        .select('user_id')
        .eq('company_id', memberData.company_id);
      const userIds = (companyUsers ?? []).map((u: any) => u.user_id);
      if (!userIds.length) return [];

      // Fetch all non-archived projects created by any member of this company
      const { data: companyProjects } = await supabase
        .from('projects')
        .select('id')
        .in('created_by', userIds)
        .neq('archived', true);
      if (!companyProjects?.length) return [];

      // Fetch client_projects rows without relying on PostgREST FK joins
      const { data: cpRows, error: cpError } = await supabase
        .from('client_projects')
        .select('client_id, project_id')
        .in('project_id', companyProjects.map((p: any) => p.id));

      if (cpError) throw cpError;
      if (!cpRows?.length) return [];

      // Collect unique IDs then fetch profiles and projects separately
      const clientIds = [...new Set(cpRows.map((r: any) => r.client_id))];
      const projectIds = [...new Set(cpRows.map((r: any) => r.project_id))];

      const [profilesRes, projectsRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name').in('id', clientIds),
        supabase.from('projects').select('id, name').in('id', projectIds),
      ]);

      const profileMap: Record<string, any> = Object.fromEntries(
        (profilesRes.data ?? []).map((p: any) => [p.id, p])
      );
      const projectMap: Record<string, any> = Object.fromEntries(
        (projectsRes.data ?? []).map((p: any) => [p.id, p])
      );

      return cpRows.map((row: any) => ({
        client_id: row.client_id,
        project_id: row.project_id,
        client: profileMap[row.client_id] ?? null,
        project: projectMap[row.project_id] ?? null,
      }));
    },
    enabled: !!isAdmin,
  });

  const clientsGrouped: Record<string, { id: string; name: string; projects: { id: string; name: string }[] }> = (allClients ?? []).reduce((acc: any, row: any) => {
    const cid = row.client_id;
    if (!acc[cid]) acc[cid] = { id: cid, name: (row.client as any)?.full_name ?? 'Unknown', projects: [] };
    acc[cid].projects.push({ id: row.project_id, name: (row.project as any)?.name ?? 'Unknown' });
    return acc;
  }, {});
  const clientsList = Object.values(clientsGrouped) as { id: string; name: string; projects: { id: string; name: string }[] }[];

  const totalMembers = companyMembers?.length ?? 0;
  const maxMembers = company?.max_members ?? 10;
  const seatsRemaining = maxMembers - totalMembers;
  const adminCount = companyMembers?.filter((m: any) => m.role === 'admin').length ?? 0;
  const pmCount = companyMembers?.filter((m: any) => m.role === 'project_manager').length ?? 0;
  const workerCount = companyMembers?.filter((m: any) => m.role === 'worker').length ?? 0;
  const currentPlan = company?.plan ?? 'trial';

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setMessage('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.rpc('invite_to_company', {
        p_email: inviteEmail.toLowerCase().trim(),
        p_invited_by: user!.id,
        p_role: inviteRole,
      });
      if (error) throw error;
      if (data.status === 'error') { setMessage('Error: ' + data.message); setInviting(false); return; }
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/send-invite`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
          body: JSON.stringify({ email: inviteEmail.toLowerCase().trim(), invitedBy: user!.id, companyName: company?.name ?? 'your team', role: inviteRole }),
        }
      );
      const result = await response.json();
      if (!result.success) {
        setMessage('Invite recorded but email failed: ' + result.error);
      } else {
        setMessage('Invite sent to ' + inviteEmail);
        queryClient.invalidateQueries({ queryKey: ['web-company-members'] });
      }
      setInviteEmail('');
    } catch (e: any) {
      setMessage('Error: ' + e.message);
    } finally {
      setInviting(false);
    }
  }

  async function handleClientInvite() {
    if (!clientInviteEmail.trim() || !clientInviteProject) {
      setClientMessage('Error: Please enter an email and select a project.');
      return;
    }
    setClientInviting(true);
    setClientMessage('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/send-invite`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
          body: JSON.stringify({
            email: clientInviteEmail.toLowerCase().trim(),
            invitedBy: user!.id,
            companyName: company?.name ?? 'your team',
            role: 'client',
            projectId: clientInviteProject,
            companyId: company?.id,
          }),
        }
      );
      const result = await response.json();
      if (!result.success) {
        setClientMessage('Error: ' + result.error);
      } else {
        setClientMessage('Client invite sent to ' + clientInviteEmail);
        setClientInviteEmail('');
        setClientInviteProject('');
      }
    } catch (e: any) {
      setClientMessage('Error: ' + e.message);
    } finally {
      setClientInviting(false);
    }
  }

  async function handleSaveRole(userId: string) {
    setUpdatingRole(userId);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: memberData } = await supabase
        .from('company_members')
        .select('company_id')
        .eq('user_id', user!.id)
        .single();
      const { error } = await supabase
        .from('company_members')
        .update({ role: selectedRole })
        .eq('user_id', userId)
        .eq('company_id', memberData!.company_id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['web-company-members'] });
      setEditingMember(null);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setUpdatingRole(null);
    }
  }

  async function handleRemoveClientFromProject(clientId: string, projectId: string) {
    if (!window.confirm('Remove this client from the project?')) return;
    const { error } = await supabase.from('client_projects').delete().eq('client_id', clientId).eq('project_id', projectId);
    if (error) alert(error.message);
    else queryClient.invalidateQueries({ queryKey: ['web-all-clients'] });
  }

  async function handleAddClientToProject(clientId: string) {
    if (!addToProjectId) return;
    const { error } = await supabase.from('client_projects').insert({ client_id: clientId, project_id: addToProjectId });
    if (error && error.code === '23505') alert('This client is already on that project.');
    else if (error) alert(error.message);
    else {
      queryClient.invalidateQueries({ queryKey: ['web-all-clients'] });
      setAddToProjectClientId(null);
      setAddToProjectId('');
    }
  }

  async function handleRemoveMember(userId: string, memberName: string) {
    const confirmed = window.confirm(`Remove ${memberName || 'this member'} from your team? They will lose access immediately.`);
    if (!confirmed) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: memberData } = await supabase
        .from('company_members')
        .select('company_id')
        .eq('user_id', user!.id)
        .single();
      const { error } = await supabase
        .from('company_members')
        .delete()
        .eq('user_id', userId)
        .eq('company_id', memberData!.company_id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['web-company-members'] });
      setMessage('Member removed from your team.');
    } catch (e: any) {
      alert('Error removing member: ' + e.message);
    }
  }

  const seatPct = maxMembers > 0 ? Math.min(100, Math.round((totalMembers / maxMembers) * 100)) : 0;
  const panel: React.CSSProperties = { ...card, padding: isMobile ? 16 : 24, marginBottom: 20 };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: colors.text2, marginBottom: 6 };
  const sectionHeading: React.CSSProperties = { margin: 0, fontFamily: fonts.display, fontSize: 20, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: colors.text2 };
  const avatar = (name: string) => (
    <div aria-hidden="true" style={{ width: 38, height: 38, borderRadius: 19, flexShrink: 0, backgroundColor: colors.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: colors.text }}>
      {getInitials(name)}
    </div>
  );
  const notice = (text: string) => {
    const isError = text.startsWith('Error');
    const c = isError ? colors.red : colors.green;
    return (
      <div role={isError ? 'alert' : 'status'} style={{ padding: '10px 14px', background: tint(c, 0.12), border: `1px solid ${tint(c, 0.5)}`, borderRadius: radius.control, fontSize: 13, fontWeight: 600, marginBottom: 14, color: c }}>
        {text}
      </div>
    );
  };

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: colors.text }}>
      <PageHeader
        title="Team"
        subtitle={
          <>
            {company?.name ?? ''}
            {isAdmin && <> · {totalMembers} of {maxMembers} seats used</>}
          </>
        }
        actions={isAdmin ? (
          <>
            <button onClick={() => { setShowClientInvite(!showClientInvite); setShowInvite(false); }} {...btn('secondary')}>
              <Icon name="plus" /> Invite client
            </button>
            <button
              onClick={() => { setShowInvite(!showInvite); setShowClientInvite(false); }}
              disabled={seatsRemaining <= 0}
              {...btn('primary')}
            >
              {seatsRemaining <= 0 ? 'Team full' : <><Icon name="plus" /> Invite member</>}
            </button>
          </>
        ) : undefined}
      />

      {/* Admin: seats and role counts */}
      {isAdmin && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, minmax(0, 1fr))' : '2fr repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 20 }}>
          <div style={{ ...card, borderTop: `3px solid ${colors.accent}`, padding: '14px 16px 16px', gridColumn: isMobile ? '1 / -1' : undefined }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: colors.text2 }}>Seats</span>
              <StatusChip status="active" label={planLabels[currentPlan] ?? currentPlan} />
            </div>
            <div style={{ fontFamily: fonts.display, fontSize: 40, fontWeight: 700, lineHeight: 1, margin: '8px 0 10px' }}>
              {isLoading ? <Skeleton width={90} height={36} /> : <>{totalMembers}<span style={{ color: colors.text3, fontSize: 28 }}> / {maxMembers}</span></>}
            </div>
            <div style={{ height: 8, backgroundColor: colors.track, borderRadius: 4, overflow: 'hidden' }} role="progressbar" aria-valuemin={0} aria-valuemax={maxMembers} aria-valuenow={totalMembers} aria-label="Seats used">
              <div style={{ height: '100%', width: `${seatPct}%`, backgroundColor: colors.accent, borderRadius: 4 }} />
            </div>
            <div style={{ fontSize: 12, marginTop: 6, color: seatsRemaining <= 2 ? colors.red : colors.text3, fontWeight: seatsRemaining <= 2 ? 600 : 400 }}>
              {seatsRemaining} seat{seatsRemaining !== 1 ? 's' : ''} remaining
            </div>
          </div>
          <StatCard label="Admins" tone="violet" value={isLoading ? undefined : adminCount} />
          <StatCard label="PMs" tone="blue" value={isLoading ? undefined : pmCount} />
          <StatCard label="Workers" tone="gray" value={isLoading ? undefined : workerCount} />
        </div>
      )}

      {/* Invite Member Panel */}
      {showInvite && isAdmin && (
        <div style={panel}>
          <h3 style={{ margin: '0 0 4px', fontFamily: fonts.display, fontSize: 22, fontWeight: 700, letterSpacing: '0.02em' }}>Invite team member</h3>
          <p style={{ color: colors.text3, fontSize: 13, margin: '0 0 16px' }}>
            {seatsRemaining} seat{seatsRemaining !== 1 ? 's' : ''} remaining on {planLabels[currentPlan]}
          </p>
          {message && notice(message)}
          <div style={{ marginBottom: 12 }}>
            <span style={labelStyle}>Role</span>
            <SegmentedControl
              label="Role for the new member"
              options={ROLES.filter((r) => r !== 'admin').map((r) => ({ value: r, label: roleLabels[r] }))}
              value={inviteRole}
              onChange={(r) => setInviteRole(r as Role)}
            />
          </div>
          <label htmlFor="invite-email" style={labelStyle}>Email</label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input id="invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleInvite()} placeholder="email@company.com" style={{ ...input, flex: '1 1 220px', width: 'auto' }} />
            <button onClick={handleInvite} disabled={inviting} {...btn('primary')}>
              {inviting ? 'Sending...' : 'Send invite'}
            </button>
            <button onClick={() => { setShowInvite(false); setMessage(''); }} {...btn('ghost')}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Invite Client Panel */}
      {showClientInvite && isAdmin && (
        <div style={panel}>
          <h3 style={{ margin: '0 0 4px', fontFamily: fonts.display, fontSize: 22, fontWeight: 700, letterSpacing: '0.02em' }}>Invite client</h3>
          <p style={{ color: colors.text3, fontSize: 13, margin: '0 0 16px' }}>
            Clients get read-only access to project progress and photos.
          </p>
          {clientMessage && notice(clientMessage)}
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="client-project" style={labelStyle}>Project</label>
            <select
              id="client-project"
              value={clientInviteProject}
              onChange={(e) => setClientInviteProject(e.target.value)}
              style={{ ...input, cursor: 'pointer', color: clientInviteProject ? colors.text : colors.text3 }}
            >
              <option value="">Select a project...</option>
              {projects?.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <label htmlFor="client-email" style={labelStyle}>Email</label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              id="client-email"
              type="email"
              value={clientInviteEmail}
              onChange={(e) => setClientInviteEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleClientInvite()}
              placeholder="client@company.com"
              style={{ ...input, flex: '1 1 220px', width: 'auto' }}
            />
            <button onClick={handleClientInvite} disabled={clientInviting} {...btn('primary')}>
              {clientInviting ? 'Sending...' : 'Send invite'}
            </button>
            <button onClick={() => { setShowClientInvite(false); setClientMessage(''); }} {...btn('ghost')}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Role change modal */}
      {editingMember && isAdmin && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: 16 }}>
          <div role="dialog" aria-modal="true" aria-labelledby="role-dialog-title" style={{ ...card, padding: isMobile ? 20 : 28, width: '100%', maxWidth: 440 }}>
            <h3 id="role-dialog-title" style={{ margin: '0 0 16px', fontFamily: fonts.display, fontSize: 24, fontWeight: 700, letterSpacing: '0.02em' }}>Change role</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {ROLES.map((role) => {
                const selected = selectedRole === role;
                return (
                  <button key={role} type="button" aria-pressed={selected} onClick={() => setSelectedRole(role)} style={{ padding: '12px 14px', background: selected ? tint(colors.accent, 0.12) : colors.bg, border: `1px solid ${selected ? colors.accent : colors.border}`, borderRadius: radius.control, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <StatusChip status={role} label={roleLabels[role]} />
                    <span style={{ fontSize: 13, color: colors.text2, flex: 1 }}>{roleDescriptions[role]}</span>
                    {selected && <Icon name="check" size={16} strokeWidth={3} style={{ color: colors.accent }} />}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setEditingMember(null)} {...btn('ghost', { flex: 1 })}>Cancel</button>
              <button onClick={() => handleSaveRole(editingMember)} disabled={!!updatingRole} {...btn('primary', { flex: 2 })}>
                {updatingRole ? 'Saving...' : 'Save role'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Members list */}
      {isLoading ? (
        <div style={{ ...card, padding: 0 }} role="status" aria-label="Loading team">
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderTop: i ? `1px solid ${colors.border}` : 'none' }}>
              <Skeleton width={38} height={38} radius={19} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}><Skeleton width="35%" height={14} /><Skeleton width="20%" height={11} /></div>
            </div>
          ))}
        </div>
      ) : !companyMembers?.length ? (
        <EmptyState
          title="No team members yet"
          message={isAdmin ? 'Invite your crew to start assigning tasks and tracking time.' : 'Contact your admin to add team members.'}
          actionLabel={isAdmin && seatsRemaining > 0 ? 'Invite member' : undefined}
          onAction={() => { setShowInvite(true); setShowClientInvite(false); }}
        />
      ) : (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          {companyMembers.map((member: any, i: number) => {
            const profile = member.profile as any;
            const name = profile?.full_name ?? 'Unknown';
            const role = (member.role ?? 'worker') as Role;
            return (
              <div key={member.user_id} className="fo-row" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: isMobile ? '12px 14px' : '12px 18px', borderTop: i ? `1px solid ${colors.border}` : 'none' }}>
                {avatar(name)}
                <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</div>
                  <div style={{ fontSize: 13, marginTop: 2, color: profile?.phone ? colors.text2 : colors.text3 }}>
                    {profile?.phone || 'No phone added'}
                  </div>
                </div>
                {isAdmin && <StatusChip status={role} label={roleLabels[role] ?? role} />}
                {isAdmin && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button onClick={() => { setEditingMember(member.user_id); setSelectedRole(role); }} {...btn('secondary', { padding: '7px 12px', fontSize: 13 })}>
                      Change role
                    </button>
                    {member.user_id !== currentUserId && (
                      <button
                        type="button"
                        className="fo-icon-btn fo-icon-btn-danger"
                        onClick={() => handleRemoveMember(member.user_id, profile?.full_name)}
                        aria-label={`Remove ${name} from the team`}
                        title="Remove from team"
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ===== CLIENTS SECTION ===== */}
      {isAdmin && (
        <div style={{ marginTop: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <h2 style={sectionHeading}>Clients</h2>
            {clientsList.length > 0 && <span style={{ fontSize: 13, color: colors.text3 }}>{clientsList.length} client{clientsList.length !== 1 ? 's' : ''}</span>}
          </div>
          {clientsList.length === 0 ? (
            <EmptyState
              title="No clients yet"
              message="Invite a client to give them read-only access to a project."
              actionLabel="Invite client"
              onAction={() => { setShowClientInvite(true); setShowInvite(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            />
          ) : (
            <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
              {clientsList.map((client, i) => (
                <div key={client.id} className="fo-row" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: isMobile ? '12px 14px' : '12px 18px', borderTop: i ? `1px solid ${colors.border}` : 'none' }}>
                  {avatar(client.name)}
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, overflowWrap: 'anywhere' }}>{client.name}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {client.projects.map((p) => (
                        <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: colors.text2, border: `1px solid ${colors.border}`, padding: '2px 4px 2px 10px', borderRadius: radius.pill }}>
                          {p.name}
                          <button onClick={() => handleRemoveClientFromProject(client.id, p.id)} aria-label={`Remove ${client.name} from ${p.name}`} title="Remove from project" style={{ background: 'none', border: 'none', color: colors.text3, cursor: 'pointer', padding: 2, display: 'inline-flex', borderRadius: radius.pill }}>
                            <Icon name="x" size={12} strokeWidth={2.75} />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                  <StatusChip status="client" />
                  <div>
                    {addToProjectClientId === client.id ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select aria-label="Project to add the client to" value={addToProjectId} onChange={(e) => setAddToProjectId(e.target.value)} style={{ ...input, width: 'auto', padding: '7px 10px', fontSize: 13, cursor: 'pointer' }}>
                          <option value="">Select project...</option>
                          {projects?.filter((p: any) => !client.projects.some((cp) => cp.id === p.id)).map((p: any) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <button onClick={() => handleAddClientToProject(client.id)} disabled={!addToProjectId} {...btn('primary', { padding: '7px 12px', fontSize: 13 })}>Add</button>
                        <button onClick={() => { setAddToProjectClientId(null); setAddToProjectId(''); }} {...btn('ghost', { padding: '7px 12px', fontSize: 13 })}>Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => { setAddToProjectClientId(client.id); setAddToProjectId(''); }} {...btn('secondary', { padding: '7px 12px', fontSize: 13 })}><Icon name="plus" /> Add to project</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
