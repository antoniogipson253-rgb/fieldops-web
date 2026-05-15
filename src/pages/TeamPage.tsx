import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useIsAdmin } from '../lib/useIsAdmin';

const ROLES = ['admin', 'project_manager', 'worker'] as const;
type Role = typeof ROLES[number];

const roleLabels: Record<Role, string> = {
  admin: 'Admin',
  project_manager: 'Project Manager',
  worker: 'Worker',
};

const roleColors: Record<Role, string> = {
  admin: '#F97316',
  project_manager: '#3B82F6',
  worker: '#6B7280',
};

const roleDescriptions: Record<Role, string> = {
  admin: 'Full control - manage projects, users, reports',
  project_manager: 'Can complete and unarchive tasks, edit task details',
  worker: 'Views assigned tasks and invited projects only',
};

export default function TeamPage() {
  const queryClient = useQueryClient();
  const { data: isAdmin } = useIsAdmin();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('worker');
  const [inviting, setInviting] = useState(false);
  const [message, setMessage] = useState('');
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<Role>('worker');

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
        .select('company:company_id (id, name)')
        .eq('user_id', user.id)
        .single();
      return (data as any)?.company ?? null;
    },
  });

  const totalMembers = companyMembers?.length ?? 0;
  const adminCount = companyMembers?.filter((m: any) => m.role === 'admin').length ?? 0;
  const pmCount = companyMembers?.filter((m: any) => m.role === 'project_manager').length ?? 0;
  const workerCount = companyMembers?.filter((m: any) => m.role === 'worker').length ?? 0;

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

      if (data.status === 'error') {
        setMessage('Error: ' + data.message);
        setInviting(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/send-invite`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            email: inviteEmail.toLowerCase().trim(),
            invitedBy: user!.id,
            companyName: company?.name ?? 'your team',
            role: inviteRole,
          }),
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

  async function handleSaveRole(userId: string) {
    if (selectedRole === 'admin' && adminCount >= 1) {
      alert('Admin limit reached. Your trial allows 1 admin.');
      return;
    }
    if (selectedRole === 'project_manager' && pmCount >= 4) {
      alert('Project Manager limit reached. Your trial allows 4 project managers.');
      return;
    }
    if (selectedRole === 'worker' && workerCount >= 5) {
      alert('Worker limit reached. Your trial allows 5 workers.');
      return;
    }

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

  function getInitials(name: string | null) {
    if (!name) return '??';
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  }

  return (
    <div style={{ padding: 32, color: '#FFFFFF' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, marginBottom: 4 }}>Team</h1>
          <p style={{ color: '#6B7280', fontSize: 14, margin: 0 }}>
            {company?.name && <span style={{ color: '#F97316', fontWeight: 600 }}>{company.name} - </span>}
            {totalMembers}/10 members used
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowInvite(!showInvite)}
            style={{ padding: '10px 20px', backgroundColor: '#F97316', border: 'none', borderRadius: 10, color: '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}
          >
            + Invite User
          </button>
        )}
      </div>

      {isAdmin && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { role: 'admin' as Role, used: adminCount, max: 1 },
            { role: 'project_manager' as Role, used: pmCount, max: 4 },
            { role: 'worker' as Role, used: workerCount, max: 5 },
          ].map(({ role, used, max }) => (
            <div key={role} style={{ backgroundColor: '#111827', borderRadius: 12, padding: 16, border: `1px solid ${roleColors[role]}30` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: roleColors[role], marginBottom: 4 }}>{roleLabels[role]}</div>
              <div style={{ fontSize: 11, color: '#6B7280', lineHeight: 1.5, marginBottom: 8 }}>{roleDescriptions[role]}</div>
              <div style={{ fontSize: 11, color: used >= max ? '#EF4444' : roleColors[role], fontWeight: 600 }}>
                {used}/{max} used {used >= max ? '- FULL' : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {showInvite && isAdmin && (
        <div style={{ backgroundColor: '#111827', borderRadius: 14, padding: 24, border: '1px solid #F97316', marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 700 }}>Invite Team Member</h3>
          <p style={{ color: '#6B7280', fontSize: 13, margin: '0 0 16px 0' }}>
            They will receive an email with a link to join your team.
          </p>

          {message && (
            <div style={{
              padding: '10px 14px',
              backgroundColor: message.startsWith('Error') ? '#EF444420' : '#22C55E20',
              border: `1px solid ${message.startsWith('Error') ? '#EF4444' : '#22C55E'}`,
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 14,
              color: message.startsWith('Error') ? '#EF4444' : '#22C55E',
            }}>
              {message}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {ROLES.filter(r => r !== 'admin').map((r) => (
              <button
                key={r}
                onClick={() => setInviteRole(r)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  backgroundColor: inviteRole === r ? roleColors[r] + '20' : '#1F2937',
                  border: `1px solid ${inviteRole === r ? roleColors[r] : '#374151'}`,
                  borderRadius: 8,
                  color: inviteRole === r ? roleColors[r] : '#6B7280',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {roleLabels[r]}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
              placeholder="worker@company.com"
              style={{ flex: 1, padding: '10px 14px', backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 8, color: '#FFFFFF', fontSize: 14, outline: 'none' }}
            />
            <button
              onClick={handleInvite}
              disabled={inviting}
              style={{ padding: '10px 24px', backgroundColor: inviting ? '#374151' : '#F97316', border: 'none', borderRadius: 8, color: inviting ? '#6B7280' : '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: inviting ? 'not-allowed' : 'pointer' }}
            >
              {inviting ? 'Sending...' : 'Send Invite'}
            </button>
            <button
              onClick={() => { setShowInvite(false); setMessage(''); }}
              style={{ padding: '10px 16px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 8, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {editingMember && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#111827', borderRadius: 16, padding: 32, width: '100%', maxWidth: 480, border: '1px solid #1F2937' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: 18, fontWeight: 700 }}>Change Role</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
              {ROLES.map((role) => {
                const isLimitReached =
                  (role === 'admin' && adminCount >= 1) ||
                  (role === 'project_manager' && pmCount >= 4) ||
                  (role === 'worker' && workerCount >= 5);
                return (
                  <button
                    key={role}
                    onClick={() => !isLimitReached && setSelectedRole(role)}
                    style={{
                      padding: '14px 16px',
                      backgroundColor: selectedRole === role ? roleColors[role] + '20' : '#1F2937',
                      border: '1px solid',
                      borderColor: selectedRole === role ? roleColors[role] : '#374151',
                      borderRadius: 10,
                      cursor: isLimitReached ? 'not-allowed' : 'pointer',
                      textAlign: 'left',
                      opacity: isLimitReached ? 0.5 : 1,
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 700, color: selectedRole === role ? roleColors[role] : '#FFFFFF', marginBottom: 2 }}>
                      {roleLabels[role]} {isLimitReached ? '(limit reached)' : ''}
                    </div>
                    <div style={{ fontSize: 12, color: '#6B7280' }}>{roleDescriptions[role]}</div>
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setEditingMember(null)} style={{ flex: 1, padding: '12px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 10, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={() => handleSaveRole(editingMember)}
                disabled={!!updatingRole}
                style={{ flex: 2, padding: '12px', backgroundColor: '#F97316', border: 'none', borderRadius: 10, color: '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: updatingRole ? 'not-allowed' : 'pointer' }}
              >
                {updatingRole ? 'Saving...' : 'Save Role'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div style={{ color: '#F97316' }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {companyMembers?.map((member: any) => {
            const profile = member.profile as any;
            const name = profile?.full_name ?? 'Unknown';
            const role = (member.role ?? 'worker') as Role;

            return (
              <div key={member.user_id} style={{ backgroundColor: '#111827', borderRadius: 14, padding: 20, border: '1px solid #1F2937', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#1F2937', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: roleColors[role] ?? '#6B7280', flexShrink: 0, border: `2px solid ${roleColors[role] ?? '#374151'}` }}>
                  {getInitials(name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{name}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: roleColors[role] ?? '#6B7280', backgroundColor: (roleColors[role] ?? '#6B7280') + '20', padding: '3px 10px', borderRadius: 20 }}>
                      {roleLabels[role] ?? role}
                    </span>
                    {profile?.phone && <span style={{ fontSize: 12, color: '#4B5563' }}>{profile.phone}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#374151', marginTop: 4 }}>{roleDescriptions[role] ?? ''}</div>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => { setEditingMember(member.user_id); setSelectedRole(role); }}
                    style={{ padding: '8px 16px', backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 8, color: '#9CA3AF', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Change Role
                  </button>
                )}
              </div>
            );
          })}

          {!companyMembers?.length && (
            <div style={{ textAlign: 'center', padding: 60, color: '#4B5563' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>👥</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#FFFFFF', marginBottom: 6 }}>No team members yet</div>
              <div style={{ fontSize: 14 }}>{isAdmin ? 'Click "+ Invite User" to add your crew' : 'Contact your admin to add team members'}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}