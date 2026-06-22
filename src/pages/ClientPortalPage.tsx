import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useIsMobile } from '../hooks/useIsMobile';

const statusColors: Record<string, string> = { active: '#22C55E', on_hold: '#F59E0B', completed: '#6B7280' };
const statusLabels: Record<string, string> = { active: 'Active', on_hold: 'On Hold', completed: 'Completed' };

function getProgressColor(pct: number) {
  if (pct >= 100) return '#22C55E';
  if (pct >= 50) return '#F97316';
  return '#3B82F6';
}

function getBudgetColor(pct: number) {
  if (pct >= 80) return '#EF4444';
  if (pct >= 50) return '#F97316';
  return '#22C55E';
}

function daysAgo(dateStr: string) {
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return '1 day ago';
  return `${d} days ago`;
}

function detectAttachmentType(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'invoice';
  if (['doc', 'docx', 'xls', 'xlsx'].includes(ext)) return 'document';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'photo';
  return 'other';
}

const card: React.CSSProperties = {
  backgroundColor: '#F9FAFB',
  border: '1px solid #E5E7EB',
  borderRadius: 12,
  padding: 24,
};

const inputSt: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  border: '1px solid #E5E7EB',
  borderRadius: 8,
  fontSize: 14,
  color: '#111827',
  backgroundColor: '#FFFFFF',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

export default function ClientPortalPage() {
  const queryClient = useQueryClient();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'reports' | 'photos' | 'messages'>('overview');
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyFile, setReplyFile] = useState<File | null>(null);
  const [sendingReply, setSendingReply] = useState(false);
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const isMobile = useIsMobile();
  const threadEndRef = useRef<HTMLDivElement>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeFile, setComposeFile] = useState<File | null>(null);
  const [sendingCompose, setSendingCompose] = useState(false);
  const [showEditName, setShowEditName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [savingName, setSavingName] = useState(false);

  const { data: user } = useQuery({
    queryKey: ['client-user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
  });

  const { data: profile } = useQuery({
    queryKey: ['client-profile'],
    queryFn: async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) return null;
      const { data } = await supabase.from('profiles').select('id, full_name').eq('id', u.id).single();
      return data;
    },
    enabled: !!user,
  });

  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['client-projects'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('client_projects')
        .select('project:project_id (id, name, status, description, created_at, client_photos_enabled)')
        .eq('client_id', user.id);
      if (error) throw error;
      const projs = (data ?? []).map((d: any) => d.project).filter(Boolean);
      if (!projs.length) return [];
      const { data: tasks } = await supabase
        .from('tasks')
        .select('project_id, status, archived')
        .in('project_id', projs.map((p: any) => p.id));
      return projs.map((p: any) => {
        const pt = (tasks ?? []).filter((t: any) => t.project_id === p.id);
        const done = pt.filter((t: any) => t.status === 'completed' || t.archived).length;
        return { ...p, progress: pt.length > 0 ? Math.round((done / pt.length) * 100) : 0 };
      });
    },
  });

  const { data: projectData, isLoading: projectLoading } = useQuery({
    queryKey: ['client-project-detail', selectedProject],
    queryFn: async () => {
      if (!selectedProject) return null;
      const [foldersRes, photosRes, reportsRes] = await Promise.all([
        supabase.from('folders').select('*').eq('project_id', selectedProject).order('created_at', { ascending: true }),
        supabase.from('task_photos').select('*, task:task_id (title, project_id)').eq('task.project_id', selectedProject).order('created_at', { ascending: false }).limit(20),
        supabase.from('daily_reports').select('*').eq('project_id', selectedProject).eq('visible_to_client', true).order('created_at', { ascending: false }).limit(10),
      ]);
      const folders = foldersRes.data ?? [];
      const tasksRes = await supabase.from('tasks').select('id, folder_id, status, archived').eq('project_id', selectedProject);
      const tasks = tasksRes.data ?? [];
      const foldersWithProgress = folders.map((folder) => {
        const ft = tasks.filter((t) => t.folder_id === folder.id);
        const done = ft.filter((t) => t.status === 'completed' || t.archived);
        const pct = ft.length > 0 ? Math.round((done.length / ft.length) * 100) : 0;
        return { ...folder, task_count: ft.length, completed_count: done.length, pct };
      });
      const totalTasks = tasks.length;
      const completedTasks = tasks.filter((t) => t.status === 'completed' || t.archived).length;
      const inProgressTasks = tasks.filter((t) => t.status === 'in_progress' && !t.archived).length;
      const openTasks = tasks.filter((t) => t.status === 'open' && !t.archived).length;
      const projectProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      const photos = (photosRes.data ?? []).map((p: any) => ({
        ...p,
        url: supabase.storage.from('task-photos').getPublicUrl(p.storage_key).data.publicUrl,
      }));
      const allDates = [
        ...(reportsRes.data ?? []).map((r: any) => r.created_at),
        ...(photosRes.data ?? []).map((ph: any) => ph.created_at),
      ].filter(Boolean).sort().reverse();
      return {
        folders: foldersWithProgress, photos, reports: reportsRes.data ?? [],
        projectProgress, totalTasks, completedTasks, inProgressTasks, openTasks,
        lastUpdatedAt: allDates[0] ?? null,
      };
    },
    enabled: !!selectedProject,
  });

  const { data: budget } = useQuery({
    queryKey: ['client-budget', selectedProject],
    queryFn: async () => {
      if (!selectedProject) return null;
      const [budgetRes, expensesRes] = await Promise.all([
        supabase.from('project_budgets').select('*').eq('project_id', selectedProject).maybeSingle(),
        supabase.from('project_expenses').select('amount').eq('project_id', selectedProject).eq('status', 'approved'),
      ]);
      const budgetAmount = (budgetRes.data as any)?.budget_amount ?? 0;
      if (!budgetAmount) return null;
      const spent = (expensesRes.data ?? []).reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
      const pct = Math.round((spent / budgetAmount) * 100);
      return { budgetAmount, spent, remaining: budgetAmount - spent, pct };
    },
    enabled: !!selectedProject,
  });

  const { data: messages } = useQuery({
    queryKey: ['client-messages', selectedProject],
    queryFn: async () => {
      if (!selectedProject) return [];
      const { data, error } = await supabase
        .from('client_messages')
        .select('*, sender:sender_id(full_name)')
        .eq('project_id', selectedProject)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!selectedProject,
  });

  const { data: pendingCOs } = useQuery({
    queryKey: ['client-pending-cos', selectedProject],
    queryFn: async () => {
      if (!selectedProject) return [];
      const { data } = await supabase
        .from('change_orders')
        .select('id, co_number, title, status, estimated_cost')
        .eq('project_id', selectedProject)
        .in('status', ['sent', 'under_review']);
      return data ?? [];
    },
    enabled: !!selectedProject,
  });

  const selectedProjectData = projects?.find((p: any) => p.id === selectedProject);
  const emailName = user?.email?.split('@')[0] ?? '';
  const firstName = emailName.split(/[._]/)[0];
  const emailDisplayName = firstName.charAt(0).toUpperCase() + firstName.slice(1);
  const displayName = (profile as any)?.full_name || emailDisplayName;

  const threads: { subject: string; messages: any[]; hasUnread: boolean; lastMsg: any }[] = messages
    ? Object.values(
        messages.reduce((acc: any, msg: any) => {
          const subject = msg.subject || '(No Subject)';
          if (!acc[subject]) acc[subject] = { subject, messages: [], hasUnread: false, lastMsg: msg };
          acc[subject].messages.push(msg);
          acc[subject].lastMsg = msg;
          if (!msg.read_by_client && msg.sender_type === 'admin') acc[subject].hasUnread = true;
          return acc;
        }, {})
      )
    : [];

  const hasUnreadMessages = threads.some((t) => t.hasUnread);
  const selectedMessages = selectedThread ? (threads.find((t) => t.subject === selectedThread)?.messages ?? []) : [];

  useEffect(() => {
    if (selectedThread) setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [selectedThread, selectedMessages.length]);

  async function markThreadRead(subject: string) {
    const thread = threads.find((t) => t.subject === subject);
    if (!thread) return;
    const ids = thread.messages.filter((m: any) => !m.read_by_client && m.sender_type === 'admin').map((m: any) => m.id);
    if (ids.length > 0) {
      await supabase.from('client_messages').update({ read_by_client: true }).in('id', ids);
      queryClient.invalidateQueries({ queryKey: ['client-messages', selectedProject] });
    }
  }

  function selectThread(subject: string) {
    setSelectedThread(subject);
    setMobileThreadOpen(true);
    markThreadRead(subject);
  }

  async function handleSendReply() {
    if (!replyText.trim() || !selectedThread) return;
    setSendingReply(true);
    try {
      const { data: { user: cu } } = await supabase.auth.getUser();
      let attachmentKey: string | null = null;
      let attachmentName: string | null = null;
      let attachmentType: string | null = null;
      if (replyFile) {
        attachmentName = replyFile.name;
        attachmentType = detectAttachmentType(replyFile.name);
        const ext = replyFile.name.split('.').pop() ?? 'bin';
        attachmentKey = `client-messages/${selectedProject}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('project-files').upload(attachmentKey, replyFile);
        if (upErr) throw upErr;
      }
      const { error } = await supabase.from('client_messages').insert({
        project_id: selectedProject,
        subject: selectedThread,
        message: replyText.trim(),
        sender_type: 'client',
        sender_id: cu!.id,
        read_by_client: true,
        read_by_admin: false,
        attachment_key: attachmentKey,
        attachment_name: attachmentName,
        attachment_type: attachmentType,
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['client-messages', selectedProject] });
      setReplyText('');
      setReplyFile(null);
    } catch (e: any) { alert(e.message); }
    finally { setSendingReply(false); }
  }

  async function handleSendCompose() {
    if (!composeSubject.trim() || !composeBody.trim()) return;
    setSendingCompose(true);
    try {
      const { data: { user: cu } } = await supabase.auth.getUser();
      let attachmentKey: string | null = null;
      let attachmentName: string | null = null;
      let attachmentType: string | null = null;
      if (composeFile) {
        attachmentName = composeFile.name;
        attachmentType = detectAttachmentType(composeFile.name);
        const ext = composeFile.name.split('.').pop() ?? 'bin';
        attachmentKey = `client-messages/${selectedProject}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('project-files').upload(attachmentKey, composeFile);
        if (upErr) throw upErr;
      }
      const { error } = await supabase.from('client_messages').insert({
        project_id: selectedProject,
        subject: composeSubject.trim(),
        message: composeBody.trim(),
        sender_type: 'client',
        sender_id: cu!.id,
        read_by_client: true,
        read_by_admin: false,
        attachment_key: attachmentKey,
        attachment_name: attachmentName,
        attachment_type: attachmentType,
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['client-messages', selectedProject] });
      setSelectedThread(composeSubject.trim());
      setShowCompose(false);
      setComposeSubject(''); setComposeBody(''); setComposeFile(null);
    } catch (e: any) { alert(e.message); }
    finally { setSendingCompose(false); }
  }

  async function handleSaveName() {
    if (!editNameValue.trim()) return;
    setSavingName(true);
    try {
      const { data: { user: cu } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: editNameValue.trim() })
        .eq('id', cu!.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['client-profile'] });
      setShowEditName(false);
      alert('Name updated!');
    } catch (e: any) { alert(e.message); }
    finally { setSavingName(false); }
  }

  function goBack() {
    setSelectedProject(null);
    setActiveTab('overview');
    setSelectedThread(null);
    setMobileThreadOpen(false);
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#FFFFFF', color: '#111827', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <style>{`
        .client-portal-tabs::-webkit-scrollbar { display: none; }
      `}</style>

      {/* Header */}
      <div style={{ height: 64, backgroundColor: '#FFFFFF', borderBottom: '1px solid #E5E7EB', padding: isMobile ? '0 16px' : '0 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#111827', letterSpacing: 4 }}>FIELDOPS PRO</div>
          <div style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 500, letterSpacing: 2, textTransform: 'uppercase' }}>client portal</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12 }}>
          {!isMobile && <span style={{ fontSize: 13, color: '#6B7280' }}>{user?.email}</span>}
          <button
            onClick={() => { setEditNameValue((profile as any)?.full_name ?? ''); setShowEditName(true); }}
            style={{ padding: isMobile ? '7px 12px' : '7px 16px', backgroundColor: 'transparent', border: '1px solid #E5E7EB', borderRadius: 8, color: '#6B7280', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Edit Name
          </button>
          <button onClick={() => supabase.auth.signOut()} style={{ padding: isMobile ? '7px 12px' : '7px 16px', backgroundColor: 'transparent', border: '1px solid #E5E7EB', borderRadius: 8, color: '#6B7280', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Sign Out
          </button>
        </div>
      </div>

      <div style={{ padding: isMobile ? '20px 16px' : '32px 32px', maxWidth: 1100, margin: '0 auto' }}>

        {/* ===== PROJECT LIST ===== */}
        {!selectedProject ? (
          <>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: '#111827', marginBottom: 6 }}>Welcome back, {displayName}</h1>
            <p style={{ color: '#6B7280', fontSize: 15, marginBottom: 32 }}>Here's a live view of your active projects.</p>

            {projectsLoading ? (
              <div style={{ color: '#F97316', fontSize: 14 }}>Loading your projects...</div>
            ) : !projects?.length ? (
              <div style={{ textAlign: 'center', padding: '80px 0' }}>
                <div style={{ fontSize: 56, marginBottom: 16 }}>📋</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginBottom: 8 }}>No projects yet</div>
                <div style={{ fontSize: 14, color: '#6B7280' }}>Your contractor hasn't added you to any projects yet.</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
                {projects.map((project: any) => (
                  <div
                    key={project.id}
                    onClick={() => { setSelectedProject(project.id); setActiveTab('overview'); }}
                    style={{ ...card, cursor: 'pointer', transition: 'box-shadow 0.2s, transform 0.15s', padding: 28 }}
                    onMouseOver={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 24px rgba(0,0,0,0.09)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; }}
                    onMouseOut={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; (e.currentTarget as HTMLDivElement).style.transform = 'none'; }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div style={{ fontSize: 17, fontWeight: 700, color: '#111827', flex: 1, marginRight: 12 }}>{project.name}</div>
                      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: statusColors[project.status], backgroundColor: statusColors[project.status] + '18', padding: '3px 10px', borderRadius: 20 }}>
                        {statusLabels[project.status]}
                      </span>
                    </div>
                    {project.description && (
                      <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 16, lineHeight: 1.6 }}>
                        {project.description.length > 100 ? project.description.slice(0, 100) + '…' : project.description}
                      </div>
                    )}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: '#6B7280' }}>Progress</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: getProgressColor(project.progress ?? 0) }}>{project.progress ?? 0}%</span>
                      </div>
                      <div style={{ height: 6, backgroundColor: '#E5E7EB', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${project.progress ?? 0}%`, backgroundColor: getProgressColor(project.progress ?? 0), borderRadius: 3 }} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: '#9CA3AF' }}>Created {new Date(project.created_at).toLocaleDateString()}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#F97316' }}>View Project →</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <button onClick={goBack} style={{ backgroundColor: 'transparent', border: 'none', color: '#F97316', fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 0, marginBottom: 20 }}>
              ← Back to Projects
            </button>

            {/* Project header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h1 style={{ fontSize: 26, fontWeight: 800, color: '#111827', margin: '0 0 4px' }}>{selectedProjectData?.name}</h1>
                {selectedProjectData?.description && <p style={{ color: '#6B7280', fontSize: 14, margin: 0 }}>{selectedProjectData.description}</p>}
              </div>
              {selectedProjectData?.status && (
                <span style={{ fontSize: 12, fontWeight: 700, color: statusColors[selectedProjectData.status], backgroundColor: statusColors[selectedProjectData.status] + '18', padding: '5px 14px', borderRadius: 20 }}>
                  {statusLabels[selectedProjectData.status]}
                </span>
              )}
            </div>

            {/* Change orders banner */}
            {!!pendingCOs?.length && (
              <div style={{ backgroundColor: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 10, padding: '14px 20px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span>📋</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#92400E' }}>
                    You have {pendingCOs.length} change order{pendingCOs.length > 1 ? 's' : ''} awaiting your review
                  </span>
                </div>
                <button
                  onClick={() => alert(pendingCOs.map((co: any) => `• CO #${co.co_number}: ${co.title} — ${co.status.replace('_', ' ')}${co.estimated_cost ? ` ($${co.estimated_cost.toLocaleString()})` : ''}`).join('\n'))}
                  style={{ padding: '7px 16px', backgroundColor: '#F97316', border: 'none', borderRadius: 8, color: '#FFFFFF', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                >
                  View Details
                </button>
              </div>
            )}

            {/* Tab bar */}
            <div className="client-portal-tabs" style={{ display: 'flex', borderBottom: '2px solid #E5E7EB', marginBottom: 28, gap: 0, overflowX: 'auto', scrollbarWidth: 'none' as const }}>
              {([
                { key: 'overview' as const, label: 'Overview' },
                { key: 'reports' as const, label: 'Daily Reports' },
                { key: 'photos' as const, label: 'Site Photos' },
                { key: 'messages' as const, label: 'Messages', dot: hasUnreadMessages },
              ].filter((t) => t.key !== 'photos' || !!(selectedProjectData as any)?.client_photos_enabled) as Array<{ key: typeof activeTab; label: string; dot?: boolean }>).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{ padding: '12px 20px', backgroundColor: 'transparent', border: 'none', borderBottom: `2px solid ${activeTab === tab.key ? '#F97316' : 'transparent'}`, marginBottom: -2, color: activeTab === tab.key ? '#F97316' : '#6B7280', fontSize: 14, fontWeight: activeTab === tab.key ? 700 : 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
                >
                  {tab.label}
                  {'dot' in tab && tab.dot && <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#F97316', display: 'inline-block' }} />}
                </button>
              ))}
            </div>

            {projectLoading ? (
              <div style={{ color: '#F97316', fontSize: 14, padding: '40px 0' }}>Loading project data...</div>
            ) : (
              <>
                {/* ===== OVERVIEW ===== */}
                {activeTab === 'overview' && projectData && (
                  <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 24, flexWrap: 'wrap' }}>
                    {/* Left column */}
                    <div style={{ flex: isMobile ? '1 1 auto' : '3 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>

                      {/* Progress */}
                      <div style={card}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Project Progress</span>
                          <span style={{ fontSize: 28, fontWeight: 900, color: getProgressColor(projectData.projectProgress) }}>{projectData.projectProgress}%</span>
                        </div>
                        <div style={{ height: 10, backgroundColor: '#E5E7EB', borderRadius: 5, overflow: 'hidden', marginBottom: 10 }}>
                          <div style={{ height: '100%', width: `${projectData.projectProgress}%`, backgroundColor: getProgressColor(projectData.projectProgress), borderRadius: 5, transition: 'width 0.5s ease' }} />
                        </div>
                        <span style={{ fontSize: 13, color: '#6B7280' }}>{projectData.completedTasks} of {projectData.totalTasks} tasks completed</span>
                      </div>

                      {/* Budget summary — only when budget is set */}
                      {budget && (
                        <div style={card}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 16 }}>Budget Summary</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: isMobile ? 8 : 12, marginBottom: 16 }}>
                            {[
                              { label: 'Budget', value: `$${budget.budgetAmount.toLocaleString()}`, color: '#111827' },
                              { label: 'Spent', value: `$${budget.spent.toLocaleString()}`, color: getBudgetColor(budget.pct) },
                              { label: 'Remaining', value: `$${budget.remaining.toLocaleString()}`, color: budget.remaining < 0 ? '#EF4444' : '#22C55E' },
                            ].map((item) => (
                              <div key={item.label} style={{ textAlign: 'center', backgroundColor: '#FFFFFF', borderRadius: 10, padding: isMobile ? '10px 4px' : '12px 8px', border: '1px solid #E5E7EB', minWidth: 0, overflow: 'hidden' }}>
                                <div style={{ fontSize: isMobile ? 10 : 11, color: '#9CA3AF', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>{item.label}</div>
                                <div style={{ fontSize: isMobile ? 14 : 17, fontWeight: 800, color: item.color, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.value}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ fontSize: 12, color: '#6B7280' }}>Budget used</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: getBudgetColor(budget.pct) }}>{budget.pct}%</span>
                          </div>
                          <div style={{ height: 8, backgroundColor: '#E5E7EB', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.min(budget.pct, 100)}%`, backgroundColor: getBudgetColor(budget.pct), borderRadius: 4, transition: 'width 0.5s ease' }} />
                          </div>
                        </div>
                      )}

                      {/* Work breakdown */}
                      {projectData.folders.length > 0 && (
                        <div style={card}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 16 }}>Work Breakdown</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {projectData.folders.map((folder: any) => (
                              <div key={folder.id}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                  <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>📁 {folder.name}</span>
                                  <span style={{ fontSize: 13, fontWeight: 700, color: getProgressColor(folder.pct) }}>{folder.pct}%</span>
                                </div>
                                <div style={{ height: 5, backgroundColor: '#E5E7EB', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                                  <div style={{ height: '100%', width: `${folder.pct}%`, backgroundColor: getProgressColor(folder.pct), borderRadius: 3 }} />
                                </div>
                                <span style={{ fontSize: 11, color: '#9CA3AF' }}>{folder.completed_count} of {folder.task_count} tasks done</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right column */}
                    <div style={{ flex: isMobile ? '1 1 auto' : '2 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>

                      {/* Project details */}
                      <div style={card}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 16 }}>Project Details</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                          {[
                            { label: 'Status', value: statusLabels[selectedProjectData?.status], valueColor: statusColors[selectedProjectData?.status] },
                            { label: 'Created', value: new Date(selectedProjectData?.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), valueColor: '#111827' },
                            ...(projectData.lastUpdatedAt ? [{ label: 'Last Updated', value: daysAgo(projectData.lastUpdatedAt), valueColor: '#111827' }] : []),
                          ].map((item, i, arr) => (
                            <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: i < arr.length - 1 ? '1px solid #E5E7EB' : 'none' }}>
                              <span style={{ fontSize: 13, color: '#6B7280' }}>{item.label}</span>
                              <span style={{ fontSize: 13, fontWeight: 700, color: item.valueColor }}>{item.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Task summary */}
                      <div style={card}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 16 }}>Task Summary</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          {[
                            { label: 'Total', value: projectData.totalTasks, color: '#111827' },
                            { label: 'Completed', value: projectData.completedTasks, color: '#22C55E' },
                            { label: 'In Progress', value: projectData.inProgressTasks, color: '#F97316' },
                            { label: 'Open', value: projectData.openTasks, color: '#6B7280' },
                          ].map((s) => (
                            <div key={s.label} style={{ backgroundColor: '#FFFFFF', borderRadius: 10, padding: isMobile ? '12px 10px' : '14px 12px', border: '1px solid #E5E7EB', textAlign: 'center', minWidth: 0 }}>
                              <div style={{ fontSize: isMobile ? 22 : 26, fontWeight: 900, color: s.color, marginBottom: 4 }}>{s.value}</div>
                              <div style={{ fontSize: isMobile ? 10 : 11, color: '#9CA3AF', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>{s.label}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ===== DAILY REPORTS ===== */}
                {activeTab === 'reports' && (
                  !projectData?.reports.length ? (
                    <div style={{ ...card, textAlign: 'center', padding: '60px 0' }}>
                      <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 8 }}>No daily reports submitted yet</div>
                      <div style={{ fontSize: 14, color: '#6B7280' }}>Your contractor will submit daily updates here.</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {projectData.reports.map((report: any) => (
                        <div key={report.id} style={isMobile ? { ...card, padding: 16 } : card}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>
                              {new Date(report.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                            </span>
                            {report.weather && <span style={{ fontSize: 13, color: '#6B7280' }}>🌤 {report.weather}</span>}
                          </div>
                          {report.work_performed && <p style={{ fontSize: 14, color: '#374151', margin: '0 0 10px', lineHeight: 1.7 }}>{report.work_performed}</p>}
                          {report.notes && <p style={{ fontSize: 13, color: '#6B7280', margin: 0, fontStyle: 'italic', lineHeight: 1.6 }}>{report.notes}</p>}
                        </div>
                      ))}
                    </div>
                  )
                )}

                {/* ===== SITE PHOTOS ===== */}
                {activeTab === 'photos' && (
                  !projectData?.photos.length ? (
                    <div style={{ ...card, textAlign: 'center', padding: '60px 0' }}>
                      <div style={{ fontSize: 48, marginBottom: 12 }}>📸</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 8 }}>No site photos yet</div>
                      <div style={{ fontSize: 14, color: '#6B7280' }}>Photos taken during work will appear here.</div>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                      {projectData.photos.map((photo: any) => (
                        <div key={photo.id} onClick={() => setViewingPhoto(photo.url)} style={{ aspectRatio: '1', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', backgroundColor: '#F3F4F6', border: '1px solid #E5E7EB' }}>
                          <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'opacity 0.15s' }} onMouseOver={(e) => ((e.target as HTMLImageElement).style.opacity = '0.8')} onMouseOut={(e) => ((e.target as HTMLImageElement).style.opacity = '1')} />
                        </div>
                      ))}
                    </div>
                  )
                )}

                {/* ===== MESSAGES ===== */}
                {activeTab === 'messages' && (
                    <div style={{ ...card, padding: 0, display: 'flex', minHeight: 520, overflow: 'hidden' }}>
                      {/* Thread list */}
                      {(!isMobile || !mobileThreadOpen) && (
                        <div style={{ width: isMobile ? '100%' : '30%', borderRight: isMobile ? 'none' : '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                          <div style={{ padding: '14px 16px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Conversations</span>
                            <button onClick={() => setShowCompose(true)} style={{ padding: '5px 12px', backgroundColor: '#F97316', border: 'none', borderRadius: 6, color: '#FFFFFF', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>+ New</button>
                          </div>
                          <div style={{ overflowY: 'auto', flex: 1 }}>
                            {!threads.length && (
                              <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                                <div style={{ fontSize: 28, marginBottom: 8 }}>✉️</div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>No conversations yet</div>
                                <div style={{ fontSize: 12, color: '#9CA3AF' }}>Tap "+ New" to start one.</div>
                              </div>
                            )}
                            {threads.map((thread) => {
                              const isSelected = !isMobile && selectedThread === thread.subject;
                              const lastMsg = thread.lastMsg;
                              const preview = lastMsg?.message?.slice(0, 55) ?? '';
                              const senderName = (lastMsg?.sender as any)?.full_name ?? (lastMsg?.sender_type === 'client' ? 'You' : 'Contractor');
                              return (
                                <div key={thread.subject} onClick={() => selectThread(thread.subject)} style={{ padding: '14px 16px', cursor: 'pointer', borderBottom: '1px solid #E5E7EB', backgroundColor: isSelected ? '#FFF7ED' : '#FFFFFF', transition: 'background 0.1s' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: isSelected ? '#F97316' : '#111827', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>{thread.subject}</span>
                                    {thread.hasUnread && <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#F97316', flexShrink: 0 }} />}
                                  </div>
                                  <div style={{ fontSize: 12, color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>{preview || '—'}</div>
                                  <div style={{ fontSize: 11, color: '#9CA3AF' }}>{senderName} · {lastMsg?.created_at ? new Date(lastMsg.created_at).toLocaleDateString() : ''}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Thread detail */}
                      {(!isMobile || mobileThreadOpen) && (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          {!selectedThread ? (
                            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#9CA3AF', fontSize: 14 }}>
                              Select a conversation to view messages
                            </div>
                          ) : (
                            <>
                              <div style={{ padding: '14px 20px', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 12 }}>
                                {isMobile && (
                                  <button onClick={() => setMobileThreadOpen(false)} style={{ backgroundColor: 'transparent', border: 'none', color: '#F97316', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}>←</button>
                                )}
                                <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{selectedThread}</span>
                                <span style={{ fontSize: 12, color: '#9CA3AF' }}>{selectedMessages.length} message{selectedMessages.length !== 1 ? 's' : ''}</span>
                              </div>

                              <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {selectedMessages.map((msg: any) => {
                                  const isClient = msg.sender_type === 'client';
                                  const senderName = isClient ? 'You' : ((msg.sender as any)?.full_name ?? 'Contractor');
                                  const attachmentUrl = msg.attachment_key
                                    ? `${process.env.REACT_APP_SUPABASE_URL}/storage/v1/object/public/project-files/${msg.attachment_key}`
                                    : null;
                                  const lastMsg = selectedMessages[selectedMessages.length - 1];
                                  const isLastMsg = msg.id === lastMsg?.id;
                                  return (
                                    <div key={msg.id}>
                                      <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 10, padding: 16 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{senderName}</span>
                                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, backgroundColor: isClient ? '#EFF6FF' : '#FFF7ED', color: isClient ? '#3B82F6' : '#F97316' }}>
                                              {isClient ? 'CLIENT' : 'CONTRACTOR'}
                                            </span>
                                          </div>
                                          <span style={{ fontSize: 11, color: '#9CA3AF' }}>{new Date(msg.created_at).toLocaleString()}</span>
                                        </div>
                                        <p style={{ margin: 0, fontSize: 14, color: '#374151', lineHeight: 1.7 }}>{msg.message}</p>
                                        {attachmentUrl && msg.attachment_name && (
                                          <a href={attachmentUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 12, padding: '8px 14px', backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, textDecoration: 'none', color: '#6B7280', fontSize: 12 }}>
                                            📎 {msg.attachment_name}
                                            {msg.attachment_type && <span style={{ fontSize: 10, backgroundColor: '#E5E7EB', padding: '2px 6px', borderRadius: 4 }}>{msg.attachment_type}</span>}
                                          </a>
                                        )}
                                      </div>
                                      {/* Read receipt (client messages only) */}
                                      {isClient && (
                                        <div style={{ textAlign: 'right', marginTop: 4, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
                                          <span style={{ fontSize: 11, color: msg.read_by_admin ? '#22C55E' : '#9CA3AF', fontWeight: 500 }}>
                                            {msg.read_by_admin ? '✓ Read' : 'Sent'}
                                          </span>
                                          {isLastMsg && !msg.read_by_admin && (
                                            <span style={{ fontSize: 11, color: '#9CA3AF' }}>· Your contractor has been notified</span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                                <div ref={threadEndRef} />
                              </div>

                              {/* Reply box */}
                              <div style={{ padding: '16px 20px', borderTop: '1px solid #E5E7EB' }}>
                                {replyFile && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '8px 12px', backgroundColor: '#F9FAFB', borderRadius: 8, border: '1px solid #E5E7EB' }}>
                                    <span style={{ fontSize: 12, color: '#6B7280', flex: 1 }}>📎 {replyFile.name}</span>
                                    <button onClick={() => setReplyFile(null)} style={{ backgroundColor: 'transparent', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 14 }}>✕</button>
                                  </div>
                                )}
                                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                                  <label style={{ cursor: 'pointer', padding: '10px 13px', border: '1px solid #E5E7EB', borderRadius: 8, color: '#6B7280', fontSize: 16, backgroundColor: '#F9FAFB', flexShrink: 0 }} title="Attach file">
                                    📎
                                    <input type="file" accept="image/*,application/pdf" onChange={(e) => setReplyFile(e.target.files?.[0] ?? null)} style={{ display: 'none' }} />
                                  </label>
                                  <textarea
                                    value={replyText}
                                    onChange={(e) => setReplyText(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSendReply(); }}
                                    placeholder="Type a reply… (Ctrl+Enter to send)"
                                    rows={3}
                                    style={{ ...inputSt, resize: 'none', flex: 1 }}
                                  />
                                  <button
                                    onClick={handleSendReply}
                                    disabled={sendingReply || !replyText.trim()}
                                    style={{ padding: '10px 20px', backgroundColor: replyText.trim() ? '#F97316' : '#E5E7EB', border: 'none', borderRadius: 8, color: replyText.trim() ? '#FFFFFF' : '#9CA3AF', fontSize: 14, fontWeight: 700, cursor: replyText.trim() ? 'pointer' : 'not-allowed', minWidth: 72, flexShrink: 0, alignSelf: 'stretch' }}
                                  >
                                    {sendingReply ? '…' : 'Send'}
                                  </button>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Compose modal */}
      {showCompose && (
        <div
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000, padding: 20 }}
          onClick={() => { setShowCompose(false); setComposeSubject(''); setComposeBody(''); setComposeFile(null); }}
        >
          <div style={{ backgroundColor: '#FFFFFF', borderRadius: 14, padding: isMobile ? 20 : 28, width: '100%', maxWidth: isMobile ? 'calc(100% - 32px)' : 540, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#111827' }}>New Message</h3>
              <button onClick={() => { setShowCompose(false); setComposeSubject(''); setComposeBody(''); setComposeFile(null); }} style={{ backgroundColor: 'transparent', border: '1px solid #E5E7EB', borderRadius: 8, color: '#6B7280', fontSize: 14, cursor: 'pointer', padding: '4px 10px' }}>✕</button>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>Subject</label>
              <input type="text" value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} placeholder="Enter subject..." style={inputSt} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>Message</label>
              <textarea value={composeBody} onChange={(e) => setComposeBody(e.target.value)} placeholder="Type your message..." style={{ ...inputSt, resize: 'vertical' as const, minHeight: 120 }} />
            </div>
            {composeFile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px', backgroundColor: '#F9FAFB', borderRadius: 8, border: '1px solid #E5E7EB' }}>
                <span style={{ fontSize: 12, color: '#6B7280', flex: 1 }}>📎 {composeFile.name}</span>
                <button onClick={() => setComposeFile(null)} style={{ backgroundColor: 'transparent', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 14 }}>✕</button>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ cursor: 'pointer', padding: '9px 14px', border: '1px solid #E5E7EB', borderRadius: 8, color: '#6B7280', fontSize: 13, backgroundColor: '#F9FAFB' }}>
                📎 Attach file
                <input type="file" style={{ display: 'none' }} onChange={(e) => setComposeFile(e.target.files?.[0] ?? null)} />
              </label>
              <button
                onClick={handleSendCompose}
                disabled={!composeSubject.trim() || !composeBody.trim() || sendingCompose}
                style={{ padding: '10px 24px', backgroundColor: (!composeSubject.trim() || !composeBody.trim() || sendingCompose) ? '#E5E7EB' : '#F97316', border: 'none', borderRadius: 8, color: (!composeSubject.trim() || !composeBody.trim() || sendingCompose) ? '#9CA3AF' : '#FFFFFF', fontSize: 14, fontWeight: 700, cursor: (!composeSubject.trim() || !composeBody.trim() || sendingCompose) ? 'not-allowed' : 'pointer' }}
              >
                {sendingCompose ? 'Sending...' : 'Send Message'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Name modal */}
      {showEditName && (
        <div
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000, padding: 20 }}
          onClick={() => setShowEditName(false)}
        >
          <div style={{ backgroundColor: '#FFFFFF', borderRadius: 14, padding: isMobile ? 20 : 28, width: '100%', maxWidth: isMobile ? 'calc(100% - 32px)' : 400, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#111827' }}>Edit Name</h3>
              <button onClick={() => setShowEditName(false)} style={{ backgroundColor: 'transparent', border: '1px solid #E5E7EB', borderRadius: 8, color: '#6B7280', fontSize: 14, cursor: 'pointer', padding: '4px 10px' }}>✕</button>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>Full Name</label>
              <input
                type="text"
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && editNameValue.trim()) handleSaveName(); }}
                placeholder="Enter your name..."
                autoFocus
                style={inputSt}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowEditName(false)} style={{ padding: '10px 20px', backgroundColor: 'transparent', border: '1px solid #E5E7EB', borderRadius: 8, color: '#6B7280', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={handleSaveName}
                disabled={!editNameValue.trim() || savingName}
                style={{ padding: '10px 24px', backgroundColor: (!editNameValue.trim() || savingName) ? '#E5E7EB' : '#F97316', border: 'none', borderRadius: 8, color: (!editNameValue.trim() || savingName) ? '#9CA3AF' : '#FFFFFF', fontSize: 14, fontWeight: 700, cursor: (!editNameValue.trim() || savingName) ? 'not-allowed' : 'pointer' }}
              >
                {savingName ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo lightbox */}
      {viewingPhoto && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.92)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }} onClick={() => setViewingPhoto(null)}>
          <button onClick={() => setViewingPhoto(null)} style={{ position: 'absolute', top: 24, right: 24, backgroundColor: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 20, color: '#FFFFFF', fontSize: 16, cursor: 'pointer', width: 40, height: 40 }}>✕</button>
          <img src={viewingPhoto} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8 }} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
