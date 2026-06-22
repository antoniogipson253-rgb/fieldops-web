import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useIsAdmin } from '../lib/useIsAdmin';
import { useIsMobile } from '../hooks/useIsMobile';

const ROLES = ['admin', 'project_manager', 'worker'] as const;
type Role = typeof ROLES[number];

const roleLabels: Record<Role, string> = {
  admin: 'Admin',
  project_manager: 'Project Manager',
  worker: 'Worker',
};

const roleColors: Record<Role, string> = {
  admin: '#F97316',
  project_manager: '#378ADD',
  worker: '#6B7280',
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

  useState(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  });

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

      console.log('[allClients] client_projects raw:', cpRows, 'error:', cpError);

      if (cpError) throw cpError;
      if (!cpRows?.length) return [];

      // Collect unique IDs then fetch profiles and projects separately
      const clientIds = [...new Set(cpRows.map((r: any) => r.client_id))];
      const projectIds = [...new Set(cpRows.map((r: any) => r.project_id))];

      const [profilesRes, projectsRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name').in('id', clientIds),
        supabase.from('projects').select('id, name').in('id', projectIds),
      ]);

      console.log('[allClients] profiles:', profilesRes.data, 'projects:', projectsRes.data);

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

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: '#FFFFFF' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px' }}>Team</h1>
          <p style={{ color: '#6B7280', fontSize: 13, margin: 0 }}>
            {company?.name && <span style={{ color: '#F97316', fontWeight: 600 }}>{company.name}</span>}
            {isAdmin && (
              <span style={{ color: '#4B5563' }}> — {totalMembers}/{maxMembers} members · <span style={{ color: seatsRemaining <= 2 ? '#EF4444' : '#6B7280' }}>{seatsRemaining} seat{seatsRemaining !== 1 ? 's' : ''} remaining</span></span>
            )}
          </p>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => { setShowClientInvite(!showClientInvite); setShowInvite(false); }}
              style={{ padding: '10px 20px', backgroundColor: 'transparent', border: '1px solid #378ADD', borderRadius: 10, color: '#378ADD', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              + Invite Client
            </button>
            <button
              onClick={() => { setShowInvite(!showInvite); setShowClientInvite(false); }}
              disabled={seatsRemaining <= 0}
              style={{ padding: '10px 20px', backgroundColor: seatsRemaining <= 0 ? '#1F2937' : '#F97316', border: 'none', borderRadius: 10, color: seatsRemaining <= 0 ? '#4B5563' : '#0A0F1E', fontSize: 13, fontWeight: 700, cursor: seatsRemaining <= 0 ? 'not-allowed' : 'pointer' }}
            >
              {seatsRemaining <= 0 ? 'Team Full' : '+ Invite Member'}
            </button>
          </div>
        )}
      </div>

      {/* Admin: Plan + seat bar */}
      {isAdmin && (
        <div style={{ background: '#111827', border: '0.5px solid #1F2937', borderRadius: 12, padding: '16px 20px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ background: '#F9731620', border: '1px solid #F97316', borderRadius: 20, padding: '3px 12px', fontSize: 12, fontWeight: 700, color: '#F97316' }}>
              {planLabels[currentPlan] ?? currentPlan}
            </span>
            <span style={{ color: '#6B7280', fontSize: 13 }}>{totalMembers} of {maxMembers} seats used</span>
          </div>
          <div style={{ flex: 1, minWidth: 180, maxWidth: 280 }}>
            <div style={{ background: '#1F2937', borderRadius: 4, height: 5, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 4, width: `${Math.min((totalMembers / maxMembers) * 100, 100)}%`, background: seatsRemaining <= 2 ? '#EF4444' : '#F97316' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
            <span style={{ color: '#F97316' }}>{adminCount} Admin{adminCount !== 1 ? 's' : ''}</span>
            <span style={{ color: '#378ADD' }}>{pmCount} PM{pmCount !== 1 ? 's' : ''}</span>
            <span style={{ color: '#6B7280' }}>{workerCount} Worker{workerCount !== 1 ? 's' : ''}</span>
          </div>
        </div>
      )}

      {/* Invite Member Panel */}
      {showInvite && isAdmin && (
        <div style={{ background: '#111827', border: '0.5px solid #F97316', borderRadius: 14, padding: 24, marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Invite Team Member</h3>
          <p style={{ color: '#6B7280', fontSize: 13, margin: '0 0 16px' }}>
            {seatsRemaining} seat{seatsRemaining !== 1 ? 's' : ''} remaining on {planLabels[currentPlan]}
          </p>
          {message && (
            <div style={{ padding: '10px 14px', background: message.startsWith('Error') ? '#EF444420' : '#22C55E20', border: `1px solid ${message.startsWith('Error') ? '#EF4444' : '#22C55E'}`, borderRadius: 8, fontSize: 13, marginBottom: 14, color: message.startsWith('Error') ? '#EF4444' : '#22C55E' }}>
              {message}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {ROLES.filter((r) => r !== 'admin').map((r) => (
              <button key={r} onClick={() => setInviteRole(r)} style={{ flex: 1, padding: '8px 12px', background: inviteRole === r ? roleColors[r] + '20' : '#1F2937', border: `1px solid ${inviteRole === r ? roleColors[r] : '#374151'}`, borderRadius: 8, color: inviteRole === r ? roleColors[r] : '#6B7280', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {roleLabels[r]}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleInvite()} placeholder="email@company.com" style={{ flex: 1, padding: '10px 14px', background: '#1F2937', border: '1px solid #374151', borderRadius: 8, color: '#FFFFFF', fontSize: 14, outline: 'none' }} />
            <button onClick={handleInvite} disabled={inviting} style={{ padding: '10px 24px', background: inviting ? '#374151' : '#F97316', border: 'none', borderRadius: 8, color: inviting ? '#6B7280' : '#0A0F1E', fontSize: 13, fontWeight: 700, cursor: inviting ? 'not-allowed' : 'pointer' }}>
              {inviting ? 'Sending...' : 'Send Invite'}
            </button>
            <button onClick={() => { setShowInvite(false); setMessage(''); }} style={{ padding: '10px 16px', background: 'transparent', border: '1px solid #374151', borderRadius: 8, color: '#6B7280', fontSize: 13, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Invite Client Panel */}
      {showClientInvite && isAdmin && (
        <div style={{ background: '#111827', border: '0.5px solid #378ADD', borderRadius: 14, padding: 24, marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Invite Client</h3>
          <p style={{ color: '#6B7280', fontSize: 13, margin: '0 0 16px' }}>
            Clients get read-only access to project progress, photos, and daily reports.
          </p>
          {clientMessage && (
            <div style={{ padding: '10px 14px', background: clientMessage.startsWith('Error') ? '#EF444420' : '#22C55E20', border: `1px solid ${clientMessage.startsWith('Error') ? '#EF4444' : '#22C55E'}`, borderRadius: 8, fontSize: 13, marginBottom: 14, color: clientMessage.startsWith('Error') ? '#EF4444' : '#22C55E' }}>
              {clientMessage}
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, display: 'block', marginBottom: 6 }}>SELECT PROJECT</label>
            <select
              value={clientInviteProject}
              onChange={(e) => setClientInviteProject(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', background: '#1F2937', border: '1px solid #374151', borderRadius: 8, color: clientInviteProject ? '#FFFFFF' : '#6B7280', fontSize: 14, outline: 'none', cursor: 'pointer' }}
            >
              <option value="">Select a project...</option>
              {projects?.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              type="email"
              value={clientInviteEmail}
              onChange={(e) => setClientInviteEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleClientInvite()}
              placeholder="client@company.com"
              style={{ flex: 1, padding: '10px 14px', background: '#1F2937', border: '1px solid #374151', borderRadius: 8, color: '#FFFFFF', fontSize: 14, outline: 'none' }}
            />
            <button
              onClick={handleClientInvite}
              disabled={clientInviting}
              style={{ padding: '10px 24px', background: clientInviting ? '#374151' : '#378ADD', border: 'none', borderRadius: 8, color: clientInviting ? '#6B7280' : '#FFFFFF', fontSize: 13, fontWeight: 700, cursor: clientInviting ? 'not-allowed' : 'pointer' }}
            >
              {clientInviting ? 'Sending...' : 'Send Invite'}
            </button>
            <button
              onClick={() => { setShowClientInvite(false); setClientMessage(''); }}
              style={{ padding: '10px 16px', background: 'transparent', border: '1px solid #374151', borderRadius: 8, color: '#6B7280', fontSize: 13, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Role change modal */}
      {editingMember && isAdmin && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ background: '#111827', borderRadius: 16, padding: 32, width: '100%', maxWidth: 440, border: '0.5px solid #1F2937' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: 17, fontWeight: 700 }}>Change Role</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
              {ROLES.map((role) => (
                <button key={role} onClick={() => setSelectedRole(role)} style={{ padding: '12px 16px', background: selectedRole === role ? roleColors[role] + '20' : '#1F2937', border: `1px solid ${selectedRole === role ? roleColors[role] : '#374151'}`, borderRadius: 10, cursor: 'pointer', textAlign: 'left' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: selectedRole === role ? roleColors[role] : '#FFFFFF', marginBottom: 2 }}>{roleLabels[role]}</div>
                  <div style={{ fontSize: 12, color: '#6B7280' }}>{roleDescriptions[role]}</div>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setEditingMember(null)} style={{ flex: 1, padding: '12px', background: 'transparent', border: '1px solid #374151', borderRadius: 10, color: '#6B7280', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => handleSaveRole(editingMember)} disabled={!!updatingRole} style={{ flex: 2, padding: '12px', background: '#F97316', border: 'none', borderRadius: 10, color: '#0A0F1E', fontSize: 13, fontWeight: 700, cursor: updatingRole ? 'not-allowed' : 'pointer' }}>
                {updatingRole ? 'Saving...' : 'Save Role'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Members list */}
      {isLoading ? (
        <div style={{ color: '#F97316', fontSize: 13 }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {companyMembers?.map((member: any) => {
            const profile = member.profile as any;
            const name = profile?.full_name ?? 'Unknown';
            const role = (member.role ?? 'worker') as Role;
            return (
              <div key={member.user_id} style={{ background: '#111827', borderRadius: 12, padding: '16px 20px', border: '0.5px solid #1F2937', display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center', gap: isMobile ? 12 : 14 }}>
                {isMobile ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ width: 44, height: 44, borderRadius: 22, background: '#1F2937', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: roleColors[role] ?? '#6B7280', flexShrink: 0, border: `1.5px solid ${roleColors[role] ?? '#374151'}` }}>
                        {getInitials(name)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: profile?.phone ? 4 : 0 }}>
                          <span style={{ fontSize: 15, fontWeight: 600 }}>{name}</span>
                          {isAdmin && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: roleColors[role] ?? '#6B7280', background: (roleColors[role] ?? '#6B7280') + '20', padding: '2px 10px', borderRadius: 20 }}>
                              {roleLabels[role] ?? role}
                            </span>
                          )}
                        </div>
                        {profile?.phone && (
                          <div style={{ fontSize: 12, color: '#4B5563' }}>{profile.phone}</div>
                        )}
                      </div>
                    </div>
                    {isAdmin && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => { setEditingMember(member.user_id); setSelectedRole(role); }}
                          style={{ padding: '7px 14px', minHeight: 44, flex: 1, background: '#1F2937', border: '0.5px solid #374151', borderRadius: 8, color: '#9CA3AF', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          Change Role
                        </button>
                        {member.user_id !== currentUserId && (
                          <button
                            onClick={() => handleRemoveMember(member.user_id, profile?.full_name)}
                            style={{ padding: '7px 14px', minHeight: 44, flex: 1, background: 'transparent', border: '0.5px solid #EF4444', borderRadius: 8, color: '#EF4444', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ width: 44, height: 44, borderRadius: 22, background: '#1F2937', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: roleColors[role] ?? '#6B7280', flexShrink: 0, border: `1.5px solid ${roleColors[role] ?? '#374151'}` }}>
                      {getInitials(name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{name}</div>
                      {isAdmin && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: roleColors[role] ?? '#6B7280', background: (roleColors[role] ?? '#6B7280') + '20', padding: '2px 10px', borderRadius: 20 }}>
                          {roleLabels[role] ?? role}
                        </span>
                      )}
                      {profile?.phone && (
                        <span style={{ fontSize: 12, color: '#4B5563', marginLeft: isAdmin ? 8 : 0 }}>{profile.phone}</span>
                      )}
                    </div>
                    {isAdmin && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => { setEditingMember(member.user_id); setSelectedRole(role); }}
                          style={{ padding: '7px 14px', background: '#1F2937', border: '0.5px solid #374151', borderRadius: 8, color: '#9CA3AF', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          Change Role
                        </button>
                        {member.user_id !== currentUserId && (
                          <button
                            onClick={() => handleRemoveMember(member.user_id, profile?.full_name)}
                            style={{ padding: '7px 14px', background: 'transparent', border: '0.5px solid #EF4444', borderRadius: 8, color: '#EF4444', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {!companyMembers?.length && (
            <div style={{ textAlign: 'center', padding: 60, color: '#4B5563' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#FFFFFF', marginBottom: 6 }}>No team members yet</div>
              <div style={{ fontSize: 13 }}>{isAdmin ? 'Click "+ Invite Member" to add your crew' : 'Contact your admin to add team members'}</div>
            </div>
          )}
        </div>
      )}

      {/* ===== CLIENTS SECTION ===== */}
      {isAdmin && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '32px 0 20px' }}>
            <div style={{ flex: 1, height: 1, backgroundColor: '#1F2937' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#4B5563', letterSpacing: 2 }}>CLIENTS</span>
            <div style={{ flex: 1, height: 1, backgroundColor: '#1F2937' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {clientsList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#4B5563' }}>
                <div style={{ fontSize: 13 }}>No clients added yet. Use "Invite Client" to add one.</div>
              </div>
            ) : clientsList.map((client) => (
              <div key={client.id} style={{ background: '#111827', borderRadius: 12, padding: '16px 20px', border: '0.5px solid #1F2937', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ width: 44, height: 44, borderRadius: 22, background: '#1F293760', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: '#378ADD', flexShrink: 0, border: '1.5px solid #378ADD40' }}>
                  {getInitials(client.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{client.name}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {client.projects.map((p) => (
                      <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#6B7280', backgroundColor: '#1F2937', padding: '3px 8px', borderRadius: 20 }}>
                        {p.name}
                        <button onClick={() => handleRemoveClientFromProject(client.id, p.id)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1, marginLeft: 2 }}>✕</button>
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  {addToProjectClientId === client.id ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <select value={addToProjectId} onChange={(e) => setAddToProjectId(e.target.value)} style={{ padding: '6px 10px', background: '#1F2937', border: '1px solid #374151', borderRadius: 8, color: '#FFFFFF', fontSize: 12, cursor: 'pointer', outline: 'none' }}>
                        <option value="">Select project...</option>
                        {projects?.filter((p: any) => !client.projects.some((cp) => cp.id === p.id)).map((p: any) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <button onClick={() => handleAddClientToProject(client.id)} disabled={!addToProjectId} style={{ padding: '6px 12px', background: '#378ADD', border: 'none', borderRadius: 8, color: '#FFFFFF', fontSize: 12, fontWeight: 700, cursor: addToProjectId ? 'pointer' : 'not-allowed', opacity: addToProjectId ? 1 : 0.5 }}>Add</button>
                      <button onClick={() => { setAddToProjectClientId(null); setAddToProjectId(''); }} style={{ padding: '6px 10px', background: 'transparent', border: '1px solid #374151', borderRadius: 8, color: '#6B7280', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => { setAddToProjectClientId(client.id); setAddToProjectId(''); }} style={{ padding: '7px 14px', background: '#1F2937', border: '0.5px solid #378ADD', borderRadius: 8, color: '#378ADD', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>+ Add to Project</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}