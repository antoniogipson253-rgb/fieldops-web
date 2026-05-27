import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function ClientPortalPage() {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);

  const { data: user } = useQuery({
    queryKey: ['client-user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
  });

  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['client-projects'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('client_projects')
        .select('project:project_id (id, name, status, description, created_at)')
        .eq('client_id', user.id);
      if (error) throw error;
      return (data ?? []).map((d: any) => d.project).filter(Boolean);
    },
  });

  const { data: projectData, isLoading: projectLoading } = useQuery({
    queryKey: ['client-project-detail', selectedProject],
    queryFn: async () => {
      if (!selectedProject) return null;

      const [foldersRes, photosRes, reportsRes] = await Promise.all([
        supabase
          .from('folders')
          .select('*')
          .eq('project_id', selectedProject)
          .order('created_at', { ascending: true }),
        supabase
          .from('task_photos')
          .select('*, task:task_id (title, project_id)')
          .eq('task.project_id', selectedProject)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('daily_reports')
          .select('*')
          .eq('project_id', selectedProject)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      const folders = foldersRes.data ?? [];

      const tasksRes = await supabase
        .from('tasks')
        .select('id, folder_id, status, archived')
        .eq('project_id', selectedProject);

      const tasks = tasksRes.data ?? [];

      const foldersWithProgress = folders.map((folder) => {
        const folderTasks = tasks.filter((t) => t.folder_id === folder.id);
        const completed = folderTasks.filter((t) => t.status === 'completed' || t.archived);
        const pct = folderTasks.length > 0 ? Math.round((completed.length / folderTasks.length) * 100) : 0;
        return { ...folder, task_count: folderTasks.length, completed_count: completed.length, pct };
      });

      const totalTasks = tasks.length;
      const completedTasks = tasks.filter((t) => t.status === 'completed' || t.archived).length;
      const projectProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      const photos = (photosRes.data ?? []).map((p: any) => ({
        ...p,
        url: supabase.storage.from('task-photos').getPublicUrl(p.storage_key).data.publicUrl,
      }));

      return { folders: foldersWithProgress, photos, reports: reportsRes.data ?? [], projectProgress, totalTasks, completedTasks };
    },
    enabled: !!selectedProject,
  });

  const selectedProjectData = projects?.find((p: any) => p.id === selectedProject);

  const statusColors: Record<string, string> = { active: '#22C55E', on_hold: '#F97316', completed: '#6B7280' };
  const statusLabels: Record<string, string> = { active: 'Active', on_hold: 'On Hold', completed: 'Completed' };

  function getProgressColor(pct: number) {
    if (pct === 100) return '#22C55E';
    if (pct >= 50) return '#F97316';
    return '#3B82F6';
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0A0F1E', color: '#FFFFFF' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid #1F2937', padding: '16px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: '#FFFFFF', letterSpacing: 5 }}>FIELDOPS</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 13, color: '#6B7280' }}>{user?.email}</span>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ padding: '7px 16px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 8, color: '#6B7280', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            Sign Out
          </button>
        </div>
      </div>

      <div style={{ padding: 32, maxWidth: 1100, margin: '0 auto' }}>
        {/* Project selector */}
        {!selectedProject ? (
          <>
            <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Your Projects</h1>
            <p style={{ color: '#6B7280', fontSize: 14, marginBottom: 32 }}>Select a project to view its progress and updates.</p>

            {projectsLoading ? (
              <div style={{ color: '#F97316' }}>Loading...</div>
            ) : projects?.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 0', color: '#4B5563' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#FFFFFF', marginBottom: 6 }}>No projects yet</div>
                <div style={{ fontSize: 14 }}>Your contractor hasn't added you to any projects yet.</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                {projects?.map((project: any) => (
                  <button
                    key={project.id}
                    onClick={() => setSelectedProject(project.id)}
                    style={{ backgroundColor: '#111827', borderRadius: 14, padding: 24, border: '1px solid #1F2937', textAlign: 'left', cursor: 'pointer', transition: 'border-color 0.2s' }}
                    onMouseOver={(e) => (e.currentTarget.style.borderColor = '#F97316')}
                    onMouseOut={(e) => (e.currentTarget.style.borderColor = '#1F2937')}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div style={{ fontSize: 17, fontWeight: 700, color: '#FFFFFF' }}>{project.name}</div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: statusColors[project.status], backgroundColor: statusColors[project.status] + '20', padding: '3px 10px', borderRadius: 20 }}>
                        {statusLabels[project.status]}
                      </span>
                    </div>
                    {project.description && (
                      <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 12, lineHeight: 1.5 }}>{project.description}</div>
                    )}
                    <div style={{ fontSize: 12, color: '#374151' }}>
                      Created {new Date(project.created_at).toLocaleDateString()}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Back + project header */}
            <button
              onClick={() => setSelectedProject(null)}
              style={{ backgroundColor: 'transparent', border: 'none', color: '#F97316', fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 0, marginBottom: 20 }}
            >
              ← Back to Projects
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px' }}>{selectedProjectData?.name}</h1>
                {selectedProjectData?.description && (
                  <p style={{ color: '#6B7280', fontSize: 14, margin: 0 }}>{selectedProjectData.description}</p>
                )}
              </div>
              {selectedProjectData?.status && (
                <span style={{ fontSize: 12, fontWeight: 700, color: statusColors[selectedProjectData.status], backgroundColor: statusColors[selectedProjectData.status] + '20', padding: '4px 14px', borderRadius: 20 }}>
                  {statusLabels[selectedProjectData.status]}
                </span>
              )}
            </div>

            {projectLoading ? (
              <div style={{ color: '#F97316' }}>Loading project data...</div>
            ) : projectData ? (
              <>
                {/* Progress */}
                <div style={{ backgroundColor: '#111827', borderRadius: 14, padding: 24, border: '1px solid #1F2937', marginBottom: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>Overall Progress</span>
                    <span style={{ fontSize: 24, fontWeight: 900, color: getProgressColor(projectData.projectProgress) }}>
                      {projectData.projectProgress}%
                    </span>
                  </div>
                  <div style={{ height: 10, backgroundColor: '#1F2937', borderRadius: 5, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ height: '100%', width: `${projectData.projectProgress}%`, backgroundColor: getProgressColor(projectData.projectProgress), borderRadius: 5, transition: 'width 0.5s ease' }} />
                  </div>
                  <span style={{ fontSize: 12, color: '#6B7280' }}>
                    {projectData.completedTasks} of {projectData.totalTasks} tasks completed
                  </span>
                </div>

                {/* Folders */}
                {projectData.folders.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Work Breakdown</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                      {projectData.folders.map((folder: any) => (
                        <div key={folder.id} style={{ backgroundColor: '#111827', borderRadius: 12, padding: 16, border: '1px solid #1F2937' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ fontSize: 14, fontWeight: 600 }}>📁 {folder.name}</span>
                            <span style={{ fontSize: 14, fontWeight: 700, color: getProgressColor(folder.pct) }}>{folder.pct}%</span>
                          </div>
                          <div style={{ height: 5, backgroundColor: '#1F2937', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
                            <div style={{ height: '100%', width: `${folder.pct}%`, backgroundColor: getProgressColor(folder.pct), borderRadius: 3 }} />
                          </div>
                          <span style={{ fontSize: 11, color: '#6B7280' }}>{folder.completed_count} of {folder.task_count} tasks done</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Photos */}
                {projectData.photos.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Site Photos</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                      {projectData.photos.map((photo: any) => (
                        <div
                          key={photo.id}
                          onClick={() => setViewingPhoto(photo.url)}
                          style={{ aspectRatio: '1', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', backgroundColor: '#1F2937' }}
                        >
                          <img
                            src={photo.url}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onMouseOver={(e) => (e.currentTarget.style.opacity = '0.8')}
                            onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Daily Reports */}
                {projectData.reports.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Daily Reports</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {projectData.reports.map((report: any) => (
                        <div key={report.id} style={{ backgroundColor: '#111827', borderRadius: 12, padding: 20, border: '1px solid #1F2937' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <span style={{ fontSize: 14, fontWeight: 700 }}>
                              {new Date(report.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                            </span>
                            {report.weather && (
                              <span style={{ fontSize: 12, color: '#6B7280' }}>🌤 {report.weather}</span>
                            )}
                          </div>
                          {report.work_performed && (
                            <p style={{ fontSize: 13, color: '#9CA3AF', margin: '0 0 8px', lineHeight: 1.6 }}>{report.work_performed}</p>
                          )}
                          {report.notes && (
                            <p style={{ fontSize: 13, color: '#6B7280', margin: 0, fontStyle: 'italic' }}>{report.notes}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {projectData.folders.length === 0 && projectData.photos.length === 0 && projectData.reports.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: '#4B5563' }}>
                    <div style={{ fontSize: 14 }}>No updates yet for this project.</div>
                  </div>
                )}
              </>
            ) : null}
          </>
        )}
      </div>

      {/* Photo lightbox */}
      {viewingPhoto && (
        <div
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.95)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}
          onClick={() => setViewingPhoto(null)}
        >
          <button
            onClick={() => setViewingPhoto(null)}
            style={{ position: 'absolute', top: 24, right: 24, backgroundColor: '#1F2937', border: 'none', borderRadius: 20, color: '#FFFFFF', fontSize: 16, cursor: 'pointer', width: 40, height: 40 }}
          >✕</button>
          <img
            src={viewingPhoto}
            alt=""
            style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8 }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}