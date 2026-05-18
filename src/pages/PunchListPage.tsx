import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useIsAdmin } from '../lib/useIsAdmin';
import { useUserRole } from '../lib/useIsAdmin';

const priorityColors: Record<string, string> = {
  high: '#E24B4A', medium: '#EF9F27', low: '#1D9E75',
};


const statusLabels: Record<string, string> = {
  open: 'Open', in_progress: 'In Progress', completed: 'Done',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', backgroundColor: '#1F2937',
  border: '1px solid #374151', borderRadius: 8, color: '#FFFFFF',
  fontSize: 14, outline: 'none', boxSizing: 'border-box',
};

export default function PunchListPage() {
  const queryClient = useQueryClient();
  const { data: isAdmin } = useIsAdmin();
  const { data: userRole } = useUserRole();
  const canCreate = isAdmin || userRole === 'project_manager';

  const [selectedProject, setSelectedProject] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', priority: 'medium',
    assigned_to: '', due_date: '', photo_url: '',
  });
  const [creating, setCreating] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['punch-list-projects'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      if (isAdmin) {
        const { data } = await supabase.from('projects').select('id, name, status').eq('archived', false).order('name');
        return data ?? [];
      } else {
        const { data } = await supabase.from('project_members').select('project:project_id(id, name, status)').eq('user_id', user.id);
        return (data ?? []).map((d: any) => d.project).filter((p: any) => p && !p.archived);
      }
    },
    enabled: isAdmin !== undefined,
  });
const { data: punchItems, isLoading: itemsLoading } = useQuery({
    queryKey: ['punch-list-items', selectedProject?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*, assignee:assigned_to(id, full_name)')
        .eq('project_id', selectedProject.id)
        .eq('is_punch_list', true)
        .eq('archived', false)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!selectedProject,
  });

  const { data: teamMembers } = useQuery({
    queryKey: ['punch-list-members', selectedProject?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('project_members')
        .select('user:user_id(id, full_name)')
        .eq('project_id', selectedProject.id);
      return (data ?? []).map((d: any) => d.user).filter(Boolean);
    },
    enabled: !!selectedProject,
  });

  const { mutate: updateStatus } = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from('tasks').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['punch-list-items', selectedProject?.id] });
    },
  });

  async function handlePhotoUpload(file: File): Promise<string | null> {
    setUploadingPhoto(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `punch-list/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('task-photos').upload(path, file);
      if (error) throw error;
      const { data } = supabase.storage.from('task-photos').getPublicUrl(path);
      return data.publicUrl;
    } catch (e) {
      return null;
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleCreate() {
    if (!form.title.trim() || !selectedProject) return;
    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      let photoUrl = form.photo_url;
      if (photoFile) {
        const uploaded = await handlePhotoUpload(photoFile);
        if (uploaded) photoUrl = uploaded;
      }
      const { error } = await supabase.from('tasks').insert({
        project_id: selectedProject.id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        priority: form.priority,
        assigned_to: form.assigned_to || null,
        due_date: form.due_date || null,
        status: 'open',
        created_by: user!.id,
        is_punch_list: true,
        punch_list_photo: photoUrl || null,
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['punch-list-items', selectedProject.id] });
      setShowCreate(false);
      setForm({ title: '', description: '', priority: 'medium', assigned_to: '', due_date: '', photo_url: '' });
      setPhotoFile(null);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setCreating(false);
    }
  }

  const openCount = punchItems?.filter((t) => t.status === 'open').length ?? 0;
  const inProgressCount = punchItems?.filter((t) => t.status === 'in_progress').length ?? 0;
  const doneCount = punchItems?.filter((t) => t.status === 'completed').length ?? 0;

  return (
    <div style={{ padding: 32, color: '#FFFFFF' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px' }}>Punch List</h1>
        <p style={{ color: '#6B7280', fontSize: 13, margin: 0 }}>
          {selectedProject ? `${selectedProject.name} — punch list items` : 'Select a project to view or manage punch list items'}
        </p>
      </div>

      {/* Project selector */}
      {!selectedProject ? (
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 12 }}>SELECT PROJECT</p>
          {projectsLoading ? (
            <div style={{ color: '#F97316', fontSize: 13 }}>Loading...</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {(projects ?? []).map((p: any) => (
                <div
                  key={p.id}
                  onClick={() => setSelectedProject(p)}
                  style={{ background: '#111827', borderRadius: 12, padding: '18px 20px', border: '0.5px solid #1F2937', cursor: 'pointer', transition: 'border-color 0.15s' }}
                  onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.borderColor = '#F97316'}
                  onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.borderColor = '#1F2937'}
                >
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: p.status === 'active' ? '#1D9E75' : '#6B7280', fontWeight: 600 }}>
                    {p.status === 'active' ? 'Active' : p.status === 'on_hold' ? 'On Hold' : 'Completed'}
                  </div>
                </div>
              ))}
              {(projects ?? []).length === 0 && (
                <div style={{ color: '#4B5563', fontSize: 13 }}>No projects found.</div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div>
          {/* Back + actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <button onClick={() => setSelectedProject(null)} style={{ background: 'transparent', border: '0.5px solid #374151', borderRadius: 8, color: '#9CA3AF', fontSize: 13, padding: '7px 14px', cursor: 'pointer' }}>
              ← All Projects
            </button>
            {canCreate && (
              <button onClick={() => setShowCreate(true)} style={{ background: '#F97316', border: 'none', borderRadius: 10, color: '#0A0F1E', fontSize: 13, fontWeight: 700, padding: '10px 20px', cursor: 'pointer' }}>
                + Add Item
              </button>
            )}
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
            <div style={{ background: '#111827', borderRadius: 12, padding: '14px 16px', borderLeft: '3px solid #6B7280', border: '0.5px solid #1F2937', borderLeftWidth: 3, borderLeftColor: '#6B7280' }}>
              <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>Open</p>
              <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{openCount}</p>
            </div>
            <div style={{ background: '#111827', borderRadius: 12, padding: '14px 16px', border: '0.5px solid #1F2937', borderLeft: '3px solid #378ADD' }}>
              <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>In Progress</p>
              <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{inProgressCount}</p>
            </div>
            <div style={{ background: '#111827', borderRadius: 12, padding: '14px 16px', border: '0.5px solid #1F2937', borderLeft: '3px solid #1D9E75' }}>
              <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>Completed</p>
              <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: doneCount > 0 ? '#1D9E75' : '#FFFFFF' }}>{doneCount}</p>
            </div>
          </div>

          {/* Items list */}
          {itemsLoading ? (
            <div style={{ color: '#F97316', fontSize: 13 }}>Loading...</div>
          ) : (punchItems ?? []).length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#4B5563' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#FFFFFF', marginBottom: 6 }}>No punch list items yet</div>
              <div style={{ fontSize: 13 }}>{canCreate ? 'Click "+ Add Item" to create the first item' : 'No punch list items have been added yet'}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(punchItems ?? []).map((item: any) => (
                <div key={item.id} style={{ background: '#111827', borderRadius: 12, border: '0.5px solid #1F2937', overflow: 'hidden', display: 'flex' }}>
                  <div style={{ width: 4, background: priorityColors[item.priority] ?? '#6B7280', flexShrink: 0 }} />
                  <div style={{ padding: '16px 18px', flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div style={{ flex: 1, marginRight: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                          <span style={{ fontSize: 15, fontWeight: 700 }}>{item.title}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#F97316', background: '#F9731620', border: '1px solid #F97316', padding: '2px 8px', borderRadius: 4, letterSpacing: 1 }}>PUNCH LIST</span>
                        </div>
                        {item.description && <p style={{ fontSize: 13, color: '#9CA3AF', margin: '0 0 8px', lineHeight: 1.5 }}>{item.description}</p>}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 600, background: priorityColors[item.priority] + '20', color: priorityColors[item.priority] }}>{item.priority}</span>
                          {item.due_date && (
                            <span style={{ fontSize: 11, color: new Date(item.due_date) < new Date() ? '#EF4444' : '#6B7280' }}>
                              Due {new Date(item.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          )}
                          {(item.assignee as any)?.full_name && (
                            <span style={{ fontSize: 11, color: '#6B7280', background: '#1F2937', padding: '2px 8px', borderRadius: 6 }}>{(item.assignee as any).full_name}</span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                        <select
                          value={item.status}
                          onChange={(e) => updateStatus({ id: item.id, status: e.target.value })}
                          style={{ padding: '5px 10px', background: '#1F2937', border: '0.5px solid #374151', borderRadius: 8, color: item.status === 'completed' ? '#1D9E75' : item.status === 'in_progress' ? '#378ADD' : '#6B7280', fontSize: 12, fontWeight: 600, cursor: 'pointer', outline: 'none' }}
                        >
                          <option value="open">Open</option>
                          <option value="in_progress">In Progress</option>
                          <option value="completed">Done</option>
                        </select>
                      </div>
                    </div>
                    {item.punch_list_photo && (
                      <img
                        src={item.punch_list_photo}
                        alt="Punch list"
                        style={{ width: 120, height: 80, objectFit: 'cover', borderRadius: 8, cursor: 'pointer', marginTop: 4 }}
                        onClick={() => window.open(item.punch_list_photo, '_blank')}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ background: '#111827', borderRadius: 16, padding: 32, width: '100%', maxWidth: 520, border: '0.5px solid #1F2937', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700 }}>Add Punch List Item</h3>
            <p style={{ color: '#6B7280', fontSize: 13, margin: '0 0 20px' }}>{selectedProject?.name}</p>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 }}>ITEM TITLE *</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Fix cracked drywall in Room 4" autoFocus style={inputStyle} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 }}>DESCRIPTION (OPTIONAL)</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Additional details..." style={{ ...inputStyle, resize: 'vertical', minHeight: 72 }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 }}>PRIORITY</label>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 }}>DUE DATE</label>
                <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} style={{ ...inputStyle, colorScheme: 'dark' }} />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 }}>ASSIGN TO</label>
              <select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">Unassigned</option>
                {(teamMembers ?? []).map((m: any) => (
                  <option key={m.id} value={m.id}>{m.full_name}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 }}>PHOTO (OPTIONAL)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                style={{ ...inputStyle, padding: '8px 14px', cursor: 'pointer' }}
              />
              {photoFile && <p style={{ fontSize: 12, color: '#1D9E75', marginTop: 6 }}>Selected: {photoFile.name}</p>}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setShowCreate(false); setForm({ title: '', description: '', priority: 'medium', assigned_to: '', due_date: '', photo_url: '' }); setPhotoFile(null); }} style={{ flex: 1, padding: '12px', background: 'transparent', border: '1px solid #374151', borderRadius: 10, color: '#6B7280', fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleCreate} disabled={creating || uploadingPhoto || !form.title.trim()} style={{ flex: 2, padding: '12px', background: creating || !form.title.trim() ? '#374151' : '#F97316', border: 'none', borderRadius: 10, color: creating || !form.title.trim() ? '#6B7280' : '#0A0F1E', fontSize: 13, fontWeight: 700, cursor: creating || !form.title.trim() ? 'not-allowed' : 'pointer' }}>
                {creating ? 'Creating...' : uploadingPhoto ? 'Uploading photo...' : 'Add to Punch List'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}