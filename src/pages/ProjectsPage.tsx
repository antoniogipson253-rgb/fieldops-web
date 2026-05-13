import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useIsAdmin } from '../lib/useIsAdmin';

export default function ProjectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: isAdmin } = useIsAdmin();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newStatus, setNewStatus] = useState('active');
  const [creating, setCreating] = useState(false);

  const { data: projects, isLoading } = useQuery({
    queryKey: ['web-projects', showArchived, isAdmin],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      if (isAdmin) {
        // Admins see all projects
        const { data, error } = await supabase
          .from('projects')
          .select('*')
          .eq('archived', showArchived)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
      } else {
        // Members only see projects they are on
        const { data, error } = await supabase
          .from('project_members')
          .select('project:project_id (*)')
          .eq('user_id', user.id);
        if (error) throw error;
        return (data ?? [])
          .map((d: any) => d.project)
          .filter((p: any) => p && p.archived === showArchived);
      }
    },
    enabled: isAdmin !== undefined,
  });

  const { mutate: archiveProject } = useMutation({
    mutationFn: async ({ projectId, archived }: { projectId: string; archived: boolean }) => {
      const { error } = await supabase
        .from('projects')
        .update({ archived })
        .eq('id', projectId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['web-projects'] }),
  });

  const { mutate: deleteProject } = useMutation({
    mutationFn: async (projectId: string) => {
      const { error } = await supabase.from('projects').delete().eq('id', projectId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['web-projects'] }),
  });

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: project, error } = await supabase
        .from('projects')
        .insert({
          name: newName.trim(),
          description: newDescription.trim() || null,
          status: newStatus,
          created_by: user!.id,
        })
        .select()
        .single();
      if (error) throw error;

      await supabase.from('project_members').insert({
        project_id: project.id,
        user_id: user!.id,
        role: 'owner',
      });

      queryClient.invalidateQueries({ queryKey: ['web-projects'] });
      setShowCreate(false);
      setNewName('');
      setNewDescription('');
      setNewStatus('active');
      navigate(`/projects/${project.id}`);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setCreating(false);
    }
  }

  const filtered = projects?.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusColors: Record<string, string> = {
    active: '#22C55E', completed: '#6B7280', on_hold: '#F97316',
  };

  const statusLabels: Record<string, string> = {
    active: 'Active', completed: 'Completed', on_hold: 'On Hold',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', backgroundColor: '#1F2937',
    border: '1px solid #374151', borderRadius: 8, color: '#FFFFFF',
    fontSize: 14, outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ padding: 32, color: '#FFFFFF' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, marginBottom: 4 }}>
            {showArchived ? 'Archived Projects' : 'Projects'}
          </h1>
          <p style={{ color: '#6B7280', fontSize: 14, margin: 0 }}>
            {projects?.length ?? 0} {showArchived ? 'archived' : isAdmin ? 'total' : 'assigned'} projects
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {isAdmin && !showArchived && (
            <button
              onClick={() => setShowCreate(true)}
              style={{ padding: '10px 20px', backgroundColor: '#F97316', border: 'none', borderRadius: 10, color: '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}
            >
              + New Project
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setShowArchived(!showArchived)}
              style={{ padding: '10px 16px', backgroundColor: showArchived ? '#F97316' : '#111827', border: '1px solid', borderColor: showArchived ? '#F97316' : '#1F2937', borderRadius: 10, color: showArchived ? '#0A0F1E' : '#9CA3AF', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              {showArchived ? '← Active' : '📦 Archive'}
            </button>
          )}
        </div>
      </div>

      {/* Create Project Modal */}
      {showCreate && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#111827', borderRadius: 16, padding: 32, width: '100%', maxWidth: 500, border: '1px solid #1F2937' }}>
            <h3 style={{ margin: '0 0 20px 0', fontSize: 20, fontWeight: 800 }}>Create New Project</h3>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 }}>PROJECT NAME *</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. MD Anderson Building A" autoFocus style={inputStyle} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 }}>DESCRIPTION (OPTIONAL)</label>
              <textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Brief description of the project..." style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }} />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 }}>STATUS</label>
              <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}>
                <option value="active">Active</option>
                <option value="on_hold">On Hold</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setShowCreate(false); setNewName(''); setNewDescription(''); }} style={{ flex: 1, padding: '12px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 10, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleCreate} disabled={creating || !newName.trim()} style={{ flex: 2, padding: '12px', backgroundColor: creating || !newName.trim() ? '#374151' : '#F97316', border: 'none', borderRadius: 10, color: creating || !newName.trim() ? '#6B7280' : '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: creating || !newName.trim() ? 'not-allowed' : 'pointer' }}>
                {creating ? 'Creating...' : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      {!showArchived && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, maxWidth: 320, padding: '10px 16px', backgroundColor: '#111827', border: '1px solid #1F2937', borderRadius: 10, color: '#FFFFFF', fontSize: 14, outline: 'none' }}
          />
          {['all', 'active', 'on_hold', 'completed'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{ padding: '10px 16px', backgroundColor: statusFilter === s ? '#F97316' : '#111827', border: '1px solid', borderColor: statusFilter === s ? '#F97316' : '#1F2937', borderRadius: 10, color: statusFilter === s ? '#0A0F1E' : '#9CA3AF', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              {s === 'all' ? 'All' : statusLabels[s]}
            </button>
          ))}
        </div>
      )}

      {/* Projects Grid */}
      {isLoading ? (
        <div style={{ color: '#F97316' }}>Loading...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {filtered?.map((project) => (
            <div key={project.id} style={{ backgroundColor: '#111827', borderRadius: 14, padding: 20, border: '1px solid #1F2937', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                onClick={() => !showArchived && navigate(`/projects/${project.id}`)}
                style={{ cursor: showArchived ? 'default' : 'pointer' }}
                onMouseEnter={(e) => { if (!showArchived) (e.currentTarget as HTMLElement).style.opacity = '0.8'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, flex: 1, marginRight: 12 }}>{project.name}</h3>
                  <span style={{ fontSize: 11, fontWeight: 700, color: showArchived ? '#6B7280' : statusColors[project.status], backgroundColor: (showArchived ? '#6B7280' : statusColors[project.status]) + '20', padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                    {showArchived ? 'Archived' : statusLabels[project.status]}
                  </span>
                </div>
                {project.description && (
                  <p style={{ fontSize: 13, color: '#6B7280', margin: 0, lineHeight: 1.5 }}>{project.description}</p>
                )}
                <div style={{ fontSize: 12, color: '#374151', marginTop: 8 }}>
                  Created {new Date(project.created_at).toLocaleDateString()}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, borderTop: '1px solid #1F2937', paddingTop: 12 }}>
                {showArchived ? (
                  isAdmin ? (
                    <>
                      <button onClick={() => archiveProject({ projectId: project.id, archived: false })} style={{ flex: 1, padding: '8px', backgroundColor: '#22C55E20', border: '1px solid #22C55E', borderRadius: 8, color: '#22C55E', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>↩ Restore</button>
                      <button onClick={() => { if (window.confirm(`Permanently delete "${project.name}"?`)) deleteProject(project.id); }} style={{ flex: 1, padding: '8px', backgroundColor: '#EF444420', border: '1px solid #EF4444', borderRadius: 8, color: '#EF4444', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>🗑 Delete</button>
                    </>
                  ) : (
                    <span style={{ fontSize: 13, color: '#4B5563', padding: '8px' }}>Archived — contact admin to restore</span>
                  )
                ) : (
                  <>
                    <button onClick={() => navigate(`/projects/${project.id}`)} style={{ flex: 1, padding: '8px', backgroundColor: '#F97316', border: 'none', borderRadius: 8, color: '#0A0F1E', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Open →</button>
                    {isAdmin && (
                      <button onClick={() => { if (window.confirm(`Archive "${project.name}"?`)) archiveProject({ projectId: project.id, archived: true }); }} style={{ padding: '8px 12px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 8, color: '#6B7280', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>📦 Archive</button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}

          {filtered?.length === 0 && (
            <div style={{ color: '#4B5563', fontSize: 14, gridColumn: '1/-1', textAlign: 'center', padding: 40 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#FFFFFF', marginBottom: 6 }}>
                {showArchived ? 'No archived projects' : 'No projects found'}
              </div>
              <div style={{ fontSize: 14 }}>
                {showArchived ? 'Archived projects will appear here' : isAdmin ? 'Click "+ New Project" to get started' : 'You have not been added to any projects yet'}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}