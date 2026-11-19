import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useIsMobile } from '../hooks/useIsMobile';
import { fetchAllPages } from '../lib/fetchAllPages';

import { btn, card, chip, colors, fonts, input as inputSt, radius, sectionLabel, tint } from '../theme';
import PageHeader from '../components/ui/PageHeader';
import StatusChip from '../components/ui/StatusChip';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import Icon from '../components/ui/Icon';

// Client-facing portal: same dark tokens as the staff pages, calmer layout, no staff controls.
const statusLabels: Record<string, string> = { active: 'Active', on_hold: 'On Hold', completed: 'Completed' };

const coStatusLabels: Record<string, string> = { sent: 'Sent', under_review: 'Under Review' };

function getBudgetColor(pct: number) {
  if (pct >= 80) return colors.red;
  if (pct >= 50) return colors.amber;
  return colors.green;
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

const cardTitle: React.CSSProperties = { ...sectionLabel, fontSize: 12, color: colors.text2, margin: '0 0 14px' };
const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: colors.text2, marginBottom: 6 };

function ProgressBar({ pct, height = 8, label }: { pct: number; height?: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ height, backgroundColor: colors.track, borderRadius: height / 2, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, backgroundColor: colors.accent, borderRadius: height / 2, transition: 'width 0.5s ease' }} />
    </div>
  );
}

function Modal({ title, onClose, children, maxWidth = 520, scroll = false }: { title: string; onClose: () => void; children: React.ReactNode; maxWidth?: number; scroll?: boolean }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000, padding: 16 }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ ...card, padding: 24, width: '100%', maxWidth, maxHeight: scroll ? '80vh' : '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontFamily: fonts.display, fontSize: 24, fontWeight: 700, letterSpacing: '0.02em' }}>{title}</h3>
          <button type="button" className="fo-icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function ClientPortalPage() {
  const queryClient = useQueryClient();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'photos' | 'messages'>('overview');
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
  const [showChangeOrders, setShowChangeOrders] = useState(false);

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
      // Paged past the 1,000-row cap so a large project's progress is right.
      // Errors are ignored here as before (progress shows 0).
      const tasks = await fetchAllPages<any>((from, to) =>
        supabase
          .from('tasks')
          .select('id, project_id, status, archived')
          .in('project_id', projs.map((p: any) => p.id))
          .order('id')
          .range(from, to)).catch(() => [] as any[]);
      return projs.map((p: any) => {
        const pt = tasks.filter((t: any) => t.project_id === p.id);
        const done = pt.filter((t: any) => t.status === 'completed' || t.archived).length;
        return { ...p, progress: pt.length > 0 ? Math.round((done / pt.length) * 100) : 0 };
      });
    },
  });

  const { data: projectData, isLoading: projectLoading } = useQuery({
    queryKey: ['client-project-detail', selectedProject],
    queryFn: async () => {
      if (!selectedProject) return null;
      const [foldersRes, photosRes] = await Promise.all([
        supabase.from('folders').select('*').eq('project_id', selectedProject).order('created_at', { ascending: true }),
        supabase.from('task_photos').select('*, task:task_id (title, project_id)').eq('task.project_id', selectedProject).order('created_at', { ascending: false }).limit(20),
      ]);
      const folders = foldersRes.data ?? [];
      // Paged past the 1,000-row cap; errors are ignored as before.
      const tasks = await fetchAllPages<{ id: string; folder_id: string | null; status: string; archived: boolean }>((from, to) =>
        supabase.from('tasks').select('id, folder_id, status, archived').eq('project_id', selectedProject).order('id').range(from, to)
      ).catch(() => [] as { id: string; folder_id: string | null; status: string; archived: boolean }[]);
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
        ...(photosRes.data ?? []).map((ph: any) => ph.created_at),
      ].filter(Boolean).sort().reverse();
      return {
        folders: foldersWithProgress, photos,
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

  const closeCompose = () => { setShowCompose(false); setComposeSubject(''); setComposeBody(''); setComposeFile(null); };
  const recentThreads = [...threads].sort((a, b) => String(b.lastMsg?.created_at ?? '').localeCompare(String(a.lastMsg?.created_at ?? ''))).slice(0, 3);
  const photosEnabled = !!(selectedProjectData as any)?.client_photos_enabled;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: colors.bg, color: colors.text, fontFamily: fonts.ui }}>
      {/* Header */}
      <header style={{ height: 64, backgroundColor: colors.bg, borderBottom: `1px solid ${colors.border}`, padding: isMobile ? '0 16px' : '0 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: fonts.display, fontSize: 20, fontWeight: 700, letterSpacing: '0.06em', lineHeight: 1, whiteSpace: 'nowrap' }}>
            FIELDOPS<span style={{ color: colors.accent }}> PRO</span>
          </div>
          <div style={{ fontSize: 11, color: colors.text3, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 3 }}>Client portal</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {!isMobile && <span style={{ fontSize: 13, color: colors.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</span>}
          <button
            type="button"
            onClick={() => { setEditNameValue((profile as any)?.full_name ?? ''); setShowEditName(true); }}
            {...btn('ghost', { padding: isMobile ? '7px 10px' : '7px 14px', fontSize: 13, whiteSpace: 'nowrap' })}
          >
            Edit name
          </button>
          <button type="button" onClick={() => supabase.auth.signOut()} {...btn('ghost', { padding: isMobile ? '7px 10px' : '7px 14px', fontSize: 13, whiteSpace: 'nowrap' })}>
            Sign out
          </button>
        </div>
      </header>

      <main style={{ padding: isMobile ? '20px 16px' : '32px 32px', maxWidth: 1100, margin: '0 auto' }}>

        {/* ===== PROJECT LIST ===== */}
        {!selectedProject ? (
          <>
            <PageHeader title={`Welcome back, ${displayName}`} subtitle="Here's a live view of your active projects." />

            {projectsLoading ? (
              <div role="status" aria-label="Loading your projects" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 16 }}>
                {[0, 1].map((i) => <Skeleton key={i} height={180} radius={12} />)}
              </div>
            ) : !projects?.length ? (
              <EmptyState title="No projects yet" message="Your contractor hasn't added you to any projects yet." />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 16 }}>
                {projects.map((project: any) => (
                  <button
                    key={project.id}
                    type="button"
                    className="fo-card fo-card-link"
                    onClick={() => { setSelectedProject(project.id); setActiveTab('overview'); }}
                    style={{ ...card, padding: 22, textAlign: 'left', color: colors.text, font: 'inherit', display: 'flex', flexDirection: 'column', minWidth: 0 }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10, width: '100%' }}>
                      <span style={{ fontFamily: fonts.display, fontSize: 22, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.01em', lineHeight: 1.1, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{project.name}</span>
                      <StatusChip status={project.status} label={statusLabels[project.status]} />
                    </div>
                    {project.description && (
                      <span style={{ fontSize: 13, color: colors.text2, marginBottom: 14, lineHeight: 1.6, overflowWrap: 'anywhere' }}>
                        {project.description.length > 100 ? project.description.slice(0, 100) + '…' : project.description}
                      </span>
                    )}
                    <span style={{ display: 'block', width: '100%', marginTop: 'auto', marginBottom: 14 }}>
                      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: colors.text2 }}>Progress</span>
                        <span style={{ fontFamily: fonts.display, fontSize: 20, fontWeight: 700 }}>{project.progress ?? 0}%</span>
                      </span>
                      <ProgressBar pct={project.progress ?? 0} height={6} label={`${project.name} progress`} />
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 8 }}>
                      <span style={{ fontSize: 12, color: colors.text3 }}>Created {new Date(project.created_at).toLocaleDateString()}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: colors.text, display: 'inline-flex', alignItems: 'center', gap: 6 }}>View project <Icon name="arrow-right" size={14} /></span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Project header */}
            <PageHeader
              breadcrumb={[{ label: 'Your projects', onClick: goBack }, { label: selectedProjectData?.name ?? 'Project' }]}
              title={selectedProjectData?.name ?? ''}
              subtitle={selectedProjectData?.description || undefined}
              actions={
                <>
                  {selectedProjectData?.status && <StatusChip status={selectedProjectData.status} label={statusLabels[selectedProjectData.status]} />}
                  <button type="button" onClick={goBack} {...btn('secondary')}>
                    <Icon name="chevron-left" size={14} /> Back to projects
                  </button>
                </>
              }
            />

            {/* Change orders banner */}
            {!!pendingCOs?.length && (
              <div role="status" style={{ ...card, backgroundColor: tint(colors.amber, 0.08), borderColor: tint(colors.amber, 0.5), padding: '14px 18px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: colors.amber, minWidth: 0 }}>
                  <Icon name="clipboard" size={18} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>
                    You have {pendingCOs.length} change order{pendingCOs.length > 1 ? 's' : ''} awaiting your review
                  </span>
                </div>
                <button type="button" onClick={() => setShowChangeOrders(true)} {...btn('primary', { padding: '8px 16px', fontSize: 13 })}>
                  View details
                </button>
              </div>
            )}

            {/* Tab bar */}
            <div role="tablist" aria-label="Project sections" style={{ display: 'flex', borderBottom: `1px solid ${colors.border}`, marginBottom: 24, overflowX: 'auto', scrollbarWidth: 'none' as const }}>
              {([
                { key: 'overview' as const, label: 'Overview' },
                { key: 'photos' as const, label: 'Site Photos' },
                { key: 'messages' as const, label: 'Messages', dot: hasUnreadMessages },
              ].filter((t) => t.key !== 'photos' || photosEnabled) as Array<{ key: typeof activeTab; label: string; dot?: boolean }>).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  className={`fo-tab${activeTab === tab.key ? ' is-active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: isMobile ? '10px 12px 9px' : undefined }}
                >
                  {tab.label}
                  {'dot' in tab && tab.dot && <span aria-label="unread" style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: colors.blue, display: 'inline-block' }} />}
                </button>
              ))}
            </div>

            {projectLoading ? (
              <div role="status" aria-label="Loading project" style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 3fr) minmax(0, 2fr)', gap: 20 }}>
                <Skeleton height={160} radius={12} />
                <Skeleton height={160} radius={12} />
              </div>
            ) : (
              <>
                {/* ===== OVERVIEW ===== */}
                {activeTab === 'overview' && projectData && (
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 3fr) minmax(0, 2fr)', gap: 20, alignItems: 'start' }}>
                    {/* Left column */}
                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>

                      {/* Progress */}
                      <div style={card}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
                          <p style={{ ...cardTitle, margin: 0 }}>Project progress</p>
                          <span style={{ fontFamily: fonts.display, fontSize: 40, fontWeight: 700, lineHeight: 1 }}>{projectData.projectProgress}%</span>
                        </div>
                        <ProgressBar pct={projectData.projectProgress} height={10} label="Project progress" />
                        <div style={{ fontSize: 13, color: colors.text2, marginTop: 10 }}>{projectData.completedTasks} of {projectData.totalTasks} tasks completed</div>
                      </div>

                      {/* Budget summary — only when budget is set */}
                      {budget && (
                        <div style={card}>
                          <p style={cardTitle}>Budget summary</p>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: isMobile ? 8 : 12, marginBottom: 16 }}>
                            {[
                              { label: 'Budget', value: `$${budget.budgetAmount.toLocaleString()}`, color: colors.text },
                              { label: 'Spent', value: `$${budget.spent.toLocaleString()}`, color: getBudgetColor(budget.pct) },
                              { label: 'Remaining', value: `$${budget.remaining.toLocaleString()}`, color: budget.remaining < 0 ? colors.red : colors.green },
                            ].map((item) => (
                              <div key={item.label} style={{ backgroundColor: colors.bg, borderRadius: radius.control, padding: isMobile ? '10px 8px' : '12px 12px', border: `1px solid ${colors.border}`, minWidth: 0 }}>
                                <div style={{ ...sectionLabel, fontSize: 10.5, marginBottom: 6 }}>{item.label}</div>
                                <div style={{ fontFamily: fonts.display, fontSize: isMobile ? 18 : 22, fontWeight: 700, color: item.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.value}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ fontSize: 12, color: colors.text2 }}>Budget used</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: getBudgetColor(budget.pct) }}>{budget.pct}%</span>
                          </div>
                          <div style={{ height: 8, backgroundColor: colors.track, borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.min(budget.pct, 100)}%`, backgroundColor: getBudgetColor(budget.pct), borderRadius: 4, transition: 'width 0.5s ease' }} />
                          </div>
                        </div>
                      )}

                      {/* Work breakdown */}
                      {projectData.folders.length > 0 && (
                        <div style={card}>
                          <p style={cardTitle}>Work breakdown</p>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {projectData.folders.map((folder: any) => (
                              <div key={folder.id}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
                                  <span style={{ fontSize: 14, fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{folder.name}</span>
                                  <span style={{ fontFamily: fonts.display, fontSize: 18, fontWeight: 700 }}>{folder.pct}%</span>
                                </div>
                                <ProgressBar pct={folder.pct} height={5} label={`${folder.name} progress`} />
                                <span style={{ display: 'block', fontSize: 12, color: colors.text3, marginTop: 4 }}>{folder.completed_count} of {folder.task_count} tasks done</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right column */}
                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>

                      {/* Task summary */}
                      <div style={card}>
                        <p style={cardTitle}>Task summary</p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                          {[
                            { label: 'Total', value: projectData.totalTasks, color: colors.text },
                            { label: 'Completed', value: projectData.completedTasks, color: colors.green },
                            { label: 'In progress', value: projectData.inProgressTasks, color: colors.blue },
                            { label: 'Open', value: projectData.openTasks, color: colors.text2 },
                          ].map((s) => (
                            <div key={s.label} style={{ backgroundColor: colors.bg, borderRadius: radius.control, padding: '12px 12px', border: `1px solid ${colors.border}`, minWidth: 0 }}>
                              <div style={{ fontFamily: fonts.display, fontSize: 28, fontWeight: 700, lineHeight: 1, color: s.color, marginBottom: 6 }}>{s.value.toLocaleString()}</div>
                              <div style={{ ...sectionLabel, fontSize: 10.5 }}>{s.label}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Recent updates (from data this page already loads) */}
                      <div style={card}>
                        <p style={cardTitle}>Recent updates</p>
                        {recentThreads.length === 0 && !projectData.lastUpdatedAt ? (
                          <p style={{ fontSize: 13, color: colors.text2, margin: 0 }}>No updates yet. Messages from your contractor will show here.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {recentThreads.map((t, i) => {
                              const from = t.lastMsg?.sender_type === 'client' ? 'You' : ((t.lastMsg?.sender as any)?.full_name ?? 'Contractor');
                              return (
                                <div key={t.subject} style={{ padding: '10px 0', borderTop: i === 0 ? 'none' : `1px solid ${colors.border}`, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Icon name="mail" size={14} style={{ color: colors.text3 }} />
                                    <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{t.subject}</span>
                                    {t.hasUnread && <StatusChip status="in_progress" label="New" />}
                                  </div>
                                  <div style={{ fontSize: 12, color: colors.text3, marginTop: 3, paddingLeft: 22 }}>{from} · {t.lastMsg?.created_at ? new Date(t.lastMsg.created_at).toLocaleDateString() : ''}</div>
                                </div>
                              );
                            })}
                            {projectData.lastUpdatedAt && photosEnabled && (
                              <div style={{ padding: '10px 0', borderTop: recentThreads.length ? `1px solid ${colors.border}` : 'none', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                                <Icon name="image" size={14} style={{ color: colors.text3 }} />
                                <span>Latest site photo {daysAgo(projectData.lastUpdatedAt)}</span>
                              </div>
                            )}
                          </div>
                        )}
                        <button type="button" onClick={() => setActiveTab('messages')} {...btn('secondary', { width: '100%', marginTop: 12, fontSize: 13, padding: '8px 12px' })}>
                          Open messages
                        </button>
                      </div>

                      {/* Project details */}
                      <div style={card}>
                        <p style={cardTitle}>Project details</p>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          {[
                            { label: 'Status', value: <StatusChip status={selectedProjectData?.status} label={statusLabels[selectedProjectData?.status]} /> },
                            { label: 'Created', value: new Date(selectedProjectData?.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) },
                            ...(projectData.lastUpdatedAt ? [{ label: 'Last Updated', value: daysAgo(projectData.lastUpdatedAt) }] : []),
                          ].map((item, i, arr) => (
                            <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: i < arr.length - 1 ? `1px solid ${colors.border}` : 'none' }}>
                              <span style={{ fontSize: 13, color: colors.text2 }}>{item.label}</span>
                              <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{item.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ===== SITE PHOTOS ===== */}
                {activeTab === 'photos' && (
                  !projectData?.photos.length ? (
                    <EmptyState title="No site photos yet" message="Photos taken during work will appear here." />
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                      {projectData.photos.map((photo: any) => (
                        <button
                          key={photo.id}
                          type="button"
                          className="fo-card-link"
                          aria-label="View photo"
                          onClick={() => setViewingPhoto(photo.url)}
                          style={{ aspectRatio: '1', borderRadius: radius.card, overflow: 'hidden', padding: 0, backgroundColor: colors.surface, border: `1px solid ${colors.border}` }}
                        >
                          <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        </button>
                      ))}
                    </div>
                  )
                )}

                {/* ===== MESSAGES ===== */}
                {activeTab === 'messages' && (
                  <div style={{ ...card, padding: 0, display: 'flex', minHeight: 520, overflow: 'hidden' }}>
                    {/* Thread list */}
                    {(!isMobile || !mobileThreadOpen) && (
                      <div style={{ width: isMobile ? '100%' : '32%', borderRight: isMobile ? 'none' : `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0, minWidth: 0 }}>
                        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <span style={{ ...sectionLabel, fontSize: 12, color: colors.text2 }}>Conversations</span>
                          <button type="button" onClick={() => setShowCompose(true)} {...btn('primary', { padding: '6px 12px', fontSize: 13 })}>
                            <Icon name="plus" size={13} strokeWidth={2.75} /> New
                          </button>
                        </div>
                        <div style={{ overflowY: 'auto', flex: 1 }}>
                          {!threads.length && (
                            <EmptyState compact title="No conversations yet" message='Tap "New" to start one.' />
                          )}
                          {threads.map((thread) => {
                            const isSelected = !isMobile && selectedThread === thread.subject;
                            const lastMsg = thread.lastMsg;
                            const preview = lastMsg?.message?.slice(0, 55) ?? '';
                            const senderName = (lastMsg?.sender as any)?.full_name ?? (lastMsg?.sender_type === 'client' ? 'You' : 'Contractor');
                            return (
                              <button
                                key={thread.subject}
                                type="button"
                                className={isSelected ? undefined : 'fo-row'}
                                onClick={() => selectThread(thread.subject)}
                                aria-current={isSelected ? 'true' : undefined}
                                style={{ display: 'block', width: '100%', textAlign: 'left', font: 'inherit', color: colors.text, padding: '12px 16px', border: 'none', borderBottom: `1px solid ${colors.border}`, cursor: 'pointer', background: isSelected ? tint(colors.accent, 0.1) : 'transparent', boxShadow: isSelected ? `inset 3px 0 0 ${colors.accent}` : 'none' }}
                              >
                                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                  <span style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{thread.subject}</span>
                                  {thread.hasUnread && <span aria-label="unread" style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: colors.blue, flexShrink: 0 }} />}
                                </span>
                                <span style={{ display: 'block', fontSize: 13, color: colors.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>{preview || '—'}</span>
                                <span style={{ display: 'block', fontSize: 12, color: colors.text3 }}>{senderName} · {lastMsg?.created_at ? new Date(lastMsg.created_at).toLocaleDateString() : ''}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Thread detail */}
                    {(!isMobile || mobileThreadOpen) && (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        {!selectedThread ? (
                          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: colors.text2, fontSize: 14, padding: 20, textAlign: 'center' }}>
                            Select a conversation to view messages
                          </div>
                        ) : (
                          <>
                            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                              {isMobile && (
                                <button type="button" className="fo-icon-btn" aria-label="Back to conversations" onClick={() => setMobileThreadOpen(false)}>
                                  <Icon name="chevron-left" size={16} />
                                </button>
                              )}
                              <span style={{ fontSize: 15, fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedThread}</span>
                              <span style={{ fontSize: 12, color: colors.text3, flexShrink: 0 }}>{selectedMessages.length} message{selectedMessages.length !== 1 ? 's' : ''}</span>
                            </div>

                            <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 12 : 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                                    <div style={{ backgroundColor: isClient ? colors.surface2 : colors.bg, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 14 }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                          <span style={{ fontSize: 13, fontWeight: 700 }}>{senderName}</span>
                                          <span style={{ ...chip(isClient ? 'in_progress' : 'open'), fontSize: 11, padding: '1px 8px' }}>{isClient ? 'Client' : 'Contractor'}</span>
                                        </div>
                                        <span style={{ fontSize: 12, color: colors.text3 }}>{new Date(msg.created_at).toLocaleString()}</span>
                                      </div>
                                      <p style={{ margin: 0, fontSize: 14, color: colors.text, lineHeight: 1.65, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{msg.message}</p>
                                      {attachmentUrl && msg.attachment_name && (
                                        <a href={attachmentUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '7px 12px', backgroundColor: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.control, textDecoration: 'none', color: colors.text, fontSize: 13, maxWidth: '100%' }}>
                                          <Icon name="paperclip" size={14} />
                                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{msg.attachment_name}</span>
                                          {msg.attachment_type && <span style={{ ...chip('open'), fontSize: 11, padding: '1px 7px' }}>{msg.attachment_type}</span>}
                                        </a>
                                      )}
                                    </div>
                                    {/* Read receipt (client messages only) */}
                                    {isClient && (
                                      <div style={{ marginTop: 4, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: 12, color: msg.read_by_admin ? colors.green : colors.text3, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                          {msg.read_by_admin ? <><Icon name="check" size={12} strokeWidth={3} /> Read</> : 'Sent'}
                                        </span>
                                        {isLastMsg && !msg.read_by_admin && (
                                          <span style={{ fontSize: 12, color: colors.text3 }}>· Your contractor has been notified</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                              <div ref={threadEndRef} />
                            </div>

                            {/* Reply box */}
                            <div style={{ padding: isMobile ? 12 : '14px 20px', borderTop: `1px solid ${colors.border}` }}>
                              {replyFile && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '6px 10px', backgroundColor: colors.bg, borderRadius: radius.control, border: `1px solid ${colors.border}` }}>
                                  <Icon name="paperclip" size={14} style={{ color: colors.text2 }} />
                                  <span style={{ fontSize: 13, color: colors.text2, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{replyFile.name}</span>
                                  <button type="button" className="fo-icon-btn" aria-label="Remove attachment" onClick={() => setReplyFile(null)} style={{ width: 28, height: 28 }}><Icon name="x" size={14} /></button>
                                </div>
                              )}
                              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                                <label className="fo-icon-btn" title="Attach file" style={{ height: 'auto', minHeight: 44, width: 44 }}>
                                  <Icon name="paperclip" size={17} />
                                  <span className="fo-sr-only">Attach file</span>
                                  <input type="file" accept="image/*,application/pdf" onChange={(e) => setReplyFile(e.target.files?.[0] ?? null)} style={{ display: 'none' }} />
                                </label>
                                <label htmlFor="client-reply" className="fo-sr-only">Reply</label>
                                <textarea
                                  id="client-reply"
                                  value={replyText}
                                  onChange={(e) => setReplyText(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSendReply(); }}
                                  placeholder="Type a reply… (Ctrl+Enter to send)"
                                  rows={3}
                                  style={{ ...inputSt, resize: 'none', flex: 1, minWidth: 0 }}
                                />
                                <button
                                  type="button"
                                  onClick={handleSendReply}
                                  disabled={sendingReply || !replyText.trim()}
                                  {...btn('primary', { minWidth: 68, flexShrink: 0, padding: '10px 14px' })}
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
      </main>

      {/* Compose modal */}
      {showCompose && (
        <Modal title="New message" onClose={closeCompose} maxWidth={540}>
          <div style={{ marginBottom: 14 }}>
            <label htmlFor="compose-subject" style={fieldLabel}>Subject</label>
            <input id="compose-subject" type="text" value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} placeholder="Enter subject..." style={inputSt} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label htmlFor="compose-body" style={fieldLabel}>Message</label>
            <textarea id="compose-body" value={composeBody} onChange={(e) => setComposeBody(e.target.value)} placeholder="Type your message..." style={{ ...inputSt, resize: 'vertical' as const, minHeight: 120 }} />
          </div>
          {composeFile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '6px 10px', backgroundColor: colors.bg, borderRadius: radius.control, border: `1px solid ${colors.border}` }}>
              <Icon name="paperclip" size={14} style={{ color: colors.text2 }} />
              <span style={{ fontSize: 13, color: colors.text2, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{composeFile.name}</span>
              <button type="button" className="fo-icon-btn" aria-label="Remove attachment" onClick={() => setComposeFile(null)} style={{ width: 28, height: 28 }}><Icon name="x" size={14} /></button>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label className="fo-btn fo-btn-secondary" style={{ ...btn('secondary').style, fontSize: 13 }}>
              <Icon name="paperclip" size={14} /> Attach file
              <input type="file" style={{ display: 'none' }} onChange={(e) => setComposeFile(e.target.files?.[0] ?? null)} />
            </label>
            <button
              type="button"
              onClick={handleSendCompose}
              disabled={!composeSubject.trim() || !composeBody.trim() || sendingCompose}
              {...btn('primary')}
            >
              {sendingCompose ? 'Sending...' : 'Send message'}
            </button>
          </div>
        </Modal>
      )}

      {/* Edit Name modal */}
      {showEditName && (
        <Modal title="Edit name" onClose={() => setShowEditName(false)} maxWidth={400}>
          <div style={{ marginBottom: 20 }}>
            <label htmlFor="client-full-name" style={fieldLabel}>Full name</label>
            <input
              id="client-full-name"
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
            <button type="button" onClick={() => setShowEditName(false)} {...btn('secondary')}>
              Cancel
            </button>
            <button type="button" onClick={handleSaveName} disabled={!editNameValue.trim() || savingName} {...btn('primary')}>
              {savingName ? 'Saving...' : 'Save'}
            </button>
          </div>
        </Modal>
      )}

      {/* Change Orders modal */}
      {showChangeOrders && (
        <Modal title="Pending change orders" onClose={() => setShowChangeOrders(false)} maxWidth={480} scroll>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(pendingCOs ?? []).map((co: any) => (
              <div key={co.id} style={{ backgroundColor: colors.bg, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}>CO #{co.co_number}: {co.title}</span>
                  <span style={chip('in_progress')}>{coStatusLabels[co.status] ?? co.status}</span>
                </div>
                {co.estimated_cost != null && (
                  <div style={{ fontSize: 13, color: colors.text2 }}>Estimated cost: <strong style={{ fontFamily: fonts.display, fontSize: 17, color: colors.text }}>${co.estimated_cost.toLocaleString()}</strong></div>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Photo lightbox */}
      {viewingPhoto && (
        <div role="dialog" aria-modal="true" aria-label="Photo" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.92)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }} onClick={() => setViewingPhoto(null)}>
          <button type="button" className="fo-icon-btn" aria-label="Close photo" onClick={() => setViewingPhoto(null)} style={{ position: 'absolute', top: 20, right: 20, width: 40, height: 40, backgroundColor: 'rgba(17,24,39,0.8)', color: colors.text }}>
            <Icon name="x" size={18} />
          </button>
          <img src={viewingPhoto} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8 }} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
