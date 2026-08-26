import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useIsAdmin, useIsProjectOwner, useIsProjectManager } from '../lib/useIsAdmin';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ProjectBudgetTab } from './tabs/ProjectBudgetTab';
import { ProjectChangeOrdersTab } from './tabs/ProjectChangeOrdersTab';
import { ProjectRFITab } from './tabs/ProjectRFITab';
import { ProjectClientMessagesTab } from './tabs/ProjectClientMessagesTab';

// The checklist-completion DB trigger raises errcode 'CHK01' when a checklist-type
// task can't be marked complete (no items yet, or items still unresolved) — surface
// that distinctly from any other update failure on the same mutation.
function describeTaskError(e: any): string {
  if (e?.code === 'CHK01') {
    return `Checklist incomplete — ${e.message}`;
  }
  return e?.message ?? 'Something went wrong.';
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: isAdmin } = useIsAdmin();
  const { data: isOwner } = useIsProjectOwner(id ?? '');
  const { data: isPM } = useIsProjectManager();
  const canEdit = isAdmin || isOwner || isPM;

  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [showArchivedTasks, setShowArchivedTasks] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [editingFolder, setEditingFolder] = useState<any>(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'tasks' | 'budget' | 'change-orders' | 'rfi' | 'client-messages'>('tasks');

  const [showImport, setShowImport] = useState(false);
  const [importMode, setImportMode] = useState<'paste' | 'manual' | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [parsedTasks, setParsedTasks] = useState<any[]>([]);
  const [importStep, setImportStep] = useState<'input' | 'preview' | 'done'>('input');
  const [importing, setImporting] = useState(false);
  const [manualTasks, setManualTasks] = useState([{ title: '', description: '', priority: 'medium', dueDate: '' }]);
  const [importFormat, setImportFormat] = useState<'tasks' | 'checklist'>('tasks');
  const [parsedChecklistRows, setParsedChecklistRows] = useState<{ taskName: string; itemText: string; valid: boolean; reason?: string }[]>([]);

  const [showEditProject, setShowEditProject] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState('active');
  const [savingProject, setSavingProject] = useState(false);
  const [editClientPhotosEnabled, setEditClientPhotosEnabled] = useState(false);

  const [showConvertConfirm, setShowConvertConfirm] = useState(false);
  const [converting, setConverting] = useState(false);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteType, setInviteType] = useState<'team' | 'client'>('team');

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFolderFilter, setExportFolderFilter] = useState<string>('all');
  const [exportStatusFilter, setExportStatusFilter] = useState<string>('all');
  const [exportIncludeArchived, setExportIncludeArchived] = useState(false);

  const [viewTask, setViewTask] = useState<any>(null);
  const [viewTaskPhotos, setViewTaskPhotos] = useState<any[]>([]);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  const [photosLoading, setPhotosLoading] = useState(false);

  const [viewTaskChecklist, setViewTaskChecklist] = useState<any[]>([]);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [newChecklistItemText, setNewChecklistItemText] = useState('');
  const [addingChecklistItem, setAddingChecklistItem] = useState(false);
  const CHECKLIST_ITEM_CAP = 45;

  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [editTaskTitle, setEditTaskTitle] = useState('');
  const [editTaskDescription, setEditTaskDescription] = useState('');
  const [editTaskStatus, setEditTaskStatus] = useState('open');
  const [editTaskPriority, setEditTaskPriority] = useState('medium');
  const [editTaskDueDate, setEditTaskDueDate] = useState('');
  const [editTaskAssignee, setEditTaskAssignee] = useState('');
  const [savingTask, setSavingTask] = useState(false);

  const invalidateDashboard = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-dash-progress'] });
    queryClient.invalidateQueries({ queryKey: ['admin-dash-stats'] });
    queryClient.invalidateQueries({ queryKey: ['pm-dash-progress'] });
  };

  const { data: project } = useQuery({
    queryKey: ['web-project', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('*').eq('id', id).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: folders, isLoading: foldersLoading } = useQuery({
    queryKey: ['web-folders', id],
    queryFn: async () => {
      const [foldersRes, tasksRes] = await Promise.all([
        supabase.from('folders').select('*').eq('project_id', id).order('created_at', { ascending: true }),
        supabase.from('tasks').select('id, folder_id, status, archived').eq('project_id', id),
      ]);
      if (foldersRes.error) throw foldersRes.error;
      const folders = foldersRes.data ?? [];
      const tasks = tasksRes.data ?? [];
      return folders.map((folder) => {
        const folderTasks = tasks.filter((t) => t.folder_id === folder.id);
        const completedTasks = folderTasks.filter((t) => t.status === 'completed' || t.archived);
        return { ...folder, task_count: folderTasks.length, completed_count: completedTasks.length };
      });
    },
    enabled: !!id,
  });

  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: ['web-folder-tasks', id, selectedFolder, showArchivedTasks],
    queryFn: async () => {
      let query = supabase
        .from('tasks')
        .select('*, assignee:assigned_to (id, full_name)')
        .eq('project_id', id)
        .eq('archived', showArchivedTasks)
        .order('created_at', { ascending: false });
      if (selectedFolder) query = query.eq('folder_id', selectedFolder);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: teamMembers } = useQuery({
    queryKey: ['web-project-members', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_members')
        .select('*, profile:user_id (id, full_name, role)')
        .eq('project_id', id);
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { mutate: updateStatus } = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: string }) => {
      const { error } = await supabase.from('tasks').update({ status, archived: status === 'completed' }).eq('id', taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['web-folder-tasks', id] });
      queryClient.invalidateQueries({ queryKey: ['web-folders', id] });
      queryClient.invalidateQueries({ queryKey: ['web-calendar-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['web-all-tasks'] });
      invalidateDashboard();
    },
    onError: (error: any) => alert(describeTaskError(error)),
  });

  const totalTasks = folders?.reduce((sum, f) => sum + (f.task_count ?? 0), 0) ?? 0;
  const completedTasks = folders?.reduce((sum, f) => sum + (f.completed_count ?? 0), 0) ?? 0;
  const projectProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const filteredTasks = tasks?.filter((task: any) => {
    if (!taskSearch.trim()) return true;
    const q = taskSearch.toLowerCase();
    return (
      task.title?.toLowerCase().includes(q) ||
      task.description?.toLowerCase().includes(q) ||
      (task.assignee as any)?.full_name?.toLowerCase().includes(q)
    );
  });

  function getProgressColor(pct: number) {
    if (pct === 100) return '#22C55E';
    if (pct >= 50) return '#F97316';
    return '#3B82F6';
  }

  function resetImport() {
    setShowImport(false);
    setImportStep('input');
    setImportMode(null);
    setPastedText('');
    setParsedTasks([]);
    setManualTasks([{ title: '', description: '', priority: 'medium', dueDate: '' }]);
    setImportFormat('tasks');
    setParsedChecklistRows([]);
  }

  async function handleExportPDF() {
    try {
      const { data, error } = await supabase
        .from('tasks')
        .select('*, assignee:assigned_to(full_name), folder:folder_id(name)')
        .eq('project_id', id)
        .order('folder_id', { ascending: true });

      if (error) throw error;

      let allTasks = data ?? [];

      // Apply folder filter
      if (exportFolderFilter !== 'all') {
        allTasks = allTasks.filter((t: any) => t.folder_id === exportFolderFilter);
      }

      // Apply status filter
      if (exportStatusFilter !== 'all') {
        allTasks = allTasks.filter((t: any) => t.status === exportStatusFilter);
      }

      // Apply archived filter
      if (!exportIncludeArchived) {
        allTasks = allTasks.filter((t: any) => !t.archived);
      }

      const folderLabel = exportFolderFilter === 'all'
        ? 'All Folders'
        : folders?.find((f: any) => f.id === exportFolderFilter)?.name ?? 'Folder';

      const statusLabel = exportStatusFilter === 'all' ? 'All Statuses'
        : exportStatusFilter === 'in_progress' ? 'In Progress'
        : exportStatusFilter === 'completed' ? 'Done' : 'Open';

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      // Orange header bar
      doc.setFillColor(249, 115, 22);
      doc.rect(0, 0, 297, 18, 'F');
      doc.setTextColor(10, 15, 30);
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text('FIELDOPS PRO', 14, 12);
      doc.setFontSize(10);
      doc.text(`${project?.name ?? 'Project'} — ${folderLabel} — ${statusLabel}`, 80, 12);
      doc.setFontSize(9);
      doc.text(`Exported: ${new Date().toLocaleDateString()}`, 230, 12);

      // Stats row
      const total = allTasks.length;
      const done = allTasks.filter((t: any) => t.status === 'completed' || t.archived).length;
      const inProgress = allTasks.filter((t: any) => t.status === 'in_progress').length;
      const open = allTasks.filter((t: any) => t.status === 'open').length;

      doc.setFillColor(17, 24, 39);
      doc.rect(0, 18, 297, 14, 'F');
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(156, 163, 175);
      doc.text(`TOTAL: ${total}`, 14, 27);
      doc.setTextColor(34, 197, 94);
      doc.text(`DONE: ${done}`, 50, 27);
      doc.setTextColor(249, 115, 22);
      doc.text(`IN PROGRESS: ${inProgress}`, 80, 27);
      doc.setTextColor(107, 114, 128);
      doc.text(`OPEN: ${open}`, 130, 27);

      const rows = allTasks.map((t: any) => [
        t.title ?? '',
        t.description ? (t.description.length > 45 ? t.description.slice(0, 45) + '...' : t.description) : '',
        t.status === 'in_progress' ? 'In Progress' : t.status === 'completed' ? 'Done' : 'Open',
        t.priority ?? '',
        (t.assignee as any)?.full_name ?? 'Unassigned',
        (t.folder as any)?.name ?? 'No Folder',
        t.due_date ? new Date(t.due_date).toLocaleDateString() : '—',
        t.archived ? 'Yes' : 'No',
      ]);

      autoTable(doc, {
        startY: 34,
        head: [['Title', 'Description', 'Status', 'Priority', 'Assigned To', 'Folder', 'Due Date', 'Archived']],
        body: rows,
        theme: 'grid',
        styles: {
          fontSize: 8,
          cellPadding: 3,
          fillColor: [17, 24, 39],
          textColor: [229, 231, 235],
          lineColor: [31, 41, 55],
          lineWidth: 0.3,
        },
        headStyles: {
          fillColor: [31, 41, 55],
          textColor: [156, 163, 175],
          fontStyle: 'bold',
          fontSize: 8,
        },
        alternateRowStyles: { fillColor: [13, 19, 33] },
        columnStyles: {
          0: { cellWidth: 55 },
          1: { cellWidth: 60 },
          2: { cellWidth: 25 },
          3: { cellWidth: 20 },
          4: { cellWidth: 35 },
          5: { cellWidth: 35 },
          6: { cellWidth: 25 },
          7: { cellWidth: 18 },
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 2) {
            const val = data.cell.raw as string;
            if (val === 'Done') data.cell.styles.textColor = [34, 197, 94];
            else if (val === 'In Progress') data.cell.styles.textColor = [249, 115, 22];
            else data.cell.styles.textColor = [107, 114, 128];
          }
          if (data.section === 'body' && data.column.index === 3) {
            const val = data.cell.raw as string;
            if (val === 'high') data.cell.styles.textColor = [239, 68, 68];
            else if (val === 'medium') data.cell.styles.textColor = [245, 158, 11];
            else data.cell.styles.textColor = [107, 114, 128];
          }
        },
      });

      doc.save(`${project?.name ?? 'tasks'} - ${folderLabel} - ${statusLabel}.pdf`);
      setShowExportModal(false);
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function openViewTask(task: any) {
    setViewTask(task);
    setPhotosLoading(true);
    try {
      const { data, error } = await supabase
        .from('task_photos')
        .select('*')
        .eq('task_id', task.id)
        .order('created_at', { ascending: false });
      if (!error && data) {
        const photosWithUrls = data.map((photo: any) => ({
          ...photo,
          url: `${process.env.REACT_APP_SUPABASE_URL}/storage/v1/object/public/task-photos/${photo.storage_key}`,
        }));
        setViewTaskPhotos(photosWithUrls);
      }
    } catch (e) {
      setViewTaskPhotos([]);
    } finally {
      setPhotosLoading(false);
    }

    if (project?.project_type === 'checklist') {
      await refreshChecklist(task.id);
    } else {
      setViewTaskChecklist([]);
    }
  }

  function closeViewTask() {
    setViewTask(null);
    setViewTaskPhotos([]);
    setViewingPhoto(null);
    setViewTaskChecklist([]);
    setNewChecklistItemText('');
  }

  async function refreshChecklist(taskId: string) {
    setChecklistLoading(true);
    try {
      const { data, error } = await supabase
        .from('checklist_items')
        .select('*')
        .eq('task_id', taskId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      setViewTaskChecklist(data ?? []);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setChecklistLoading(false);
    }
  }

  async function handleAddChecklistItem() {
    if (!viewTask || !newChecklistItemText.trim()) return;
    if (viewTaskChecklist.length >= CHECKLIST_ITEM_CAP) return;
    setAddingChecklistItem(true);
    try {
      const { error } = await supabase.from('checklist_items').insert({
        task_id: viewTask.id,
        item_text: newChecklistItemText.trim(),
        sort_order: viewTaskChecklist.length,
      });
      if (error) throw error;
      setNewChecklistItemText('');
      await refreshChecklist(viewTask.id);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setAddingChecklistItem(false);
    }
  }

  async function handleToggleChecklistDone(item: any) {
    try {
      const nextStatus = item.status === 'done' ? 'not_started' : 'done';
      const { error } = await supabase.from('checklist_items').update({ status: nextStatus }).eq('id', item.id);
      if (error) throw error;
      await refreshChecklist(item.task_id);
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function handleToggleChecklistMissingPart(item: any) {
    try {
      const nextStatus = item.status === 'missing_part' ? 'part_received' : 'missing_part';
      const { error } = await supabase.from('checklist_items').update({ status: nextStatus }).eq('id', item.id);
      if (error) throw error;
      await refreshChecklist(item.task_id);
    } catch (e: any) {
      alert(e.message);
    }
  }

  const checklistStatusColors: Record<string, string> = {
    not_started: '#6B7280', done: '#22C55E', missing_part: '#EF4444', part_received: '#3B82F6',
  };
  const checklistStatusLabels: Record<string, string> = {
    not_started: 'Not Started', done: 'Done', missing_part: "Missing Part", part_received: 'Part Received',
  };

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('folders').insert({ project_id: id, name: newFolderName.trim(), created_by: user!.id });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['web-folders', id] });
      setNewFolderName(''); setShowCreateFolder(false);
    } catch (e: any) { alert(e.message); }
    finally { setCreatingFolder(false); }
  }

  async function handleRenameFolder() {
    if (!editFolderName.trim() || !editingFolder) return;
    try {
      const { error } = await supabase.from('folders').update({ name: editFolderName.trim() }).eq('id', editingFolder.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['web-folders', id] });
      setEditingFolder(null);
    } catch (e: any) { alert(e.message); }
  }

  async function handleDeleteFolder(folder: any) {
    if (!window.confirm(`Delete "${folder.name}"? Tasks inside will not be deleted.`)) return;
    try {
      const { error } = await supabase.from('folders').delete().eq('id', folder.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['web-folders', id] });
      if (selectedFolder === folder.id) setSelectedFolder(null);
    } catch (e: any) { alert(e.message); }
  }

  async function handleSaveProject() {
    setSavingProject(true);
    try {
      const { error } = await supabase.from('projects').update({ name: editName, description: editDescription, status: editStatus, client_photos_enabled: editClientPhotosEnabled }).eq('id', id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['web-project', id] });
      queryClient.invalidateQueries({ queryKey: ['web-projects'] });
      setShowEditProject(false);
    } catch (e: any) { alert(e.message); }
    finally { setSavingProject(false); }
  }

  async function handleConvertToChecklist() {
    setConverting(true);
    try {
      const { error } = await supabase.rpc('convert_project_to_checklist', { p_project_id: id });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['web-project', id] });
      queryClient.invalidateQueries({ queryKey: ['web-projects'] });
      setShowConvertConfirm(false);
      setShowEditProject(false);
    } catch (e: any) { alert(e.message); }
    finally { setConverting(false); }
  }

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.rpc('invite_user_to_project', {
        p_project_id: id, p_email: inviteEmail.toLowerCase().trim(), p_invited_by: user!.id,
      });
      if (error) throw error;
      if (data.status === 'already_member') alert('This person is already on the project.');
      else {
        alert('Team member added!');
        queryClient.invalidateQueries({ queryKey: ['web-project-members', id] });
        setInviteEmail(''); setShowInvite(false);
      }
    } catch (e: any) { alert(e.message); }
    finally { setInviting(false); }
  }

  async function handleInviteClient() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const { data: { user: cu } } = await supabase.auth.getUser();

      // Step 1: check if a profile already exists with this email
      const { data: existingProfile, error: profileLookupError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', inviteEmail.toLowerCase().trim())
        .maybeSingle();

      // Surface RLS / query errors immediately — don't silently fall through to the invite flow
      if (profileLookupError) throw profileLookupError;

      if (existingProfile) {
        // Step 2: user already has an account — add directly to client_projects, no auth invite needed
        const { data: memberRow2 } = await supabase
          .from('company_members')
          .select('company_id')
          .eq('user_id', cu!.id)
          .single();
        const { error } = await supabase
          .from('client_projects')
          .insert({ project_id: id, client_id: existingProfile.id, company_id: memberRow2?.company_id });
        if (error && error.code === '23505') {
          alert('This client is already on this project.');
        } else {
          if (error) throw error;
          queryClient.invalidateQueries({ queryKey: ['web-all-clients'] });
          alert('Client added to this project!');
          setInviteEmail(''); setShowInvite(false); setInviteType('team');
        }
      } else {
        // Step 3: brand-new client — send invite email so they can create an account
        const { data: memberRow } = await supabase
          .from('company_members')
          .select('company_id, company:company_id(name)')
          .eq('user_id', cu!.id)
          .single();
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(
          `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/send-invite`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
            body: JSON.stringify({
              email: inviteEmail.toLowerCase().trim(),
              invitedBy: cu!.id,
              companyName: (memberRow?.company as any)?.name ?? 'your team',
              role: 'client',
              projectId: id,
              companyId: memberRow?.company_id,
            }),
          }
        );
        const result = await res.json();
        if (!result.success) throw new Error(result.error);
        alert('Client invite sent!');
        setInviteEmail(''); setShowInvite(false); setInviteType('team');
      }
    } catch (e: any) { alert(e.message); }
    finally { setInviting(false); }
  }

  function openEditTask(task: any) {
    setSelectedTask(task);
    setEditTaskTitle(task.title);
    setEditTaskDescription(task.description ?? '');
    setEditTaskStatus(task.status);
    setEditTaskPriority(task.priority);
    setEditTaskDueDate(task.due_date ? task.due_date.slice(0, 10) : '');
    setEditTaskAssignee(task.assigned_to ?? '');
  }

async function handleSaveTask() {
  if (!selectedTask) return;
  setSavingTask(true);
  try {
    const updatePayload: Record<string, any> = {
      title: editTaskTitle.trim(),
      description: editTaskDescription.trim() || null,
      status: editTaskStatus,
      priority: editTaskPriority,
      due_date: editTaskDueDate || null,
      assigned_to: editTaskAssignee && editTaskAssignee.trim() !== '' ? editTaskAssignee : null,
    };

    const { error } = await supabase
      .from('tasks')
      .update(updatePayload)
      .eq('id', selectedTask.id);

    if (error) throw error;

    queryClient.invalidateQueries({ queryKey: ['web-folder-tasks', id] });
    queryClient.invalidateQueries({ queryKey: ['web-folders', id] });
    queryClient.invalidateQueries({ queryKey: ['web-calendar-tasks'] });
    queryClient.invalidateQueries({ queryKey: ['web-all-tasks'] });
    invalidateDashboard();
    setSelectedTask(null);
  } catch (e: any) {
    alert(describeTaskError(e));
  } finally {
    setSavingTask(false);
  }
}

  async function handleArchiveTask(task: any) {
    try {
      const { error } = await supabase.from('tasks').update({ archived: true, status: 'completed' }).eq('id', task.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['web-folder-tasks', id] });
      queryClient.invalidateQueries({ queryKey: ['web-folders', id] });
      queryClient.invalidateQueries({ queryKey: ['web-calendar-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['web-all-tasks'] });
      invalidateDashboard();
    } catch (e: any) { alert(describeTaskError(e)); }
  }

  async function handleRestoreTask(task: any) {
    try {
      const { error } = await supabase.from('tasks').update({ archived: false, status: 'open' }).eq('id', task.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['web-folder-tasks', id] });
      queryClient.invalidateQueries({ queryKey: ['web-folders', id] });
      queryClient.invalidateQueries({ queryKey: ['web-calendar-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['web-all-tasks'] });
      invalidateDashboard();
    } catch (e: any) { alert(e.message); }
  }

  async function handleDeleteTask(task: any) {
    if (!window.confirm(`Permanently delete "${task.title}"? This cannot be undone.`)) return;
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', task.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['web-folder-tasks', id] });
      queryClient.invalidateQueries({ queryKey: ['web-folders', id] });
      queryClient.invalidateQueries({ queryKey: ['web-calendar-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['web-all-tasks'] });
      invalidateDashboard();
    } catch (e: any) { alert(e.message); }
  }

  async function handleSaveManual() {
    const validTasks = manualTasks.filter((t) => t.title.trim());
    if (!validTasks.length) { alert('Please enter at least one task name.'); return; }
    setImporting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('tasks').insert(
        validTasks.map((t) => ({
          project_id: id, folder_id: selectedFolder || null,
          title: t.title.trim(), description: t.description.trim() || null,
          priority: t.priority, due_date: t.dueDate || null,
          status: 'open', created_by: user!.id,
        }))
      );
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['web-folder-tasks', id] });
      queryClient.invalidateQueries({ queryKey: ['web-folders', id] });
      queryClient.invalidateQueries({ queryKey: ['web-calendar-tasks'] });
      invalidateDashboard();
      setParsedTasks(validTasks.map(t => ({ ...t, valid: true })));
      setImportStep('done');
    } catch (e: any) { alert(e.message); }
    finally { setImporting(false); }
  }

  function handlePastePreview() {
    if (!pastedText.trim()) return;
    const lines = pastedText.trim().split('\n').filter(l => l.trim());
    const parsed = lines.slice(0, 100).map(line => {
      const cols = line.split('\t').map(c => c.trim().replace(/^"|"$/g, ''));
      const title = cols[0] ?? '';
      const description = cols[1] ?? '';
      const priorityRaw = (cols[2] ?? 'medium').toLowerCase();
      let priority = 'medium';
      if (priorityRaw.includes('high') || priorityRaw === 'h') priority = 'high';
      else if (priorityRaw.includes('low') || priorityRaw === 'l') priority = 'low';
      const dueDate = cols[3] ?? '';
      return { title, description, priority, dueDate, valid: !!title };
    });
    setParsedTasks(parsed);
    setImportStep('preview');
  }

  async function handleImport() {
    const validTasks = parsedTasks.filter((t) => t.valid);
    if (!validTasks.length) return;
    setImporting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('tasks').insert(
        validTasks.map((t) => ({
          project_id: id, folder_id: selectedFolder || null,
          title: t.title, description: t.description || null,
          priority: t.priority, due_date: t.dueDate || null,
          status: 'open', created_by: user!.id,
        }))
      );
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['web-folder-tasks', id] });
      queryClient.invalidateQueries({ queryKey: ['web-folders', id] });
      queryClient.invalidateQueries({ queryKey: ['web-calendar-tasks'] });
      invalidateDashboard();
      setImportStep('done');
    } catch (e: any) { alert(e.message); }
    finally { setImporting(false); }
  }

  const pastedRows = pastedText.trim()
    ? pastedText.trim().split('\n').filter(l => l.trim()).slice(0, 20).map(line => {
        const cols = line.split('\t').map(c => c.trim().replace(/^"|"$/g, ''));
        return { title: cols[0] ?? '', description: cols[1] ?? '', priority: cols[2] ?? '', dueDate: cols[3] ?? '' };
      })
    : [];

  const pastedChecklistRows = pastedText.trim()
    ? pastedText.trim().split('\n').filter(l => l.trim()).slice(0, 20).map(line => {
        const cols = line.split('\t').map(c => c.trim().replace(/^"|"$/g, ''));
        return { taskName: cols[0] ?? '', itemText: cols[1] ?? '' };
      })
    : [];

  function handleChecklistPastePreview() {
    if (!pastedText.trim()) return;
    const lines = pastedText.trim().split('\n').filter(l => l.trim());
    const counts: Record<string, number> = {};
    const parsed = lines.slice(0, 500).map((line) => {
      const cols = line.split('\t').map(c => c.trim().replace(/^"|"$/g, ''));
      const taskName = cols[0] ?? '';
      const itemText = cols[1] ?? '';
      if (!taskName || !itemText) {
        return { taskName, itemText, valid: false, reason: 'Missing task name or checklist item text' };
      }
      const key = taskName.toLowerCase();
      counts[key] = (counts[key] ?? 0) + 1;
      if (counts[key] > CHECKLIST_ITEM_CAP) {
        return { taskName, itemText, valid: false, reason: `Exceeds ${CHECKLIST_ITEM_CAP}-item cap for "${taskName}"` };
      }
      return { taskName, itemText, valid: true };
    });
    setParsedChecklistRows(parsed);
    setImportStep('preview');
  }

  async function handleChecklistImport() {
    const validRows = parsedChecklistRows.filter((r) => r.valid);
    if (!validRows.length) return;
    setImporting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const groupOrder: string[] = [];
      const groups = new Map<string, { taskName: string; items: string[] }>();
      for (const row of validRows) {
        const key = row.taskName.toLowerCase();
        if (!groups.has(key)) { groups.set(key, { taskName: row.taskName, items: [] }); groupOrder.push(key); }
        groups.get(key)!.items.push(row.itemText);
      }

      const { data: existingTasks, error: existingErr } = await supabase
        .from('tasks')
        .select('id, title')
        .eq('project_id', id);
      if (existingErr) throw existingErr;
      const existingByTitle = new Map((existingTasks ?? []).map((t: any) => [t.title.toLowerCase(), t.id]));

      const skipped: string[] = [];

      for (const key of groupOrder) {
        const group = groups.get(key)!;
        let taskId = existingByTitle.get(key);

        if (!taskId) {
          const { data: newTask, error: taskErr } = await supabase
            .from('tasks')
            .insert({ project_id: id, folder_id: selectedFolder || null, title: group.taskName, status: 'open', created_by: user!.id })
            .select('id')
            .single();
          if (taskErr) throw taskErr;
          taskId = newTask.id;
        }

        const { count: existingCount, error: countErr } = await supabase
          .from('checklist_items')
          .select('id', { count: 'exact', head: true })
          .eq('task_id', taskId);
        if (countErr) throw countErr;

        const remainingCapacity = Math.max(0, CHECKLIST_ITEM_CAP - (existingCount ?? 0));
        const itemsToInsert = group.items.slice(0, remainingCapacity);
        const droppedForCap = group.items.slice(remainingCapacity);
        if (droppedForCap.length > 0) {
          skipped.push(`${droppedForCap.length} item(s) for "${group.taskName}" (already at the ${CHECKLIST_ITEM_CAP}-item cap)`);
        }

        if (itemsToInsert.length > 0) {
          const { error: itemsErr } = await supabase.from('checklist_items').insert(
            itemsToInsert.map((text, i) => ({ task_id: taskId, item_text: text, sort_order: (existingCount ?? 0) + i }))
          );
          if (itemsErr) throw itemsErr;
        }
      }

      queryClient.invalidateQueries({ queryKey: ['web-folder-tasks', id] });
      queryClient.invalidateQueries({ queryKey: ['web-folders', id] });
      queryClient.invalidateQueries({ queryKey: ['web-calendar-tasks'] });
      invalidateDashboard();

      if (skipped.length > 0) {
        alert(`Imported, but some items were skipped:\n${skipped.join('\n')}`);
      }
      setImportStep('done');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setImporting(false);
    }
  }

  const statusColors: Record<string, string> = { open: '#6B7280', in_progress: '#F97316', completed: '#22C55E', active: '#22C55E', on_hold: '#F97316' };
  const statusLabels: Record<string, string> = { open: 'Open', in_progress: 'In Progress', completed: 'Done', active: 'Active', on_hold: 'On Hold' };
  const priorityColors: Record<string, string> = { low: '#6B7280', medium: '#F59E0B', high: '#EF4444' };
  const validCount = parsedTasks.filter((t) => t.valid).length;
  const progressColor = getProgressColor(projectProgress);

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', backgroundColor: '#1F2937',
    border: '1px solid #374151', borderRadius: 8, color: '#FFFFFF',
    fontSize: 14, outline: 'none', boxSizing: 'border-box',
  };

  const cellStyle: React.CSSProperties = { padding: 0, border: '1px solid #2D3748' };

  const cellInputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', backgroundColor: 'transparent',
    border: 'none', color: '#FFFFFF', fontSize: 13, outline: 'none',
    boxSizing: 'border-box', fontFamily: 'inherit',
  };

  const modalOverlay: React.CSSProperties = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex',
    justifyContent: 'center', alignItems: 'center', zIndex: 1000,
  };

  const modalBox: React.CSSProperties = {
    backgroundColor: '#111827', borderRadius: 16, padding: 32,
    width: '100%', maxWidth: 520, border: '1px solid #1F2937',
    maxHeight: '85vh', overflowY: 'auto',
  };

  return (
    <div style={{ padding: 32, color: '#FFFFFF' }}>
      <button onClick={() => navigate('/projects')} style={{ backgroundColor: 'transparent', border: 'none', color: '#F97316', fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 0, marginBottom: 16 }}>
        ← Back to Projects
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, marginBottom: 4 }}>{project?.name}</h1>
          {project?.description && <p style={{ color: '#6B7280', fontSize: 14, margin: 0 }}>{project.description}</p>}
          {project?.status && (
            <span style={{ display: 'inline-block', marginTop: 8, fontSize: 12, fontWeight: 700, color: statusColors[project.status], backgroundColor: statusColors[project.status] + '20', padding: '3px 10px', borderRadius: 20 }}>
              {statusLabels[project.status]}
            </span>
          )}
          {project?.project_type === 'checklist' && (
            <span style={{ display: 'inline-block', marginTop: 8, marginLeft: 8, fontSize: 12, fontWeight: 700, color: '#3B82F6', backgroundColor: '#3B82F620', padding: '3px 10px', borderRadius: 20 }}>
              ✅ Checklist Project
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {canEdit && <button onClick={() => { setEditName(project?.name ?? ''); setEditDescription(project?.description ?? ''); setEditStatus(project?.status ?? 'active'); setEditClientPhotosEnabled((project as any)?.client_photos_enabled ?? false); setShowEditProject(true); }} style={{ padding: '10px 16px', backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 10, color: '#9CA3AF', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>✏️ Edit</button>}
          {isAdmin && <button onClick={() => setShowInvite(!showInvite)} style={{ padding: '10px 16px', backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 10, color: '#9CA3AF', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>👥 Invite</button>}
          <button onClick={() => navigate(`/projects/${id}/chat`)} style={{ padding: '10px 16px', backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 10, color: '#9CA3AF', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>💬 Chat</button>
          <button onClick={() => navigate(`/projects/${id}/daily-reports`)} style={{ padding: '10px 16px', backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 10, color: '#9CA3AF', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>📋 Daily Reports</button>
          <button onClick={() => { setExportFolderFilter(selectedFolder ?? 'all'); setExportStatusFilter('all'); setExportIncludeArchived(false); setShowExportModal(true); }} style={{ padding: '10px 16px', backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 10, color: '#9CA3AF', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>📥 Export PDF</button>
          {canEdit && <button onClick={() => { resetImport(); setShowImport(true); }} style={{ padding: '10px 20px', backgroundColor: '#F97316', border: 'none', borderRadius: 10, color: '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>+ Add Tasks</button>}
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{ backgroundColor: '#111827', borderRadius: 14, padding: 20, border: '1px solid #1F2937', marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Project Progress</span>
          <span style={{ fontSize: 20, fontWeight: 900, color: progressColor }}>{projectProgress}%</span>
        </div>
        <div style={{ height: 8, backgroundColor: '#1F2937', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
          <div style={{ height: '100%', width: `${projectProgress}%`, backgroundColor: progressColor, borderRadius: 4, transition: 'width 0.5s ease' }} />
        </div>
        <span style={{ fontSize: 12, color: '#6B7280' }}>{completedTasks} of {totalTasks} tasks completed across {folders?.length ?? 0} folder{folders?.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Tab Bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1F2937', marginBottom: 24 }}>
        {[
          { key: 'tasks', label: 'Tasks' },
          { key: 'budget', label: 'Budget' },
          { key: 'change-orders', label: 'Change Orders' },
          { key: 'rfi', label: 'RFI Log' },
          { key: 'client-messages', label: 'Client Messages' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            style={{
              padding: '12px 20px',
              backgroundColor: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${activeTab === tab.key ? '#F97316' : 'transparent'}`,
              color: activeTab === tab.key ? '#F97316' : '#6B7280',
              fontSize: 14,
              fontWeight: activeTab === tab.key ? 700 : 500,
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div style={modalOverlay} onClick={() => setShowExportModal(false)}>
          <div style={{ ...modalBox, maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>📥 Export to PDF</h3>
              <button onClick={() => setShowExportModal(false)} style={{ backgroundColor: '#1F2937', border: 'none', borderRadius: 8, color: '#9CA3AF', fontSize: 16, cursor: 'pointer', padding: '4px 10px' }}>✕</button>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>FOLDER</label>
              <select
                value={exportFolderFilter}
                onChange={(e) => setExportFolderFilter(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="all">All Folders</option>
                {folders?.map((f: any) => (
                  <option key={f.id} value={f.id}>{f.name} ({f.task_count} tasks)</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>STATUS</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { value: 'all', label: 'All Statuses' },
                  { value: 'open', label: 'Open' },
                  { value: 'in_progress', label: 'In Progress' },
                  { value: 'completed', label: 'Done' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setExportStatusFilter(opt.value)}
                    style={{
                      padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      backgroundColor: exportStatusFilter === opt.value ? '#F9731620' : '#1F2937',
                      border: `1px solid ${exportStatusFilter === opt.value ? '#F97316' : '#374151'}`,
                      color: exportStatusFilter === opt.value ? '#F97316' : '#9CA3AF',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 28 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>OPTIONS</label>
              <button
                onClick={() => setExportIncludeArchived(!exportIncludeArchived)}
                style={{
                  padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  backgroundColor: exportIncludeArchived ? '#F9731620' : '#1F2937',
                  border: `1px solid ${exportIncludeArchived ? '#F97316' : '#374151'}`,
                  color: exportIncludeArchived ? '#F97316' : '#9CA3AF',
                }}
              >
                {exportIncludeArchived ? '✓' : '○'} Include Archived Tasks
              </button>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowExportModal(false)} style={{ flex: 1, padding: '12px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 10, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleExportPDF} style={{ flex: 2, padding: '12px', backgroundColor: '#F97316', border: 'none', borderRadius: 10, color: '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>📥 Download PDF</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Project Panel */}
      {showEditProject && canEdit && (
        <div style={{ backgroundColor: '#111827', borderRadius: 14, padding: 24, border: '1px solid #F97316', marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: 16, fontWeight: 700 }}>Edit Project</h3>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 }}>PROJECT NAME</label>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 }}>DESCRIPTION</label>
            <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 }}>STATUS</label>
            <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}>
              <option value="active">Active</option>
              <option value="on_hold">On Hold</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          {isAdmin && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 }}>CLIENT ACCESS</label>
              <button
                onClick={() => setEditClientPhotosEnabled(!editClientPhotosEnabled)}
                style={{ padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', backgroundColor: editClientPhotosEnabled ? '#F9731620' : '#1F2937', border: `1px solid ${editClientPhotosEnabled ? '#F97316' : '#374151'}`, color: editClientPhotosEnabled ? '#F97316' : '#9CA3AF' }}
              >
                {editClientPhotosEnabled ? '✓ Show site photos to client' : '○ Show site photos to client'}
              </button>
            </div>
          )}
          {isAdmin && project?.project_type === 'regular' && (
            <div style={{ marginBottom: 20, padding: 16, backgroundColor: '#7F1D1D15', border: '1px solid #EF444440', borderRadius: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#EF4444', letterSpacing: 2, marginBottom: 8 }}>DANGER ZONE</div>
              <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 12 }}>Switch this project to Tasks + Checklist mode. Existing tasks are kept — this only unlocks per-task checklists.</div>
              <button onClick={() => setShowConvertConfirm(true)} style={{ padding: '10px 16px', backgroundColor: 'transparent', border: '1px solid #EF4444', borderRadius: 8, color: '#EF4444', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Convert to Tasks + Checklist →</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setShowEditProject(false)} style={{ padding: '10px 20px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 10, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSaveProject} disabled={savingProject} style={{ padding: '10px 24px', backgroundColor: '#F97316', border: 'none', borderRadius: 10, color: '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>{savingProject ? 'Saving...' : 'Save Changes'}</button>
          </div>
        </div>
      )}

      {/* Convert to Checklist Confirm Modal */}
      {showConvertConfirm && isAdmin && (
        <div style={modalOverlay} onClick={() => !converting && setShowConvertConfirm(false)}>
          <div style={{ ...modalBox, maxWidth: 460, border: '1px solid #EF4444' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: 18, fontWeight: 800, color: '#EF4444' }}>⚠ Convert to Tasks + Checklist</h3>
            <p style={{ fontSize: 14, color: '#D1D5DB', lineHeight: 1.6, marginBottom: 12 }}>
              This is <strong>permanent and cannot be undone</strong>. Once converted, this project cannot be switched back to a Regular Project — for any user, at any time.
            </p>
            <p style={{ fontSize: 14, color: '#D1D5DB', lineHeight: 1.6, marginBottom: 24 }}>
              Existing tasks will not be deleted or changed — they'll simply become eligible to have checklists added, and can no longer be marked complete until their checklist items are resolved.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowConvertConfirm(false)} disabled={converting} style={{ flex: 1, padding: '12px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 10, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleConvertToChecklist} disabled={converting} style={{ flex: 2, padding: '12px', backgroundColor: '#EF4444', border: 'none', borderRadius: 10, color: '#FFFFFF', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>{converting ? 'Converting...' : 'Yes, Convert Permanently'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Panel */}
      {showInvite && isAdmin && (
        <div style={{ backgroundColor: '#111827', borderRadius: 14, padding: 24, border: '1px solid #1F2937', marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: 16, fontWeight: 700 }}>Invite to Project</h3>
          {/* Invite type toggle */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {(['team', 'client'] as const).map((t) => (
              <button key={t} onClick={() => setInviteType(t)} style={{ flex: 1, padding: '8px 12px', backgroundColor: inviteType === t ? (t === 'team' ? '#F9731620' : '#3B82F620') : '#1F2937', border: `1px solid ${inviteType === t ? (t === 'team' ? '#F97316' : '#3B82F6') : '#374151'}`, borderRadius: 8, color: inviteType === t ? (t === 'team' ? '#F97316' : '#3B82F6') : '#6B7280', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {t === 'team' ? '👷 Team Member' : '👔 Client'}
              </button>
            ))}
          </div>
          {inviteType === 'team' && teamMembers && teamMembers.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>CURRENT MEMBERS</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {teamMembers.map((m) => <span key={m.user_id} style={{ fontSize: 12, color: '#9CA3AF', backgroundColor: '#1F2937', padding: '4px 10px', borderRadius: 20 }}>{(m.profile as any)?.full_name ?? 'Unknown'}</span>)}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder={inviteType === 'team' ? 'worker@company.com' : 'client@company.com'} onKeyDown={(e) => e.key === 'Enter' && (inviteType === 'team' ? handleInvite() : handleInviteClient())} style={{ flex: 1, ...inputStyle, width: 'auto' }} />
            <button onClick={inviteType === 'team' ? handleInvite : handleInviteClient} disabled={inviting} style={{ padding: '10px 20px', backgroundColor: inviteType === 'team' ? '#F97316' : '#3B82F6', border: 'none', borderRadius: 8, color: '#FFFFFF', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>{inviting ? 'Adding...' : 'Add'}</button>
            <button onClick={() => { setShowInvite(false); setInviteType('team'); }} style={{ padding: '10px 16px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 8, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Task View Modal */}
      {viewTask && (
        <div style={modalOverlay} onClick={closeViewTask}>
          <div style={{ ...modalBox, maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, flex: 1, marginRight: 16 }}>{viewTask.title}</h3>
              <button onClick={closeViewTask} style={{ backgroundColor: '#1F2937', border: 'none', borderRadius: 8, color: '#9CA3AF', fontSize: 16, cursor: 'pointer', padding: '4px 10px' }}>✕</button>
            </div>
            {viewTask.description && <p style={{ color: '#9CA3AF', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px 0' }}>{viewTask.description}</p>}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: statusColors[viewTask.status], backgroundColor: statusColors[viewTask.status] + '20', padding: '4px 12px', borderRadius: 20 }}>{statusLabels[viewTask.status]}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: priorityColors[viewTask.priority], backgroundColor: priorityColors[viewTask.priority] + '20', padding: '4px 12px', borderRadius: 20 }}>{viewTask.priority} priority</span>
            </div>
            <div style={{ backgroundColor: '#0D1321', borderRadius: 10, padding: 16, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 10, borderBottom: '1px solid #1F2937', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: '#6B7280', fontWeight: 600 }}>ASSIGNED TO</span>
                <span style={{ fontSize: 13, color: '#FFFFFF', fontWeight: 600 }}>{(viewTask.assignee as any)?.full_name ?? 'Unassigned'}</span>
              </div>
              {viewTask.due_date && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: '#6B7280', fontWeight: 600 }}>DUE DATE</span>
                  <span style={{ fontSize: 13, color: '#FFFFFF', fontWeight: 600 }}>{new Date(viewTask.due_date).toLocaleDateString()}</span>
                </div>
              )}
            </div>
            {project?.project_type === 'checklist' && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#6B7280', letterSpacing: 2 }}>CHECKLIST</div>
                  <div style={{ fontSize: 12, color: '#4B5563' }}>{viewTaskChecklist.length}/{CHECKLIST_ITEM_CAP}</div>
                </div>
                {checklistLoading ? (
                  <div style={{ color: '#F97316', fontSize: 13 }}>Loading checklist...</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                    {viewTaskChecklist.length === 0 && (
                      <div style={{ padding: '12px 0', fontSize: 13, color: '#4B5563' }}>No checklist items yet — add at least one before this task can be marked complete.</div>
                    )}
                    {viewTaskChecklist.map((item) => (
                      <div key={item.id} style={{ backgroundColor: '#0D1321', border: '1px solid #1F2937', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 140 }}>
                          <div style={{ fontSize: 13, color: '#FFFFFF', marginBottom: 4 }}>{item.item_text}</div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: checklistStatusColors[item.status], backgroundColor: checklistStatusColors[item.status] + '20', padding: '2px 8px', borderRadius: 12 }}>
                            {checklistStatusLabels[item.status]}
                          </span>
                        </div>
                        {canEdit && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => handleToggleChecklistDone(item)} style={{ padding: '6px 10px', backgroundColor: item.status === 'done' ? '#22C55E20' : '#1F2937', border: `1px solid ${item.status === 'done' ? '#22C55E' : '#374151'}`, borderRadius: 6, color: item.status === 'done' ? '#22C55E' : '#9CA3AF', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                              {item.status === 'done' ? '✓ Done' : 'Mark Done'}
                            </button>
                            <button onClick={() => handleToggleChecklistMissingPart(item)} style={{ padding: '6px 10px', backgroundColor: item.status === 'missing_part' ? '#EF444420' : '#1F2937', border: `1px solid ${item.status === 'missing_part' ? '#EF4444' : '#374151'}`, borderRadius: 6, color: item.status === 'missing_part' ? '#EF4444' : '#9CA3AF', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                              {item.status === 'missing_part' ? 'Now Have Part' : "Don't Have Part"}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {canEdit && (
                  viewTaskChecklist.length >= CHECKLIST_ITEM_CAP ? (
                    <div style={{ fontSize: 12, color: '#F59E0B' }}>Checklist item limit reached ({CHECKLIST_ITEM_CAP} max).</div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        value={newChecklistItemText}
                        onChange={(e) => setNewChecklistItemText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddChecklistItem()}
                        placeholder="Add checklist item..."
                        style={{ flex: 1, padding: '8px 12px', backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 8, color: '#FFFFFF', fontSize: 13, outline: 'none' }}
                      />
                      <button onClick={handleAddChecklistItem} disabled={addingChecklistItem || !newChecklistItemText.trim()} style={{ padding: '8px 16px', backgroundColor: !newChecklistItemText.trim() || addingChecklistItem ? '#374151' : '#F97316', border: 'none', borderRadius: 8, color: !newChecklistItemText.trim() || addingChecklistItem ? '#6B7280' : '#0A0F1E', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                        {addingChecklistItem ? 'Adding...' : '+ Add'}
                      </button>
                    </div>
                  )
                )}
              </div>
            )}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 12 }}>PHOTOS {viewTaskPhotos.length > 0 ? `(${viewTaskPhotos.length})` : ''}</div>
              {photosLoading ? (
                <div style={{ color: '#F97316', fontSize: 13 }}>Loading photos...</div>
              ) : viewTaskPhotos.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  {viewTaskPhotos.map((photo: any) => (
                    <div key={photo.id} onClick={() => setViewingPhoto(photo.url)} style={{ aspectRatio: '1', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', backgroundColor: '#1F2937', border: '1px solid #374151' }}>
                      <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '16px 0', fontSize: 13, color: '#4B5563' }}>No photos attached to this task.</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {canEdit && <button onClick={() => { closeViewTask(); openEditTask(viewTask); }} style={{ flex: 1, padding: '12px', backgroundColor: '#F97316', border: 'none', borderRadius: 10, color: '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>Edit Task</button>}
              <button onClick={closeViewTask} style={{ padding: '12px 20px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 10, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>Close</button>
            </div>
          </div>
          {viewingPhoto && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.95)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }} onClick={() => setViewingPhoto(null)}>
              <button onClick={() => setViewingPhoto(null)} style={{ position: 'absolute', top: 24, right: 24, backgroundColor: '#1F2937', border: 'none', borderRadius: 20, color: '#FFFFFF', fontSize: 16, cursor: 'pointer', width: 40, height: 40 }}>✕</button>
              <img src={viewingPhoto} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8 }} onClick={(e) => e.stopPropagation()} />
            </div>
          )}
        </div>
      )}

      {/* Task Edit Modal */}
      {selectedTask && canEdit && (
        <div style={modalOverlay} onClick={() => setSelectedTask(null)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 20px 0', fontSize: 18, fontWeight: 700 }}>Edit Task</h3>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 }}>TITLE</label>
              <input value={editTaskTitle} onChange={(e) => setEditTaskTitle(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 }}>DESCRIPTION</label>
              <textarea value={editTaskDescription} onChange={(e) => setEditTaskDescription(e.target.value)} style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 }}>ASSIGN TO</label>
              <select value={editTaskAssignee} onChange={(e) => setEditTaskAssignee(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">Unassigned</option>
                {teamMembers?.map((m) => <option key={m.user_id} value={m.user_id}>{(m.profile as any)?.full_name ?? 'Unknown'}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 }}>DUE DATE (OPTIONAL)</label>
              <input type="date" value={editTaskDueDate} onChange={(e) => setEditTaskDueDate(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 14, marginBottom: 20 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 }}>STATUS</label>
                <select value={editTaskStatus} onChange={(e) => setEditTaskStatus(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Done</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 }}>PRIORITY</label>
                <select value={editTaskPriority} onChange={(e) => setEditTaskPriority(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setSelectedTask(null)} style={{ flex: 1, padding: '12px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 10, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleSaveTask} disabled={savingTask} style={{ flex: 2, padding: '12px', backgroundColor: '#F97316', border: 'none', borderRadius: 10, color: '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>{savingTask ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Tasks Panel */}
      {showImport && canEdit && (
        <div style={{ backgroundColor: '#111827', borderRadius: 14, padding: 24, border: '1px solid #1F2937', marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              + Add Tasks {selectedFolder ? `→ 📁 ${folders?.find((f: any) => f.id === selectedFolder)?.name}` : ''}
            </h3>
            <button onClick={resetImport} style={{ backgroundColor: 'transparent', border: 'none', color: '#6B7280', fontSize: 18, cursor: 'pointer' }}>✕</button>
          </div>
          {!selectedFolder && (
            <div style={{ backgroundColor: '#F59E0B15', border: '1px solid #F59E0B40', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#F59E0B' }}>
              💡 Select a folder on the left to add tasks into a specific folder
            </div>
          )}
          {!importMode && importStep === 'input' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <button onClick={() => setImportMode('manual')} style={{ padding: 20, backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 12, cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✏️</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#FFFFFF', marginBottom: 4 }}>Type Manually</div>
                <div style={{ fontSize: 12, color: '#6B7280' }}>Fill in a spreadsheet-style table row by row</div>
              </button>
              <button onClick={() => setImportMode('paste')} style={{ padding: 20, backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 12, cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#FFFFFF', marginBottom: 4 }}>Paste from Excel</div>
                <div style={{ fontSize: 12, color: '#6B7280' }}>Copy cells from Excel and paste into the table below</div>
              </button>
            </div>
          )}
          {importMode === 'manual' && importStep === 'input' && (
            <>
              <button onClick={() => setImportMode(null)} style={{ backgroundColor: 'transparent', border: 'none', color: '#F97316', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 14 }}>← Back</button>
              <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #374151' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#1A2235' }}>
                      <th style={{ width: 36, padding: '9px 8px', textAlign: 'center', fontSize: 11, color: '#4B5563', borderRight: '1px solid #2D3748', borderBottom: '2px solid #374151' }}></th>
                      {[{ label: 'Task Name', required: true }, { label: 'Description', required: false }, { label: 'Priority', required: false }, { label: 'Due Date', required: false }].map((col, ci) => (
                        <th key={ci} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: col.required ? '#F97316' : '#9CA3AF', borderRight: ci < 3 ? '1px solid #2D3748' : 'none', borderBottom: '2px solid #374151', whiteSpace: 'nowrap' }}>
                          {col.label}{col.required && <span style={{ color: '#EF4444', marginLeft: 2 }}>*</span>}
                        </th>
                      ))}
                      <th style={{ width: 32, borderBottom: '2px solid #374151' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {manualTasks.map((task, i) => (
                      <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#111827' : '#0D1321', borderBottom: '1px solid #1E2A3A' }}>
                        <td style={{ padding: '5px 8px', textAlign: 'center', fontSize: 11, color: '#374151', borderRight: '1px solid #1E2A3A', userSelect: 'none' }}>{i + 1}</td>
                        <td style={cellStyle}><input value={task.title} onChange={(e) => { const u = [...manualTasks]; u[i].title = e.target.value; setManualTasks(u); }} placeholder="Enter task name..." style={{ ...cellInputStyle, color: task.title ? '#FFFFFF' : '#4B5563', minWidth: 200 }} /></td>
                        <td style={{ ...cellStyle, borderLeft: '1px solid #1E2A3A' }}><input value={task.description} onChange={(e) => { const u = [...manualTasks]; u[i].description = e.target.value; setManualTasks(u); }} placeholder="Optional..." style={{ ...cellInputStyle, color: task.description ? '#D1D5DB' : '#4B5563', minWidth: 150 }} /></td>
                        <td style={{ ...cellStyle, borderLeft: '1px solid #1E2A3A', minWidth: 110 }}>
                          <select value={task.priority} onChange={(e) => { const u = [...manualTasks]; u[i].priority = e.target.value; setManualTasks(u); }} style={{ ...cellInputStyle, cursor: 'pointer', color: task.priority === 'high' ? '#EF4444' : task.priority === 'low' ? '#6B7280' : '#F59E0B' }}>
                            <option value="low">low</option>
                            <option value="medium">medium</option>
                            <option value="high">high</option>
                          </select>
                        </td>
                        <td style={{ ...cellStyle, borderLeft: '1px solid #1E2A3A' }}><input type="date" value={task.dueDate} onChange={(e) => { const u = [...manualTasks]; u[i].dueDate = e.target.value; setManualTasks(u); }} style={{ ...cellInputStyle, color: task.dueDate ? '#D1D5DB' : '#4B5563', minWidth: 130 }} /></td>
                        <td style={{ padding: '4px 6px', borderLeft: '1px solid #1E2A3A' }}>
                          {manualTasks.length > 1 && <button onClick={() => setManualTasks(manualTasks.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}>✕</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
                <button onClick={() => setManualTasks([...manualTasks, { title: '', description: '', priority: 'medium', dueDate: '' }])} style={{ padding: '7px 14px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 8, color: '#9CA3AF', fontSize: 12, cursor: 'pointer' }}>+ Add Row</button>
                <button onClick={handleSaveManual} disabled={importing || !manualTasks.some(t => t.title.trim())} style={{ padding: '10px 24px', backgroundColor: !manualTasks.some(t => t.title.trim()) || importing ? '#374151' : '#F97316', border: 'none', borderRadius: 10, color: !manualTasks.some(t => t.title.trim()) || importing ? '#6B7280' : '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: importing ? 'not-allowed' : 'pointer' }}>
                  {importing ? 'Saving...' : `Save ${manualTasks.filter(t => t.title.trim()).length} Task${manualTasks.filter(t => t.title.trim()).length !== 1 ? 's' : ''}`}
                </button>
                {manualTasks.some(t => t.title.trim()) && <span style={{ fontSize: 12, color: '#22C55E', fontWeight: 600 }}>✅ {manualTasks.filter(t => t.title.trim()).length} ready</span>}
              </div>
            </>
          )}
          {importMode === 'paste' && importStep === 'input' && (
            <>
              <button onClick={() => setImportMode(null)} style={{ backgroundColor: 'transparent', border: 'none', color: '#F97316', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 14 }}>← Back</button>
              {project?.project_type === 'checklist' && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <button onClick={() => { setImportFormat('tasks'); setPastedText(''); }} style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', backgroundColor: importFormat === 'tasks' ? '#F9731620' : '#1F2937', border: `1px solid ${importFormat === 'tasks' ? '#F97316' : '#374151'}`, color: importFormat === 'tasks' ? '#F97316' : '#9CA3AF' }}>Tasks Only</button>
                  <button onClick={() => { setImportFormat('checklist'); setPastedText(''); }} style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', backgroundColor: importFormat === 'checklist' ? '#F9731620' : '#1F2937', border: `1px solid ${importFormat === 'checklist' ? '#F97316' : '#374151'}`, color: importFormat === 'checklist' ? '#F97316' : '#9CA3AF' }}>Tasks + Checklist Items</button>
                </div>
              )}
              {importFormat === 'tasks' ? (
                <>
                  <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 10 }}>Copy cells from Excel → click the table below → press <strong style={{ color: '#FFFFFF' }}>Ctrl+V</strong></div>
                  <div style={{ overflowX: 'auto', borderRadius: 8, border: `2px solid ${pastedText ? '#22C55E' : '#374151'}`, cursor: 'text', outline: 'none', position: 'relative' }} tabIndex={0} onPaste={(e) => { e.preventDefault(); const text = e.clipboardData.getData('text'); setPastedText(text); }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                      <thead>
                        <tr style={{ backgroundColor: '#1A2235' }}>
                          <th style={{ width: 36, padding: '9px 8px', textAlign: 'center', fontSize: 11, color: '#4B5563', borderRight: '1px solid #2D3748', borderBottom: '2px solid #374151' }}></th>
                          {[{ label: 'A — Task Name', required: true }, { label: 'B — Description', required: false }, { label: 'C — Priority', required: false }, { label: 'D — Due Date (YYYY-MM-DD)', required: false }].map((col, ci) => (
                            <th key={ci} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: col.required ? '#F97316' : '#9CA3AF', borderRight: ci < 3 ? '1px solid #2D3748' : 'none', borderBottom: '2px solid #374151', whiteSpace: 'nowrap' }}>
                              {col.label}{col.required && <span style={{ color: '#EF4444', marginLeft: 2 }}>*</span>}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pastedRows.length > 0
                          ? pastedRows.map((row, i) => (
                              <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#111827' : '#0D1321', borderBottom: '1px solid #1E2A3A' }}>
                                <td style={{ padding: '7px 8px', textAlign: 'center', fontSize: 11, color: '#4B5563', borderRight: '1px solid #1E2A3A', userSelect: 'none' }}>{i + 1}</td>
                                <td style={{ padding: '7px 12px', fontSize: 13, color: row.title ? '#FFFFFF' : '#374151', borderRight: '1px solid #1E2A3A' }}>{row.title || ''}</td>
                                <td style={{ padding: '7px 12px', fontSize: 13, color: row.description ? '#D1D5DB' : '#374151', borderRight: '1px solid #1E2A3A' }}>{row.description || ''}</td>
                                <td style={{ padding: '7px 12px', fontSize: 13, color: row.priority === 'high' ? '#EF4444' : row.priority === 'low' ? '#6B7280' : row.priority ? '#F59E0B' : '#374151', borderRight: '1px solid #1E2A3A' }}>{row.priority || ''}</td>
                                <td style={{ padding: '7px 12px', fontSize: 13, color: row.dueDate ? '#D1D5DB' : '#374151' }}>{row.dueDate || ''}</td>
                              </tr>
                            ))
                          : [1, 2, 3, 4, 5, 6, 7, 8].map((row) => (
                              <tr key={row} style={{ backgroundColor: row % 2 === 0 ? '#0D1321' : '#111827', borderBottom: '1px solid #1E2A3A' }}>
                                <td style={{ padding: '7px 8px', textAlign: 'center', fontSize: 11, color: '#374151', borderRight: '1px solid #1E2A3A', userSelect: 'none' }}>{row}</td>
                                <td style={{ padding: '7px 12px', borderRight: '1px solid #1E2A3A', height: 34 }}></td>
                                <td style={{ padding: '7px 12px', borderRight: '1px solid #1E2A3A' }}></td>
                                <td style={{ padding: '7px 12px', borderRight: '1px solid #1E2A3A' }}></td>
                                <td style={{ padding: '7px 12px' }}></td>
                              </tr>
                            ))
                        }
                      </tbody>
                    </table>
                    {!pastedText && (
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        <div style={{ backgroundColor: '#1A2235CC', borderRadius: 8, padding: '10px 20px', fontSize: 13, color: '#9CA3AF', fontWeight: 600, textAlign: 'center' }}>
                          👆 Click here then press Ctrl+V to paste your Excel data
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
                    {pastedText ? <span style={{ fontSize: 12, color: '#22C55E', fontWeight: 600 }}>✅ {pastedText.trim().split('\n').filter(l => l.trim()).length} rows detected</span> : <span style={{ fontSize: 12, color: '#6B7280' }}>Click the table and paste with Ctrl+V</span>}
                    {pastedText && <button onClick={() => setPastedText('')} style={{ padding: '4px 10px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 6, color: '#6B7280', fontSize: 11, cursor: 'pointer' }}>Clear</button>}
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <button onClick={handlePastePreview} disabled={!pastedText.trim()} style={{ padding: '10px 24px', backgroundColor: pastedText.trim() ? '#F97316' : '#374151', border: 'none', borderRadius: 10, color: pastedText.trim() ? '#0A0F1E' : '#6B7280', fontSize: 14, fontWeight: 700, cursor: pastedText.trim() ? 'pointer' : 'not-allowed' }}>Preview Tasks →</button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 10 }}>Two columns: Task name, then Checklist Item. Repeat the task name on each row that adds another item to it. Copy from Excel → click the table below → press <strong style={{ color: '#FFFFFF' }}>Ctrl+V</strong></div>
                  <div style={{ overflowX: 'auto', borderRadius: 8, border: `2px solid ${pastedText ? '#22C55E' : '#374151'}`, cursor: 'text', outline: 'none', position: 'relative' }} tabIndex={0} onPaste={(e) => { e.preventDefault(); const text = e.clipboardData.getData('text'); setPastedText(text); }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
                      <thead>
                        <tr style={{ backgroundColor: '#1A2235' }}>
                          <th style={{ width: 36, padding: '9px 8px', textAlign: 'center', fontSize: 11, color: '#4B5563', borderRight: '1px solid #2D3748', borderBottom: '2px solid #374151' }}></th>
                          {[{ label: 'A — Task Name', required: true }, { label: 'B — Checklist Item', required: true }].map((col, ci) => (
                            <th key={ci} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#F97316', borderRight: ci < 1 ? '1px solid #2D3748' : 'none', borderBottom: '2px solid #374151', whiteSpace: 'nowrap' }}>
                              {col.label}<span style={{ color: '#EF4444', marginLeft: 2 }}>*</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pastedChecklistRows.length > 0
                          ? pastedChecklistRows.map((row, i) => (
                              <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#111827' : '#0D1321', borderBottom: '1px solid #1E2A3A' }}>
                                <td style={{ padding: '7px 8px', textAlign: 'center', fontSize: 11, color: '#4B5563', borderRight: '1px solid #1E2A3A', userSelect: 'none' }}>{i + 1}</td>
                                <td style={{ padding: '7px 12px', fontSize: 13, color: row.taskName ? '#FFFFFF' : '#374151', borderRight: '1px solid #1E2A3A' }}>{row.taskName || ''}</td>
                                <td style={{ padding: '7px 12px', fontSize: 13, color: row.itemText ? '#D1D5DB' : '#374151' }}>{row.itemText || ''}</td>
                              </tr>
                            ))
                          : [1, 2, 3, 4, 5, 6, 7, 8].map((row) => (
                              <tr key={row} style={{ backgroundColor: row % 2 === 0 ? '#0D1321' : '#111827', borderBottom: '1px solid #1E2A3A' }}>
                                <td style={{ padding: '7px 8px', textAlign: 'center', fontSize: 11, color: '#374151', borderRight: '1px solid #1E2A3A', userSelect: 'none' }}>{row}</td>
                                <td style={{ padding: '7px 12px', borderRight: '1px solid #1E2A3A', height: 34 }}></td>
                                <td style={{ padding: '7px 12px' }}></td>
                              </tr>
                            ))
                        }
                      </tbody>
                    </table>
                    {!pastedText && (
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        <div style={{ backgroundColor: '#1A2235CC', borderRadius: 8, padding: '10px 20px', fontSize: 13, color: '#9CA3AF', fontWeight: 600, textAlign: 'center' }}>
                          👆 Click here then press Ctrl+V to paste your Excel data
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
                    {pastedText ? <span style={{ fontSize: 12, color: '#22C55E', fontWeight: 600 }}>✅ {pastedText.trim().split('\n').filter(l => l.trim()).length} rows detected</span> : <span style={{ fontSize: 12, color: '#6B7280' }}>Click the table and paste with Ctrl+V</span>}
                    {pastedText && <button onClick={() => setPastedText('')} style={{ padding: '4px 10px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 6, color: '#6B7280', fontSize: 11, cursor: 'pointer' }}>Clear</button>}
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <button onClick={handleChecklistPastePreview} disabled={!pastedText.trim()} style={{ padding: '10px 24px', backgroundColor: pastedText.trim() ? '#F97316' : '#374151', border: 'none', borderRadius: 10, color: pastedText.trim() ? '#0A0F1E' : '#6B7280', fontSize: 14, fontWeight: 700, cursor: pastedText.trim() ? 'pointer' : 'not-allowed' }}>Preview →</button>
                  </div>
                </>
              )}
            </>
          )}
          {importStep === 'preview' && importFormat === 'tasks' && (
            <>
              <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 28, fontWeight: 900, color: '#22C55E' }}>{validCount}</div><div style={{ fontSize: 12, color: '#6B7280' }}>Ready</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 28, fontWeight: 900, color: '#EF4444' }}>{parsedTasks.length - validCount}</div><div style={{ fontSize: 12, color: '#6B7280' }}>Skipped</div></div>
              </div>
              <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #374151', marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#1A2235' }}>
                      {['Task Name', 'Description', 'Priority', 'Due Date', 'Status'].map((h, i) => (
                        <th key={i} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6B7280', borderBottom: '1px solid #374151', borderRight: i < 4 ? '1px solid #2D3748' : 'none' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedTasks.map((task, i) => (
                      <tr key={i} style={{ backgroundColor: task.valid ? (i % 2 === 0 ? '#111827' : '#0D1321') : '#2D1515', borderBottom: '1px solid #1E2A3A' }}>
                        <td style={{ padding: '7px 12px', fontSize: 13, color: task.valid ? '#FFFFFF' : '#6B7280', borderRight: '1px solid #1E2A3A' }}>{task.title || '(empty)'}</td>
                        <td style={{ padding: '7px 12px', fontSize: 12, color: '#9CA3AF', borderRight: '1px solid #1E2A3A' }}>{task.description || '—'}</td>
                        <td style={{ padding: '7px 12px', fontSize: 12, borderRight: '1px solid #1E2A3A' }}><span style={{ color: task.priority === 'high' ? '#EF4444' : task.priority === 'low' ? '#6B7280' : '#F59E0B', fontWeight: 700 }}>{task.priority}</span></td>
                        <td style={{ padding: '7px 12px', fontSize: 12, color: '#9CA3AF', borderRight: '1px solid #1E2A3A' }}>{task.dueDate || '—'}</td>
                        <td style={{ padding: '7px 12px', fontSize: 11, fontWeight: 700 }}>{task.valid ? <span style={{ color: '#22C55E' }}>✅ Ready</span> : <span style={{ color: '#EF4444' }}>⏭ Skip</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setImportStep('input')} style={{ padding: '10px 20px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 10, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>← Edit</button>
                <button onClick={handleImport} disabled={importing || validCount === 0} style={{ flex: 1, padding: '10px 24px', backgroundColor: importing || validCount === 0 ? '#374151' : '#F97316', border: 'none', borderRadius: 10, color: importing || validCount === 0 ? '#6B7280' : '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: importing || validCount === 0 ? 'not-allowed' : 'pointer' }}>
                  {importing ? 'Importing...' : `Import ${validCount} Tasks`}
                </button>
              </div>
            </>
          )}
          {importStep === 'preview' && importFormat === 'checklist' && (
            <>
              <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 28, fontWeight: 900, color: '#22C55E' }}>{parsedChecklistRows.filter(r => r.valid).length}</div><div style={{ fontSize: 12, color: '#6B7280' }}>Ready</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 28, fontWeight: 900, color: '#EF4444' }}>{parsedChecklistRows.filter(r => !r.valid).length}</div><div style={{ fontSize: 12, color: '#6B7280' }}>Skipped</div></div>
              </div>
              <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #374151', marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#1A2235' }}>
                      {['Task Name', 'Checklist Item', 'Status'].map((h, i) => (
                        <th key={i} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6B7280', borderBottom: '1px solid #374151', borderRight: i < 2 ? '1px solid #2D3748' : 'none' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedChecklistRows.map((row, i) => (
                      <tr key={i} style={{ backgroundColor: row.valid ? (i % 2 === 0 ? '#111827' : '#0D1321') : '#2D1515', borderBottom: '1px solid #1E2A3A' }}>
                        <td style={{ padding: '7px 12px', fontSize: 13, color: row.valid ? '#FFFFFF' : '#6B7280', borderRight: '1px solid #1E2A3A' }}>{row.taskName || '(empty)'}</td>
                        <td style={{ padding: '7px 12px', fontSize: 13, color: row.valid ? '#D1D5DB' : '#6B7280', borderRight: '1px solid #1E2A3A' }}>{row.itemText || '(empty)'}</td>
                        <td style={{ padding: '7px 12px', fontSize: 11, fontWeight: 700 }}>{row.valid ? <span style={{ color: '#22C55E' }}>✅ Ready</span> : <span style={{ color: '#EF4444' }} title={row.reason}>⏭ {row.reason ?? 'Skip'}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setImportStep('input')} style={{ padding: '10px 20px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 10, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>← Edit</button>
                <button onClick={handleChecklistImport} disabled={importing || parsedChecklistRows.filter(r => r.valid).length === 0} style={{ flex: 1, padding: '10px 24px', backgroundColor: importing || parsedChecklistRows.filter(r => r.valid).length === 0 ? '#374151' : '#F97316', border: 'none', borderRadius: 10, color: importing || parsedChecklistRows.filter(r => r.valid).length === 0 ? '#6B7280' : '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: importing || parsedChecklistRows.filter(r => r.valid).length === 0 ? 'not-allowed' : 'pointer' }}>
                  {importing ? 'Importing...' : `Import ${parsedChecklistRows.filter(r => r.valid).length} Items`}
                </button>
              </div>
            </>
          )}
          {importStep === 'done' && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
                {importFormat === 'checklist'
                  ? `${parsedChecklistRows.filter(r => r.valid).length} Checklist Items Added!`
                  : `${parsedTasks.filter(t => t.valid !== false).length} Tasks Added!`}
              </div>
              <button onClick={resetImport} style={{ padding: '10px 24px', backgroundColor: '#F97316', border: 'none', borderRadius: 10, color: '#0A0F1E', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Done</button>
            </div>
          )}
        </div>
      )}

      {/* Budget Tab */}
      {activeTab === 'budget' && (
        <ProjectBudgetTab projectId={id ?? ''} isAdmin={!!isAdmin} canEdit={!!canEdit} />
      )}

      {/* Change Orders Tab */}
      {activeTab === 'change-orders' && (
        <ProjectChangeOrdersTab projectId={id ?? ''} isAdmin={!!isAdmin} canEdit={!!canEdit} teamMembers={teamMembers ?? []} />
      )}

      {/* RFI Tab */}
      {activeTab === 'rfi' && (
        <ProjectRFITab projectId={id ?? ''} isAdmin={!!isAdmin} canEdit={!!canEdit} />
      )}

      {/* Client Messages Tab */}
      {activeTab === 'client-messages' && (
        <ProjectClientMessagesTab projectId={id ?? ''} isAdmin={!!isAdmin} />
      )}

      {/* Tasks Tab — Main Layout */}
      {activeTab === 'tasks' && <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
        {/* Folders Panel */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Folders</h2>
            {isAdmin && <button onClick={() => setShowCreateFolder(true)} style={{ padding: '6px 12px', backgroundColor: '#F97316', border: 'none', borderRadius: 8, color: '#0A0F1E', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>+ New</button>}
          </div>
          {showCreateFolder && (
            <div style={{ backgroundColor: '#111827', borderRadius: 10, padding: 14, border: '1px solid #F97316', marginBottom: 12 }}>
              <input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="Folder name..." onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()} style={{ ...inputStyle, marginBottom: 10 }} autoFocus />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setShowCreateFolder(false); setNewFolderName(''); }} style={{ flex: 1, padding: '8px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 8, color: '#6B7280', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                <button onClick={handleCreateFolder} disabled={creatingFolder} style={{ flex: 1, padding: '8px', backgroundColor: '#F97316', border: 'none', borderRadius: 8, color: '#0A0F1E', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{creatingFolder ? '...' : 'Create'}</button>
              </div>
            </div>
          )}
          {editingFolder && (
            <div style={{ backgroundColor: '#111827', borderRadius: 10, padding: 14, border: '1px solid #F97316', marginBottom: 12 }}>
              <input value={editFolderName} onChange={(e) => setEditFolderName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleRenameFolder()} style={{ ...inputStyle, marginBottom: 10 }} autoFocus />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setEditingFolder(null)} style={{ flex: 1, padding: '8px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 8, color: '#6B7280', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                <button onClick={handleRenameFolder} style={{ flex: 1, padding: '8px', backgroundColor: '#F97316', border: 'none', borderRadius: 8, color: '#0A0F1E', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Save</button>
              </div>
            </div>
          )}
          <button onClick={() => setSelectedFolder(null)} style={{ width: '100%', padding: '12px 14px', backgroundColor: !selectedFolder ? '#F9731620' : '#111827', border: '1px solid', borderColor: !selectedFolder ? '#F97316' : '#1F2937', borderRadius: 10, color: !selectedFolder ? '#F97316' : '#9CA3AF', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left', marginBottom: 8 }}>
            📋 All Tasks
          </button>
          {foldersLoading ? (
            <div style={{ color: '#F97316', padding: 12 }}>Loading...</div>
          ) : (
            folders?.map((folder: any) => {
              const pct = folder.task_count > 0 ? Math.round((folder.completed_count / folder.task_count) * 100) : 0;
              const color = getProgressColor(pct);
              const isSelected = selectedFolder === folder.id;
              return (
                <div key={folder.id} style={{ marginBottom: 8 }}>
                  <button onClick={() => setSelectedFolder(folder.id)} style={{ width: '100%', padding: '12px 14px', backgroundColor: isSelected ? '#F9731620' : '#111827', border: '1px solid', borderColor: isSelected ? '#F97316' : '#1F2937', borderRadius: 10, cursor: 'pointer', textAlign: 'left' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: isSelected ? '#F97316' : '#FFFFFF' }}>📁 {folder.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color }}>{pct}%</span>
                    </div>
                    <div style={{ height: 4, backgroundColor: '#1F2937', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                      <div style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 11, color: '#6B7280' }}>{folder.task_count} tasks • {folder.completed_count} done</span>
                  </button>
                  {isAdmin && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                      <button onClick={() => { setEditingFolder(folder); setEditFolderName(folder.name); }} style={{ flex: 1, padding: '4px 8px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 6, color: '#6B7280', fontSize: 11, cursor: 'pointer' }}>Rename</button>
                      <button onClick={() => handleDeleteFolder(folder)} style={{ flex: 1, padding: '4px 8px', backgroundColor: 'transparent', border: '1px solid #EF4444', borderRadius: 6, color: '#EF4444', fontSize: 11, cursor: 'pointer' }}>Delete</button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Tasks Panel */}
        <div style={{ backgroundColor: '#111827', borderRadius: 14, border: '1px solid #1F2937', overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid #1F2937' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                {selectedFolder ? `📁 ${(folders as any[])?.find((f: any) => f.id === selectedFolder)?.name ?? 'Folder'}` : '📋 All Tasks'}
                {filteredTasks ? ` (${filteredTasks.length})` : ''}
              </h2>
              {isAdmin && (
                <button onClick={() => setShowArchivedTasks(!showArchivedTasks)} style={{ padding: '8px 14px', backgroundColor: showArchivedTasks ? '#F97316' : 'transparent', border: '1px solid', borderColor: showArchivedTasks ? '#F97316' : '#374151', borderRadius: 8, color: showArchivedTasks ? '#0A0F1E' : '#6B7280', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  {showArchivedTasks ? '← Active Tasks' : '📦 Archived'}
                </button>
              )}
            </div>
            <input type="text" placeholder="Search tasks..." value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} style={{ width: '100%', padding: '10px 14px', backgroundColor: '#0D1321', border: '1px solid #1F2937', borderRadius: 8, color: '#FFFFFF', fontSize: 14, outline: 'none', boxSizing: 'border-box' as const }} />
          </div>
          {tasksLoading ? (
            <div style={{ padding: 24, color: '#F97316' }}>Loading tasks...</div>
          ) : filteredTasks?.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#4B5563' }}>
              {taskSearch ? `No tasks match "${taskSearch}"` : showArchivedTasks ? 'No archived tasks.' : canEdit ? 'No tasks yet. Click "+ Add Tasks" to get started.' : 'No tasks have been created yet.'}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#0D1321' }}>
                  {['Task', 'Priority', 'Due Date', 'Status', 'Assigned To', ''].map((h) => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 1 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTasks?.map((task: any, i: number) => {
                  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed';
                  return (
                    <tr key={task.id} style={{ borderTop: '1px solid #1F2937', backgroundColor: i % 2 === 0 ? 'transparent' : '#0D132120' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{task.title}</div>
                        {task.description && <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{task.description.slice(0, 50)}{task.description.length > 50 ? '...' : ''}</div>}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: priorityColors[task.priority], backgroundColor: priorityColors[task.priority] + '20', padding: '3px 8px', borderRadius: 6 }}>{task.priority}</span>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 12, color: isOverdue ? '#EF4444' : '#9CA3AF', fontWeight: isOverdue ? 700 : 400 }}>
                        {task.due_date ? `${isOverdue ? '⚠️ ' : ''}${new Date(task.due_date).toLocaleDateString()}` : '—'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {!showArchivedTasks ? (
                          <select value={task.status} onChange={(e) => updateStatus({ taskId: task.id, status: e.target.value })} style={{ backgroundColor: statusColors[task.status] + '20', border: `1px solid ${statusColors[task.status]}`, borderRadius: 20, color: statusColors[task.status], padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', outline: 'none' }}>
                            <option value="open">Open</option>
                            <option value="in_progress">In Progress</option>
                            <option value="completed">Done</option>
                          </select>
                        ) : (
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#22C55E', backgroundColor: '#22C55E20', padding: '3px 10px', borderRadius: 20 }}>Archived</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: '#9CA3AF' }}>{(task.assignee as any)?.full_name ?? 'Unassigned'}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {!showArchivedTasks && (
                            <>
                              <button onClick={() => openViewTask(task)} style={{ padding: '6px 14px', backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 8, color: '#9CA3AF', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>View</button>
                              {canEdit && <button onClick={() => openEditTask(task)} style={{ padding: '6px 14px', backgroundColor: '#F9731620', border: '1px solid #F97316', borderRadius: 8, color: '#F97316', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Edit</button>}
                              {isAdmin && <button onClick={() => handleArchiveTask(task)} style={{ padding: '6px 14px', backgroundColor: 'transparent', border: '1px solid #6B7280', borderRadius: 8, color: '#6B7280', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Archive</button>}
                            </>
                          )}
                          {showArchivedTasks && isAdmin && (
                            <>
                              <button onClick={() => handleRestoreTask(task)} style={{ padding: '6px 14px', backgroundColor: '#22C55E20', border: '1px solid #22C55E', borderRadius: 8, color: '#22C55E', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>↩ Restore</button>
                              <button onClick={() => handleDeleteTask(task)} style={{ padding: '6px 14px', backgroundColor: '#EF444420', border: '1px solid #EF4444', borderRadius: 8, color: '#EF4444', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>🗑 Delete</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>}
    </div>
  );
}