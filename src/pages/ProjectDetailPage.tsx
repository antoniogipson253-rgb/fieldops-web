import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useIsAdmin, useIsProjectOwner, useIsProjectManager } from '../lib/useIsAdmin';
import { ProjectBudgetTab } from './tabs/ProjectBudgetTab';
import { ProjectChangeOrdersTab } from './tabs/ProjectChangeOrdersTab';
import { ProjectRFITab } from './tabs/ProjectRFITab';
import { ProjectClientMessagesTab } from './tabs/ProjectClientMessagesTab';
import { DailyReportSettings } from '../components/DailyReportSettings';
import { FolderChecklistEditor } from '../components/FolderChecklistEditor';
import FolderPanel from '../components/FolderPanel';
import { formatDateOnly, isPastDue, localDateKey } from '../lib/dates';
import { exactCount, fetchAllPages } from '../lib/fetchAllPages';
import { useIsMobile } from '../hooks/useIsMobile';
import { btn, card, chip, colors, fonts, input as inputBase, radius, sectionLabel, statusColor } from '../theme';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusChip from '../components/ui/StatusChip';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import AvatarStack from '../components/ui/AvatarStack';
import Icon from '../components/ui/Icon';

// The checklist-completion DB trigger raises errcode 'CHK01' when a checklist-type
// task can't be marked complete (no items yet, or items still unresolved) — surface
// that distinctly from any other update failure on the same mutation.
function describeTaskError(e: any): string {
  if (e?.code === 'CHK01') {
    return `Checklist incomplete — ${e.message}`;
  }
  return e?.message ?? 'Something went wrong.';
}

// task_assignees is embedded as task_assignees(user_id, profile:profiles(id, full_name)).
// Formatting decision: comma-separated names, "Unassigned" when empty — flagged for
// confirmation, easy to change to a stacked/chip list later if preferred.
function taskAssigneeProfiles(task: any): { id: string; full_name: string }[] {
  return (task?.task_assignees ?? []).map((ta: any) => ta.profile).filter(Boolean);
}
function taskAssigneeNames(task: any): string {
  const names = taskAssigneeProfiles(task).map((p) => p.full_name).filter(Boolean);
  return names.length > 0 ? names.join(', ') : 'Unassigned';
}

/** Checklist progress embedded by the tasks query, e.g. { done: 3, total: 5 }. */
function checklistProgress(task: any): { done: number; total: number } {
  const total = task?.ci_total?.[0]?.count ?? 0;
  const done = task?.ci_done?.[0]?.count ?? 0;
  return { done, total };
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

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
  const [folderDeleteBlock, setFolderDeleteBlock] = useState<{ folderId: string; message: string } | null>(null);
  const [showFolderChecklistEditor, setShowFolderChecklistEditor] = useState(false);
  const [folderSheetOpen, setFolderSheetOpen] = useState(false);
  useEffect(() => {
    if (!folderSheetOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFolderSheetOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [folderSheetOpen]);
  const [downloadingSheet, setDownloadingSheet] = useState(false);
  const [downloadSheetError, setDownloadSheetError] = useState<string | null>(null);
  const [taskSearch, setTaskSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'tasks' | 'budget' | 'change-orders' | 'rfi' | 'client-messages'>('tasks');

  const [showImport, setShowImport] = useState(false);
  const [importMode, setImportMode] = useState<'paste' | 'manual' | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [parsedTasks, setParsedTasks] = useState<any[]>([]);
  const [importStep, setImportStep] = useState<'input' | 'preview' | 'done' | 'assign-checklist'>('input');
  const [importing, setImporting] = useState(false);
  const [manualTasks, setManualTasks] = useState([{ title: '', description: '', priority: 'medium', dueDate: '', checklistItems: [] as string[], newItemDraft: '' }]);

  // Post-import checklist assignment (checklist-type projects only): after tasks are
  // created via paste import, the user picks one task at a time from a dropdown and
  // types/pastes its checklist items — the task is always explicit, never inferred
  // from pasted text, so there's no row-to-task grouping logic left to get wrong.
  const [assignableTasks, setAssignableTasks] = useState<{ id: string; title: string }[]>([]);
  const [assignTasksLoading, setAssignTasksLoading] = useState(false);
  const [selectedAssignTaskId, setSelectedAssignTaskId] = useState('');
  const [assignItemsText, setAssignItemsText] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);

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
  const [editTaskAssigneeIds, setEditTaskAssigneeIds] = useState<string[]>([]);
  const [savingTask, setSavingTask] = useState(false);

  const invalidateDashboard = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-dash-progress'] });
    queryClient.invalidateQueries({ queryKey: ['admin-dash-stats'] });
    queryClient.invalidateQueries({ queryKey: ['pm-dash-progress'] });
  };

  // Shared by every call site that can set a task's status to 'completed'
  // (inline status dropdown, Edit Task modal, Archive). Only offered to
  // admin/PM — everyone else stays blocked with the plain CHK01 message.
  async function completeTaskViaOverrideIfAllowed(taskId: string): Promise<boolean> {
    if (!isAdmin && !isPM) return false;
    const confirmed = window.confirm(
      "This task's checklist is empty or incomplete. Override and mark it complete anyway?\n\nThis bypasses the checklist requirement for this task only."
    );
    if (!confirmed) return false;
    const { error } = await supabase.rpc('complete_task_with_override', { p_task_id: taskId });
    if (error) throw error;
    return true;
  }

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
      // The API returns at most 1000 rows per request, so the task rows behind the folder counts are
      // read in pages until the last one; otherwise projects with more than 1000 tasks get short counts.
      const [foldersRes, tasks] = await Promise.all([
        supabase.from('folders').select('*').eq('project_id', id).order('created_at', { ascending: true }),
        fetchAllPages<{ id: string; folder_id: string | null; status: string; archived: boolean }>((from, to) =>
          supabase.from('tasks').select('id, folder_id, status, archived').eq('project_id', id).order('id').range(from, to)),
      ]);
      if (foldersRes.error) throw foldersRes.error;
      const folders = foldersRes.data ?? [];
      return folders.map((folder) => {
        const folderTasks = tasks.filter((t) => t.folder_id === folder.id);
        const completedTasks = folderTasks.filter((t) => t.status === 'completed' || t.archived);
        // Counted from the rows already fetched above (no extra request), for the In progress stat card.
        const inProgressTasks = folderTasks.filter((t) => t.status === 'in_progress' && !t.archived);
        // Shown in the folder panel: the same rows the task list shows (active, or archived in the archived view).
        const activeCount = folderTasks.filter((t) => !t.archived).length;
        return { ...folder, task_count: folderTasks.length, completed_count: completedTasks.length, in_progress_count: inProgressTasks.length, active_count: activeCount, archived_count: folderTasks.length - activeCount };
      });
    },
    enabled: !!id,
  });

  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: ['web-folder-tasks', id, selectedFolder, showArchivedTasks],
    queryFn: async () => {
      // Read in pages of 1000 (the API's per-request limit) so large folders and "All tasks" are complete.
      // ci_total / ci_done are per-task checklist counts computed by the database in the same request.
      return fetchAllPages<any>((from, to) => {
        let query = supabase
          .from('tasks')
          .select('*, task_assignees(user_id, profile:profiles(id, full_name)), ci_total:checklist_items(count), ci_done:checklist_items(count)')
          .eq('project_id', id)
          .eq('archived', showArchivedTasks)
          .eq('ci_done.status', 'done')
          .order('created_at', { ascending: false })
          .order('id', { ascending: false });
        if (selectedFolder) query = query.eq('folder_id', selectedFolder);
        return query.range(from, to);
      });
    },
    enabled: !!id,
  });

  // Exact number of tasks the "All tasks" list shows (active, or archived in the archived view): a count-only
  // request. Keyed under 'web-folders' so it refreshes whenever the folder counts do.
  const { data: projectTaskTotal } = useQuery({
    queryKey: ['web-folders', id, 'list-total', showArchivedTasks],
    queryFn: async () => {
      const { count, error } = await supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('project_id', id).eq('archived', showArchivedTasks);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!id,
  });

  // Exact overdue count for the current view (whole project or the selected folder): one count-only request.
  // Keyed under 'web-folder-tasks' so it refreshes whenever the task list does.
  const { data: overdueExact } = useQuery({
    queryKey: ['web-folder-tasks', id, 'overdue-count', selectedFolder, showArchivedTasks],
    queryFn: async () => {
      let query = supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', id)
        .eq('archived', showArchivedTasks)
        .neq('status', 'completed')
        .lt('due_date', localDateKey(new Date()));
      if (selectedFolder) query = query.eq('folder_id', selectedFolder);
      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!id,
  });

  // Folder checklist editor: company admins and project managers of the project's company
  // (the same server-side rule save_folder_checklist enforces), Tasks + Checklist projects only.
  const { data: canManageChecklist } = useQuery({
    queryKey: ['can-manage-folder-checklist', id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('can_manage_project_reports', { p_project_id: id });
      if (error) return false;
      return data === true;
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
      if (error) {
        if (error.code === 'CHK01' && status === 'completed' && await completeTaskViaOverrideIfAllowed(taskId)) {
          const { error: archiveErr } = await supabase.from('tasks').update({ archived: true }).eq('id', taskId);
          if (archiveErr) throw archiveErr;
          return;
        }
        throw error;
      }
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
  const inProgressTasks = folders?.reduce((sum, f: any) => sum + (f.in_progress_count ?? 0), 0) ?? 0;

  const filteredTasks = tasks?.filter((task: any) => {
    if (!taskSearch.trim()) return true;
    const q = taskSearch.toLowerCase();
    return (
      task.title?.toLowerCase().includes(q) ||
      task.description?.toLowerCase().includes(q) ||
      taskAssigneeProfiles(task).some((p) => p.full_name?.toLowerCase().includes(q))
    );
  });

  // A folder with a saved folder checklist: every task in it carries exactly that checklist, so
  // per-task checklist inputs are hidden there (the database ignores per-task extras anyway).
  const selectedFolderObj: any = selectedFolder ? (folders as any[] | undefined)?.find((f: any) => f.id === selectedFolder) : null;
  const selectedFolderManaged = !!selectedFolderObj?.checklist_managed;
  const isFolderManaged = (folderId: string | null | undefined) =>
    !!folderId && !!(folders as any[] | undefined)?.find((f: any) => f.id === folderId)?.checklist_managed;

  async function handleDownloadSpreadsheet() {
    setDownloadingSheet(true);
    setDownloadSheetError(null);
    try {
      const { data, error } = await supabase.functions.invoke('build-project-export', { body: { projectId: id } });
      if (error) {
        let detail = error.message;
        try { detail = (await (error as any).context?.json())?.error ?? detail; } catch { /* keep message */ }
        throw new Error(detail);
      }
      const bytes = data instanceof Blob ? await data.arrayBuffer() : data;
      const file = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const today = new Date();
      const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const safeName = (project?.name ?? 'Project').replace(/[\\/:*?"<>|]/g, '-').trim() || 'Project';
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName} - Tasks - ${stamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e: any) {
      setDownloadSheetError(e?.message ?? 'Could not build the spreadsheet.');
    } finally {
      setDownloadingSheet(false);
    }
  }


  function resetImport() {
    setShowImport(false);
    setImportStep('input');
    setImportMode(null);
    setPastedText('');
    setParsedTasks([]);
    setManualTasks([{ title: '', description: '', priority: 'medium', dueDate: '', checklistItems: [], newItemDraft: '' }]);
    setAssignableTasks([]);
    setSelectedAssignTaskId('');
    setAssignItemsText('');
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
    not_started: colors.text3, done: colors.green, missing_part: colors.red, part_received: colors.blue,
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

  // Count every task in a folder, archived ones included: the database's folder rule
  // (regular tasks must have a folder) applies to all of them.
  async function countFolderTasks(folderId: string): Promise<{ total: number; archived: number }> {
    // Count-only requests, so a folder past 1,000 tasks is still counted exactly.
    const [total, archived] = await Promise.all([
      exactCount(supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('folder_id', folderId)),
      exactCount(supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('folder_id', folderId).eq('archived', true)),
    ]);
    return { total, archived };
  }

  function folderNotEmptyMessage(c: { total: number; archived: number }) {
    const noun = c.total === 1 ? 'task' : 'tasks';
    const archived = c.archived > 0 ? ` (${c.archived} archived)` : '';
    return `This folder has ${c.total} ${noun}${archived}. Move or delete them first.`;
  }

  // Folders that contain tasks cannot be deleted: nothing is moved or deleted automatically.
  async function handleDeleteFolder(folder: any) {
    setFolderDeleteBlock(null);
    try {
      const counts = await countFolderTasks(folder.id);
      if (counts.total > 0) {
        setFolderDeleteBlock({ folderId: folder.id, message: folderNotEmptyMessage(counts) });
        return;
      }
      if (!window.confirm(`Delete the empty folder "${folder.name}"?`)) return;
      const { error } = await supabase.from('folders').delete().eq('id', folder.id);
      if (error) {
        // A task was added after the count (the database rejects the delete): re-count and explain.
        if (error.code === '23514' || error.code === '23502') {
          const fresh = await countFolderTasks(folder.id);
          setFolderDeleteBlock({ folderId: folder.id, message: folderNotEmptyMessage(fresh) });
          queryClient.invalidateQueries({ queryKey: ['web-folders', id] });
          return;
        }
        throw error;
      }
      queryClient.invalidateQueries({ queryKey: ['web-folders', id] });
      if (selectedFolder === folder.id) setSelectedFolder(null);
    } catch (e: any) {
      setFolderDeleteBlock({ folderId: folder.id, message: `Could not delete this folder: ${e?.message ?? 'unknown error'}` });
    }
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
    setEditTaskAssigneeIds(taskAssigneeProfiles(task).map((p) => p.id));
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
    };

    const { error } = await supabase
      .from('tasks')
      .update(updatePayload)
      .eq('id', selectedTask.id);

    if (error) {
      if (error.code === 'CHK01' && editTaskStatus === 'completed' && await completeTaskViaOverrideIfAllowed(selectedTask.id)) {
        // The rejected update above rolled back entirely, so re-apply every
        // other edited field now that status is already past the gate.
        const { status: _status, ...restPayload } = updatePayload;
        const { error: restErr } = await supabase.from('tasks').update(restPayload).eq('id', selectedTask.id);
        if (restErr) throw restErr;
      } else {
        throw error;
      }
    }

    // Sync assignees against whatever was loaded when the modal opened —
    // task_assignees is a junction table now, so this is add/remove, not a column write.
    const currentAssigneeIds = taskAssigneeProfiles(selectedTask).map((p) => p.id);
    const assigneesToAdd = editTaskAssigneeIds.filter((uid) => !currentAssigneeIds.includes(uid));
    const assigneesToRemove = currentAssigneeIds.filter((uid) => !editTaskAssigneeIds.includes(uid));

    if (assigneesToAdd.length > 0) {
      const { error: addErr } = await supabase.from('task_assignees').insert(
        assigneesToAdd.map((user_id) => ({ task_id: selectedTask.id, user_id }))
      );
      if (addErr) throw addErr;
    }
    if (assigneesToRemove.length > 0) {
      const { error: removeErr } = await supabase
        .from('task_assignees')
        .delete()
        .eq('task_id', selectedTask.id)
        .in('user_id', assigneesToRemove);
      if (removeErr) throw removeErr;
    }

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
      if (error) {
        if (error.code === 'CHK01' && await completeTaskViaOverrideIfAllowed(task.id)) {
          const { error: archiveErr } = await supabase.from('tasks').update({ archived: true }).eq('id', task.id);
          if (archiveErr) throw archiveErr;
        } else {
          throw error;
        }
      }
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
    if (!selectedFolder) return; // guarded in the UI too — belt-and-suspenders
    const validTasks = manualTasks.filter((t) => t.title.trim());
    if (!validTasks.length) { alert('Please enter at least one task name.'); return; }
    setImporting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const isChecklistProject = project?.project_type === 'checklist';

      if (isChecklistProject) {
        // Insert one task at a time so we get each task's id back to attach its checklist items.
        for (const t of validTasks) {
          const { data: newTask, error: taskErr } = await supabase
            .from('tasks')
            .insert({
              project_id: id, folder_id: selectedFolder,
              title: t.title.trim(), description: t.description.trim() || null,
              priority: t.priority, due_date: t.dueDate || null,
              status: 'open', created_by: user!.id,
            })
            .select('id')
            .single();
          if (taskErr) throw taskErr;

          const items = t.checklistItems.map((s) => s.trim()).filter(Boolean).slice(0, CHECKLIST_ITEM_CAP);
          // In a folder with a folder checklist the database gives the new task that checklist.
          if (items.length > 0 && !selectedFolderManaged) {
            const { error: itemsErr } = await supabase.from('checklist_items').insert(
              items.map((text, i) => ({ task_id: newTask.id, item_text: text, sort_order: i }))
            );
            if (itemsErr) throw itemsErr;
          }
        }
      } else {
        const { error } = await supabase.from('tasks').insert(
          validTasks.map((t) => ({
            project_id: id, folder_id: selectedFolder,
            title: t.title.trim(), description: t.description.trim() || null,
            priority: t.priority, due_date: t.dueDate || null,
            status: 'open', created_by: user!.id,
          }))
        );
        if (error) throw error;
      }

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
    if (!selectedFolder) return; // guarded in the UI too — belt-and-suspenders
    const validTasks = parsedTasks.filter((t) => t.valid);
    if (!validTasks.length) return;
    setImporting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('tasks').insert(
        validTasks.map((t) => ({
          project_id: id, folder_id: selectedFolder,
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

      // No per-task "assign checklist" step in a folder that has a folder checklist: the imported
      // tasks already received it.
      if (project?.project_type === 'checklist' && !selectedFolderManaged) {
        await loadAssignableTasks();
        setImportStep('assign-checklist');
      } else {
        setImportStep('done');
      }
    } catch (e: any) { alert(e.message); }
    finally { setImporting(false); }
  }

  const pastedRows = pastedText.trim()
    ? pastedText.trim().split('\n').filter(l => l.trim()).slice(0, 20).map(line => {
        const cols = line.split('\t').map(c => c.trim().replace(/^"|"$/g, ''));
        return { title: cols[0] ?? '', description: cols[1] ?? '', priority: cols[2] ?? '', dueDate: cols[3] ?? '' };
      })
    : [];

  // Tasks without a checklist yet, eligible to be picked in the post-import assignment dropdown.
  async function loadAssignableTasks() {
    setAssignTasksLoading(true);
    try {
      // Every active task in the project (paged past 1,000) with its checklist item count embedded,
      // instead of one huge task_id list that could also cut the checklist rows off at 1,000.
      const allTasks = await fetchAllPages<any>((from, to) =>
        supabase
          .from('tasks')
          .select('id, title, ci_total:checklist_items(count)')
          .eq('project_id', id)
          .eq('archived', false)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to));

      const withoutChecklist = allTasks
        .filter((t: any) => (t.ci_total?.[0]?.count ?? 0) === 0)
        .map((t: any) => ({ id: t.id, title: t.title }));
      setAssignableTasks(withoutChecklist);
      setSelectedAssignTaskId((prev) => (withoutChecklist.some((t: any) => t.id === prev) ? prev : (withoutChecklist[0]?.id ?? '')));
    } catch (e: any) {
      alert(e.message);
    } finally {
      setAssignTasksLoading(false);
    }
  }

  // Inserts each non-empty line as a checklist_items row for taskId, capped at
  // CHECKLIST_ITEM_CAP (task_id is explicit here, never inferred from pasted text).
  async function commitAssignDraft(taskId: string, text: string) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, CHECKLIST_ITEM_CAP);
    if (lines.length === 0) return;
    const { error } = await supabase.from('checklist_items').insert(
      lines.map((itemText, i) => ({ task_id: taskId, item_text: itemText, sort_order: i }))
    );
    if (error) throw error;
  }

  async function handleAssignTaskChange(newTaskId: string) {
    setAssignSaving(true);
    try {
      if (selectedAssignTaskId && assignItemsText.trim()) {
        await commitAssignDraft(selectedAssignTaskId, assignItemsText);
      }
      setAssignItemsText('');
      setSelectedAssignTaskId(newTaskId);
      await loadAssignableTasks();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setAssignSaving(false);
    }
  }

  async function handleFinishAssignChecklist() {
    setAssignSaving(true);
    try {
      if (selectedAssignTaskId && assignItemsText.trim()) {
        await commitAssignDraft(selectedAssignTaskId, assignItemsText);
      }
      queryClient.invalidateQueries({ queryKey: ['web-folder-tasks', id] });
      queryClient.invalidateQueries({ queryKey: ['web-folders', id] });
      invalidateDashboard();
      resetImport();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setAssignSaving(false);
    }
  }

  // Status and priority colors come from the shared theme (same as StatusChip).
  const statusLabels: Record<string, string> = { open: 'Open', in_progress: 'In Progress', completed: 'Done', active: 'Active', on_hold: 'On Hold' };
  const validCount = parsedTasks.filter((t) => t.valid).length;
  const assignLineCount = assignItemsText.split('\n').map((l) => l.trim()).filter(Boolean).length;

  // Past due = the due day is before today's local date and the task is not done (same rule as the exact count).
  const isTaskOverdue = (task: any) => isPastDue(task.due_date) && task.status !== 'completed';
  const overdueScope = showArchivedTasks ? 'in archived tasks' : selectedFolderObj ? `in ${selectedFolderObj.name}` : 'across all tasks';

  const inputStyle: React.CSSProperties = inputBase;

  const cellStyle: React.CSSProperties = { padding: 0, border: `1px solid ${colors.border}` };

  const cellInputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', backgroundColor: 'transparent',
    border: 'none', color: colors.text, fontSize: 13, outline: 'none',
    boxSizing: 'border-box', fontFamily: 'inherit',
  };

  const modalOverlay: React.CSSProperties = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex',
    justifyContent: 'center', alignItems: 'center', zIndex: 1000,
    padding: 16,
  };

  const modalBox: React.CSSProperties = {
    backgroundColor: colors.surface, borderRadius: radius.card, padding: isMobile ? 20 : 32,
    width: '100%', maxWidth: 520, border: `1px solid ${colors.border}`,
    maxHeight: '85vh', overflowY: 'auto',
  };

  const panel: React.CSSProperties = { ...card, padding: isMobile ? 16 : 24, marginBottom: 24 };
  const small: React.CSSProperties = { padding: '6px 12px', fontSize: 12 };
  const labelStyle: React.CSSProperties = { ...sectionLabel, display: 'block', marginBottom: 6 };
  const assigneeNames = (task: any) => taskAssigneeProfiles(task).map((p) => p.full_name).filter(Boolean);
  const TASK_COLS = 'minmax(0, 1fr) 96px 112px 132px auto';

  const folderPanelFooter = isAdmin ? (
    showCreateFolder ? (
      <div>
        <label htmlFor="new-folder-name" className="fo-sr-only">New folder name</label>
        <input id="new-folder-name" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="Folder name..." onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()} style={{ ...inputStyle, padding: '8px 10px', fontSize: 13, marginBottom: 8 }} autoFocus />
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => { setShowCreateFolder(false); setNewFolderName(''); }} {...btn('ghost', { ...small, flex: 1 })}>Cancel</button>
          <button onClick={handleCreateFolder} disabled={creatingFolder} {...btn('primary', { ...small, flex: 1 })}>{creatingFolder ? '...' : 'Create'}</button>
        </div>
      </div>
    ) : (
      <button onClick={() => setShowCreateFolder(true)} {...btn('ghost', { ...small, width: '100%', borderStyle: 'dashed' })}>
        <Icon name="plus" /> New folder
      </button>
    )
  ) : null;

  // Panel counts match the task list: active tasks, or archived ones while "Show archived" is on.
  const panelFolders = ((folders as any[] | undefined) ?? []).map((f: any) => ({ id: f.id, name: f.name, task_count: showArchivedTasks ? f.archived_count : f.active_count }));
  const listTotal = projectTaskTotal ?? panelFolders.reduce((s, f) => s + f.task_count, 0);
  const selectedPanelCount = selectedFolder ? panelFolders.find((f) => f.id === selectedFolder)?.task_count ?? 0 : listTotal;

  const folderPanel = (
    <FolderPanel
      folders={panelFolders}
      allCount={listTotal}
      selectedId={selectedFolder}
      onSelect={(folderId) => { setSelectedFolder(folderId); setFolderSheetOpen(false); }}
      footer={folderPanelFooter}
      loading={foldersLoading}
    />
  );

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: colors.text }}>
      <PageHeader
        breadcrumb={[{ label: 'Projects', onClick: () => navigate('/projects') }, { label: project?.name ?? '…' }]}
        title={project?.name ?? <Skeleton width={260} height={34} />}
        subtitle={project ? (
          <>
            {project.description && <p style={{ color: colors.text2, fontSize: 14, lineHeight: 1.5, margin: 0 }}>{project.description}</p>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {project.status && <StatusChip status={project.status} label={statusLabels[project.status]} />}
              {project.project_type === 'checklist' && (
                <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 10px', borderRadius: radius.pill, border: `1px solid ${colors.border}`, color: colors.text2, fontSize: 12, fontWeight: 600 }}>
                  Tasks + Checklist
                </span>
              )}
            </div>
          </>
        ) : undefined}
        actions={
          <>
            {canEdit && <button onClick={() => { setEditName(project?.name ?? ''); setEditDescription(project?.description ?? ''); setEditStatus(project?.status ?? 'active'); setEditClientPhotosEnabled((project as any)?.client_photos_enabled ?? false); setShowEditProject(true); }} {...btn('secondary')}>Edit</button>}
            {isAdmin && <button onClick={() => setShowInvite(!showInvite)} {...btn('secondary')}>Invite</button>}
            <button onClick={() => navigate(`/projects/${id}/chat`)} {...btn('secondary')}>Chat</button>
            {canManageChecklist && <button onClick={() => navigate(`/projects/${id}/daily-reports`)} {...btn('secondary')}>Daily Reports</button>}
            {canEdit && <button onClick={() => { resetImport(); setShowImport(true); }} {...btn('secondary')}><Icon name="plus" /> Add Tasks</button>}
            <button onClick={handleDownloadSpreadsheet} disabled={downloadingSheet} title="Builds a fresh spreadsheet of this project's tasks" {...btn('primary', { cursor: downloadingSheet ? 'wait' : 'pointer' })}>
              {downloadingSheet ? 'Building spreadsheet...' : 'Download spreadsheet'}
            </button>
            {downloadSheetError && (
              <span role="alert" style={{ alignSelf: 'center', fontSize: 13, color: colors.red, maxWidth: 320 }}>{downloadSheetError}</span>
            )}
          </>
        }
      />

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 16 }}>
        <StatCard label="Tasks" tone="accent" value={folders ? totalTasks : undefined} sub={folders ? `across ${folders.length} folder${folders.length !== 1 ? 's' : ''}` : undefined} />
        <StatCard label="Done" tone="green" value={folders ? completedTasks : undefined} sub="completed or archived" />
        <StatCard label="In progress" tone="blue" value={folders ? inProgressTasks : undefined} sub="being worked on" />
        <StatCard label="Overdue" tone="gray" alert={(overdueExact ?? 0) > 0} value={overdueExact} sub={overdueScope} />
      </div>

      {/* Progress Bar */}
      <div style={{ ...card, marginBottom: 24, display: 'flex', alignItems: 'center', gap: isMobile ? 14 : 24 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...sectionLabel, marginBottom: 10 }}>Overall progress</div>
          <div style={{ height: 10, backgroundColor: colors.track, borderRadius: 5, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{ height: '100%', width: `${projectProgress}%`, backgroundColor: colors.accent, borderRadius: 5, transition: 'width 0.5s ease' }} />
          </div>
          <span style={{ fontSize: 13, color: colors.text3 }}>{completedTasks} of {totalTasks} tasks completed across {folders?.length ?? 0} folder{folders?.length !== 1 ? 's' : ''}</span>
        </div>
        <div style={{ fontFamily: fonts.display, fontSize: isMobile ? 40 : 48, fontWeight: 700, lineHeight: 1, color: colors.text, fontVariantNumeric: 'tabular-nums' }}>
          {projectProgress}%
        </div>
      </div>

      {/* Tab Bar */}
      <div role="tablist" style={{ display: 'flex', borderBottom: `1px solid ${colors.border}`, marginBottom: 24, overflowX: 'auto' }}>
        {[
          { key: 'tasks', label: 'Tasks' },
          { key: 'budget', label: 'Budget' },
          { key: 'change-orders', label: 'Change Orders' },
          { key: 'rfi', label: 'RFI Log' },
          { key: 'client-messages', label: 'Client Messages' },
        ].map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`fo-tab${activeTab === tab.key ? ' is-active' : ''}`}
            onClick={() => setActiveTab(tab.key as any)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Edit Project Panel */}
      {showEditProject && canEdit && (
        <div style={panel}>
          <h3 style={{ margin: '0 0 16px 0', fontFamily: fonts.display, fontSize: 22, fontWeight: 700, letterSpacing: '0.02em' }}>Edit Project</h3>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>PROJECT NAME</label>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>DESCRIPTION</label>
            <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>STATUS</label>
            <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}>
              <option value="active">Active</option>
              <option value="on_hold">On Hold</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          {isAdmin && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>CLIENT ACCESS</label>
              <button
                onClick={() => setEditClientPhotosEnabled(!editClientPhotosEnabled)}
                style={{ padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', backgroundColor: editClientPhotosEnabled ? '#F9731620' : colors.surface2, border: `1px solid ${editClientPhotosEnabled ? '#F97316' : colors.border}`, color: editClientPhotosEnabled ? '#F97316' : '#9CA3AF' }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${editClientPhotosEnabled ? colors.accent : colors.text3}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{editClientPhotosEnabled && <Icon name="check" size={11} strokeWidth={3} />}</span>Show site photos to client</span>
              </button>
            </div>
          )}
          <DailyReportSettings projectId={id ?? ''} />
          {isAdmin && project?.project_type === 'regular' && (
            <div style={{ marginBottom: 20, padding: 16, backgroundColor: '#7F1D1D15', border: '1px solid #EF444440', borderRadius: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.red, letterSpacing: 2, marginBottom: 8 }}>DANGER ZONE</div>
              <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 12 }}>Switch this project to Tasks + Checklist mode. Existing tasks are kept — this only unlocks per-task checklists.</div>
              <button onClick={() => setShowConvertConfirm(true)} style={{ padding: '10px 16px', backgroundColor: 'transparent', border: `1px solid ${colors.red}`, borderRadius: 8, color: colors.red, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Convert to Tasks + Checklist →</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setShowEditProject(false)} style={{ padding: '10px 20px', backgroundColor: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text3, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSaveProject} disabled={savingProject} style={{ padding: '10px 24px', backgroundColor: '#F97316', border: 'none', borderRadius: 8, color: '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>{savingProject ? 'Saving...' : 'Save Changes'}</button>
          </div>
        </div>
      )}

      {showFolderChecklistEditor && selectedFolderObj && project?.project_type === 'checklist' && canManageChecklist && (
        <FolderChecklistEditor
          folder={selectedFolderObj}
          onClose={() => setShowFolderChecklistEditor(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['web-folders', id] });
            queryClient.invalidateQueries({ queryKey: ['web-folder-tasks', id] });
            if (viewTask) refreshChecklist(viewTask.id);
          }}
        />
      )}

      {/* Convert to Checklist Confirm Modal */}
      {showConvertConfirm && isAdmin && (
        <div style={modalOverlay} onClick={() => !converting && setShowConvertConfirm(false)}>
          <div style={{ ...modalBox, maxWidth: 460, border: `1px solid ${colors.red}` }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: 18, fontWeight: 800, color: colors.red }}><Icon name="alert" size={18} style={{ marginRight: 8, verticalAlign: '-3px' }} />Convert to Tasks + Checklist</h3>
            <p style={{ fontSize: 14, color: colors.text2, lineHeight: 1.6, marginBottom: 12 }}>
              This is <strong>permanent and cannot be undone</strong>. Once converted, this project cannot be switched back to a Regular Project — for any user, at any time.
            </p>
            <p style={{ fontSize: 14, color: colors.text2, lineHeight: 1.6, marginBottom: 24 }}>
              Existing tasks will not be deleted or changed — they'll simply become eligible to have checklists added, and can no longer be marked complete until their checklist items are resolved.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowConvertConfirm(false)} disabled={converting} style={{ flex: 1, padding: '12px', backgroundColor: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text3, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleConvertToChecklist} disabled={converting} {...btn('danger', { flex: 2, padding: '12px' })}>{converting ? 'Converting...' : 'Yes, Convert Permanently'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Panel */}
      {showInvite && isAdmin && (
        <div style={panel}>
          <h3 style={{ margin: '0 0 16px 0', fontFamily: fonts.display, fontSize: 22, fontWeight: 700, letterSpacing: '0.02em' }}>Invite to Project</h3>
          {/* Invite type toggle */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {(['team', 'client'] as const).map((t) => (
              <button key={t} onClick={() => setInviteType(t)} style={{ flex: 1, padding: '8px 12px', backgroundColor: inviteType === t ? (t === 'team' ? '#F9731620' : '#3B82F620') : colors.surface2, border: `1px solid ${inviteType === t ? (t === 'team' ? '#F97316' : colors.blue) : colors.border}`, borderRadius: 8, color: inviteType === t ? (t === 'team' ? '#F97316' : colors.blue) : colors.text3, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {t === 'team' ? 'Team member' : 'Client'}
              </button>
            ))}
          </div>
          {inviteType === 'team' && teamMembers && teamMembers.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.text3, letterSpacing: 2, marginBottom: 8 }}>CURRENT MEMBERS</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {teamMembers.map((m) => <span key={m.user_id} style={{ fontSize: 12, color: '#9CA3AF', backgroundColor: colors.surface2, padding: '4px 10px', borderRadius: 20 }}>{(m.profile as any)?.full_name ?? 'Unknown'}</span>)}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder={inviteType === 'team' ? 'worker@company.com' : 'client@company.com'} onKeyDown={(e) => e.key === 'Enter' && (inviteType === 'team' ? handleInvite() : handleInviteClient())} style={{ flex: 1, ...inputStyle, width: 'auto' }} />
            <button onClick={inviteType === 'team' ? handleInvite : handleInviteClient} disabled={inviting} {...btn('primary')}>{inviting ? 'Adding...' : 'Add'}</button>
            <button onClick={() => { setShowInvite(false); setInviteType('team'); }} style={{ padding: '10px 16px', backgroundColor: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text3, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Task View Modal */}
      {viewTask && (
        <div style={modalOverlay} onClick={closeViewTask}>
          <div style={{ ...modalBox, maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, flex: 1, marginRight: 16 }}>{viewTask.title}</h3>
              <button onClick={closeViewTask} style={{ backgroundColor: colors.surface2, border: 'none', borderRadius: 8, color: '#9CA3AF', fontSize: 16, cursor: 'pointer', padding: '6px 8px', display: 'inline-flex' }} aria-label="Close"><Icon name="x" size={16} /></button>
            </div>
            {viewTask.description && <p style={{ color: '#9CA3AF', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px 0' }}>{viewTask.description}</p>}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
              <StatusChip status={viewTask.status} label={statusLabels[viewTask.status]} />
              <StatusChip status={viewTask.priority} label={`${viewTask.priority} priority`} />
            </div>
            <div style={{ backgroundColor: colors.bg, borderRadius: 8, padding: 16, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 10, borderBottom: `1px solid ${colors.border}`, marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: colors.text3, fontWeight: 600 }}>ASSIGNED TO</span>
                <span style={{ fontSize: 13, color: colors.text, fontWeight: 600 }}>{taskAssigneeNames(viewTask)}</span>
              </div>
              {viewTask.due_date && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: colors.text3, fontWeight: 600 }}>DUE DATE</span>
                  <span style={{ fontSize: 13, color: colors.text, fontWeight: 600 }}>{formatDateOnly(viewTask.due_date)}</span>
                </div>
              )}
            </div>
            {project?.project_type === 'checklist' && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: colors.text3, letterSpacing: 2 }}>CHECKLIST</div>
                  <div style={{ fontSize: 12, color: colors.text3 }}>{viewTaskChecklist.length}/{CHECKLIST_ITEM_CAP}</div>
                </div>
                {checklistLoading ? (
                  <div role="status" aria-label="Loading checklist" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><Skeleton height={44} radius={8} /><Skeleton height={44} radius={8} /></div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                    {viewTaskChecklist.length === 0 && (
                      <div style={{ padding: '12px 0', fontSize: 13, color: colors.text3 }}>No checklist items yet — add at least one before this task can be marked complete.</div>
                    )}
                    {viewTaskChecklist.map((item) => (
                      <div key={item.id} style={{ backgroundColor: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 140 }}>
                          <div style={{ fontSize: 13, color: colors.text, marginBottom: 4 }}>{item.item_text}</div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: checklistStatusColors[item.status], backgroundColor: checklistStatusColors[item.status] + '20', padding: '2px 8px', borderRadius: 12 }}>
                            {checklistStatusLabels[item.status]}
                          </span>
                        </div>
                        {canEdit && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => handleToggleChecklistDone(item)} style={{ padding: '6px 10px', backgroundColor: item.status === 'done' ? '#22C55E20' : colors.surface2, border: `1px solid ${item.status === 'done' ? colors.green : colors.border}`, borderRadius: 6, color: item.status === 'done' ? colors.green : '#9CA3AF', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                              {item.status === 'done' ? <><Icon name="check" size={12} strokeWidth={3} /> Done</> : 'Mark Done'}
                            </button>
                            <button onClick={() => handleToggleChecklistMissingPart(item)} style={{ padding: '6px 10px', backgroundColor: item.status === 'missing_part' ? '#EF444420' : colors.surface2, border: `1px solid ${item.status === 'missing_part' ? colors.red : colors.border}`, borderRadius: 6, color: item.status === 'missing_part' ? colors.red : '#9CA3AF', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                              {item.status === 'missing_part' ? 'Now Have Part' : "Don't Have Part"}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {canEdit && isFolderManaged(viewTask?.folder_id) && (
                  <div style={{ fontSize: 12, color: colors.text3 }}>
                    This task uses its folder's shared checklist. Items are added, renamed or removed for the whole folder with Edit folder checklist.
                  </div>
                )}
                {canEdit && !isFolderManaged(viewTask?.folder_id) && (
                  viewTaskChecklist.length >= CHECKLIST_ITEM_CAP ? (
                    <div style={{ fontSize: 12, color: colors.amber }}>Checklist item limit reached ({CHECKLIST_ITEM_CAP} max).</div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        value={newChecklistItemText}
                        onChange={(e) => setNewChecklistItemText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddChecklistItem()}
                        placeholder="Add checklist item..."
                        style={{ flex: 1, padding: '8px 12px', backgroundColor: colors.surface2, border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text, fontSize: 13, outline: 'none' }}
                      />
                      <button onClick={handleAddChecklistItem} disabled={addingChecklistItem || !newChecklistItemText.trim()} style={{ padding: '8px 16px', backgroundColor: !newChecklistItemText.trim() || addingChecklistItem ? colors.surface2 : '#F97316', border: 'none', borderRadius: 8, color: !newChecklistItemText.trim() || addingChecklistItem ? colors.text3 : '#0A0F1E', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                        {addingChecklistItem ? 'Adding...' : '+ Add'}
                      </button>
                    </div>
                  )
                )}
              </div>
            )}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: colors.text3, letterSpacing: 2, marginBottom: 12 }}>PHOTOS {viewTaskPhotos.length > 0 ? `(${viewTaskPhotos.length})` : ''}</div>
              {photosLoading ? (
                <div role="status" aria-label="Loading photos" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={72} radius={8} />)}</div>
              ) : viewTaskPhotos.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  {viewTaskPhotos.map((photo: any) => (
                    <div key={photo.id} onClick={() => setViewingPhoto(photo.url)} style={{ aspectRatio: '1', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', backgroundColor: colors.surface2, border: `1px solid ${colors.border}` }}>
                      <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '16px 0', fontSize: 13, color: colors.text3 }}>No photos attached to this task.</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {canEdit && <button onClick={() => { closeViewTask(); openEditTask(viewTask); }} style={{ flex: 1, padding: '12px', backgroundColor: '#F97316', border: 'none', borderRadius: 8, color: '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>Edit Task</button>}
              <button onClick={closeViewTask} style={{ padding: '12px 20px', backgroundColor: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text3, fontSize: 14, cursor: 'pointer' }}>Close</button>
            </div>
          </div>
          {viewingPhoto && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.95)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }} onClick={() => setViewingPhoto(null)}>
              <button onClick={() => setViewingPhoto(null)} style={{ position: 'absolute', top: 24, right: 24, backgroundColor: colors.surface2, border: 'none', borderRadius: 20, color: colors.text, fontSize: 16, cursor: 'pointer', width: 40, height: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Close photo"><Icon name="x" size={18} /></button>
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
              <label style={labelStyle}>TITLE</label>
              <input value={editTaskTitle} onChange={(e) => setEditTaskTitle(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>DESCRIPTION</label>
              <textarea value={editTaskDescription} onChange={(e) => setEditTaskDescription(e.target.value)} style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>ASSIGN TO</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {teamMembers?.map((m) => {
                  const uid = m.user_id;
                  const selected = editTaskAssigneeIds.includes(uid);
                  return (
                    <button
                      key={uid}
                      type="button"
                      onClick={() => setEditTaskAssigneeIds(selected ? editTaskAssigneeIds.filter((x) => x !== uid) : [...editTaskAssigneeIds, uid])}
                      style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', backgroundColor: selected ? '#F9731620' : colors.surface2, border: `1px solid ${selected ? '#F97316' : colors.border}`, color: selected ? '#F97316' : '#9CA3AF' }}
                    >
                      {selected && <Icon name="check" size={12} strokeWidth={3} style={{ marginRight: 6 }} />}{(m.profile as any)?.full_name ?? 'Unknown'}
                    </button>
                  );
                })}
                {(!teamMembers || teamMembers.length === 0) && <span style={{ fontSize: 12, color: colors.text3 }}>No team members on this project yet.</span>}
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>DUE DATE (OPTIONAL)</label>
              <input type="date" value={editTaskDueDate} onChange={(e) => setEditTaskDueDate(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 14, marginBottom: 20 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>STATUS</label>
                <select value={editTaskStatus} onChange={(e) => setEditTaskStatus(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Done</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>PRIORITY</label>
                <select value={editTaskPriority} onChange={(e) => setEditTaskPriority(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setSelectedTask(null)} style={{ flex: 1, padding: '12px', backgroundColor: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text3, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleSaveTask} disabled={savingTask} style={{ flex: 2, padding: '12px', backgroundColor: '#F97316', border: 'none', borderRadius: 8, color: '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>{savingTask ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Tasks Panel */}
      {showImport && canEdit && (
        <div style={{ ...panel, marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              Add tasks{selectedFolder ? ` to ${folders?.find((f: any) => f.id === selectedFolder)?.name}` : ''}
            </h3>
            <button onClick={resetImport} style={{ backgroundColor: 'transparent', border: 'none', color: colors.text2, fontSize: 18, cursor: 'pointer', display: 'inline-flex', padding: 4 }} aria-label="Close"><Icon name="x" size={18} /></button>
          </div>
          {!selectedFolder && (
            <div style={{ backgroundColor: '#EF444415', border: '1px solid #EF444440', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: colors.red }}>
              <Icon name="alert" style={{ marginRight: 6 }} />A folder is required — select or create one above before adding tasks. Tasks without a folder aren't visible in the mobile app.
            </div>
          )}
          {!importMode && importStep === 'input' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <button onClick={() => setImportMode('manual')} style={{ padding: 20, backgroundColor: colors.surface2, border: `1px solid ${colors.border}`, borderRadius: 12, cursor: 'pointer', textAlign: 'left' }}>
                                <div style={{ fontSize: 15, fontWeight: 700, color: colors.text, marginBottom: 4 }}>Type Manually</div>
                <div style={{ fontSize: 12, color: colors.text3 }}>Fill in a spreadsheet-style table row by row</div>
              </button>
              <button onClick={() => setImportMode('paste')} style={{ padding: 20, backgroundColor: colors.surface2, border: `1px solid ${colors.border}`, borderRadius: 12, cursor: 'pointer', textAlign: 'left' }}>
                                <div style={{ fontSize: 15, fontWeight: 700, color: colors.text, marginBottom: 4 }}>Paste from Excel</div>
                <div style={{ fontSize: 12, color: colors.text3 }}>Copy cells from Excel and paste into the table below</div>
              </button>
            </div>
          )}
          {importMode === 'manual' && importStep === 'input' && (
            <>
              <button onClick={() => setImportMode(null)} style={{ backgroundColor: 'transparent', border: 'none', color: '#F97316', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 14 }}>← Back</button>
              <div style={{ overflowX: 'auto', borderRadius: 8, border: `1px solid ${colors.border}` }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#1A2235' }}>
                      <th style={{ width: 36, padding: '9px 8px', textAlign: 'center', fontSize: 11, color: colors.text3, borderRight: `1px solid ${colors.border}`, borderBottom: `2px solid ${colors.border}` }}></th>
                      {[{ label: 'Task Name', required: true }, { label: 'Description', required: false }, { label: 'Priority', required: false }, { label: 'Due Date', required: false }].map((col, ci) => (
                        <th key={ci} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: col.required ? '#F97316' : '#9CA3AF', borderRight: ci < 3 ? `1px solid ${colors.border}` : 'none', borderBottom: `2px solid ${colors.border}`, whiteSpace: 'nowrap' }}>
                          {col.label}{col.required && <span style={{ color: colors.red, marginLeft: 2 }}>*</span>}
                        </th>
                      ))}
                      <th style={{ width: 32, borderBottom: `2px solid ${colors.border}` }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {manualTasks.map((task, i) => (
                      <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#111827' : colors.bg, borderBottom: `1px solid ${colors.border}` }}>
                        <td style={{ padding: '5px 8px', textAlign: 'center', fontSize: 11, color: colors.text3, borderRight: `1px solid ${colors.border}`, userSelect: 'none' }}>{i + 1}</td>
                        <td style={cellStyle}><input value={task.title} onChange={(e) => { const u = [...manualTasks]; u[i].title = e.target.value; setManualTasks(u); }} placeholder="Enter task name..." style={{ ...cellInputStyle, color: task.title ? colors.text : colors.text3, minWidth: 200 }} /></td>
                        <td style={{ ...cellStyle, borderLeft: `1px solid ${colors.border}` }}><input value={task.description} onChange={(e) => { const u = [...manualTasks]; u[i].description = e.target.value; setManualTasks(u); }} placeholder="Optional..." style={{ ...cellInputStyle, color: task.description ? colors.text2 : colors.text3, minWidth: 150 }} /></td>
                        <td style={{ ...cellStyle, borderLeft: `1px solid ${colors.border}`, minWidth: 110 }}>
                          <select value={task.priority} onChange={(e) => { const u = [...manualTasks]; u[i].priority = e.target.value; setManualTasks(u); }} style={{ ...cellInputStyle, cursor: 'pointer', color: task.priority === 'high' ? colors.red : task.priority === 'low' ? colors.text3 : colors.amber }}>
                            <option value="low">low</option>
                            <option value="medium">medium</option>
                            <option value="high">high</option>
                          </select>
                        </td>
                        <td style={{ ...cellStyle, borderLeft: `1px solid ${colors.border}` }}><input type="date" value={task.dueDate} onChange={(e) => { const u = [...manualTasks]; u[i].dueDate = e.target.value; setManualTasks(u); }} style={{ ...cellInputStyle, color: task.dueDate ? colors.text2 : colors.text3, minWidth: 130 }} /></td>
                        <td style={{ padding: '4px 6px', borderLeft: `1px solid ${colors.border}` }}>
                          {manualTasks.length > 1 && <button onClick={() => setManualTasks(manualTasks.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', color: colors.red, cursor: 'pointer', fontSize: 14, padding: '2px 4px', display: 'inline-flex' }} aria-label="Remove row"><Icon name="x" size={14} /></button>}
                        </td>
                      </tr>
                    ))}
                    {project?.project_type === 'checklist' && selectedFolderManaged && (
                      <tr>
                        <td colSpan={6} style={{ padding: '10px 16px', fontSize: 12, color: '#9CA3AF' }}>
                          This folder has a shared folder checklist. New tasks get its items automatically, all not done.
                        </td>
                      </tr>
                    )}
                    {project?.project_type === 'checklist' && !selectedFolderManaged && manualTasks.map((task, i) => (
                      <tr key={`checklist-${i}`} style={{ backgroundColor: i % 2 === 0 ? '#111827' : colors.bg, borderBottom: `1px solid ${colors.border}` }}>
                        <td colSpan={6} style={{ padding: '8px 16px 14px 44px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: colors.text3, letterSpacing: 1 }}>CHECKLIST ITEMS (OPTIONAL)</span>
                            <span style={{ fontSize: 11, color: colors.text3 }}>{task.checklistItems.length}/{CHECKLIST_ITEM_CAP}</span>
                          </div>
                          {task.checklistItems.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                              {task.checklistItems.map((itemText, itemIdx) => (
                                <span key={itemIdx} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: colors.text2, backgroundColor: colors.surface2, border: `1px solid ${colors.border}`, borderRadius: 20, padding: '4px 6px 4px 12px' }}>
                                  {itemText}
                                  <button
                                    onClick={() => { const u = [...manualTasks]; u[i].checklistItems = u[i].checklistItems.filter((_, idx) => idx !== itemIdx); setManualTasks(u); }}
                                    style={{ background: 'none', border: 'none', color: colors.text3, cursor: 'pointer', fontSize: 12, padding: '2px 4px', lineHeight: 1, display: 'inline-flex' }}
                                    aria-label="Remove item"
                                  ><Icon name="x" size={12} /></button>
                                </span>
                              ))}
                            </div>
                          )}
                          {task.checklistItems.length >= CHECKLIST_ITEM_CAP ? (
                            <div style={{ fontSize: 12, color: colors.amber }}>Checklist item limit reached ({CHECKLIST_ITEM_CAP} max).</div>
                          ) : (
                            <div style={{ display: 'flex', gap: 8 }}>
                              <input
                                value={task.newItemDraft}
                                onChange={(e) => { const u = [...manualTasks]; u[i].newItemDraft = e.target.value; setManualTasks(u); }}
                                onKeyDown={(e) => {
                                  if (e.key !== 'Enter' || !task.newItemDraft.trim() || task.checklistItems.length >= CHECKLIST_ITEM_CAP) return;
                                  const u = [...manualTasks]; u[i].checklistItems = [...u[i].checklistItems, task.newItemDraft.trim()]; u[i].newItemDraft = ''; setManualTasks(u);
                                }}
                                placeholder="Add checklist item..."
                                style={{ flex: 1, maxWidth: 320, padding: '7px 12px', backgroundColor: colors.surface2, border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text, fontSize: 13, outline: 'none' }}
                              />
                              <button
                                onClick={() => {
                                  if (!task.newItemDraft.trim() || task.checklistItems.length >= CHECKLIST_ITEM_CAP) return;
                                  const u = [...manualTasks]; u[i].checklistItems = [...u[i].checklistItems, task.newItemDraft.trim()]; u[i].newItemDraft = ''; setManualTasks(u);
                                }}
                                disabled={!task.newItemDraft.trim()}
                                style={{ padding: '7px 14px', backgroundColor: !task.newItemDraft.trim() ? colors.surface2 : '#F97316', border: 'none', borderRadius: 8, color: !task.newItemDraft.trim() ? colors.text3 : '#0A0F1E', fontSize: 12, fontWeight: 700, cursor: !task.newItemDraft.trim() ? 'not-allowed' : 'pointer' }}
                              >+ Add</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
                <button onClick={() => setManualTasks([...manualTasks, { title: '', description: '', priority: 'medium', dueDate: '', checklistItems: [], newItemDraft: '' }])} style={{ padding: '7px 14px', backgroundColor: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 8, color: '#9CA3AF', fontSize: 12, cursor: 'pointer' }}>+ Add Row</button>
                <button onClick={handleSaveManual} disabled={importing || !selectedFolder || !manualTasks.some(t => t.title.trim())} style={{ padding: '10px 24px', backgroundColor: !selectedFolder || !manualTasks.some(t => t.title.trim()) || importing ? colors.surface2 : '#F97316', border: 'none', borderRadius: 8, color: !selectedFolder || !manualTasks.some(t => t.title.trim()) || importing ? colors.text3 : '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: !selectedFolder || importing ? 'not-allowed' : 'pointer' }}>
                  {importing ? 'Saving...' : !selectedFolder ? 'Select a folder first' : `Save ${manualTasks.filter(t => t.title.trim()).length} Task${manualTasks.filter(t => t.title.trim()).length !== 1 ? 's' : ''}`}
                </button>
                {manualTasks.some(t => t.title.trim()) && <span style={{ fontSize: 12, color: colors.green, fontWeight: 600 }}><Icon name="check" size={13} strokeWidth={3} /> {manualTasks.filter(t => t.title.trim()).length} ready</span>}
              </div>
            </>
          )}
          {importMode === 'paste' && importStep === 'input' && (
            <>
              <button onClick={() => setImportMode(null)} style={{ backgroundColor: 'transparent', border: 'none', color: '#F97316', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 14 }}>← Back</button>
              <div style={{ fontSize: 12, color: colors.text3, marginBottom: 10 }}>Copy cells from Excel → click the table below → press <strong style={{ color: colors.text }}>Ctrl+V</strong></div>
              <div style={{ overflowX: 'auto', borderRadius: 8, border: `2px solid ${pastedText ? colors.green : colors.border}`, cursor: 'text', outline: 'none', position: 'relative' }} tabIndex={0} onPaste={(e) => { e.preventDefault(); const text = e.clipboardData.getData('text'); setPastedText(text); }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                  <thead>
                    <tr style={{ backgroundColor: '#1A2235' }}>
                      <th style={{ width: 36, padding: '9px 8px', textAlign: 'center', fontSize: 11, color: colors.text3, borderRight: `1px solid ${colors.border}`, borderBottom: `2px solid ${colors.border}` }}></th>
                      {[{ label: 'A — Task Name', required: true }, { label: 'B — Description', required: false }, { label: 'C — Priority', required: false }, { label: 'D — Due Date (YYYY-MM-DD)', required: false }].map((col, ci) => (
                        <th key={ci} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: col.required ? '#F97316' : '#9CA3AF', borderRight: ci < 3 ? `1px solid ${colors.border}` : 'none', borderBottom: `2px solid ${colors.border}`, whiteSpace: 'nowrap' }}>
                          {col.label}{col.required && <span style={{ color: colors.red, marginLeft: 2 }}>*</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pastedRows.length > 0
                      ? pastedRows.map((row, i) => (
                          <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#111827' : colors.bg, borderBottom: `1px solid ${colors.border}` }}>
                            <td style={{ padding: '7px 8px', textAlign: 'center', fontSize: 11, color: colors.text3, borderRight: `1px solid ${colors.border}`, userSelect: 'none' }}>{i + 1}</td>
                            <td style={{ padding: '7px 12px', fontSize: 13, color: row.title ? colors.text : colors.text3, borderRight: `1px solid ${colors.border}` }}>{row.title || ''}</td>
                            <td style={{ padding: '7px 12px', fontSize: 13, color: row.description ? colors.text2 : colors.text3, borderRight: `1px solid ${colors.border}` }}>{row.description || ''}</td>
                            <td style={{ padding: '7px 12px', fontSize: 13, color: row.priority === 'high' ? colors.red : row.priority === 'low' ? colors.text3 : row.priority ? colors.amber : colors.text3, borderRight: `1px solid ${colors.border}` }}>{row.priority || ''}</td>
                            <td style={{ padding: '7px 12px', fontSize: 13, color: row.dueDate ? colors.text2 : colors.text3 }}>{row.dueDate || ''}</td>
                          </tr>
                        ))
                      : [1, 2, 3, 4, 5, 6, 7, 8].map((row) => (
                          <tr key={row} style={{ backgroundColor: row % 2 === 0 ? colors.bg : '#111827', borderBottom: `1px solid ${colors.border}` }}>
                            <td style={{ padding: '7px 8px', textAlign: 'center', fontSize: 11, color: colors.text3, borderRight: `1px solid ${colors.border}`, userSelect: 'none' }}>{row}</td>
                            <td style={{ padding: '7px 12px', borderRight: `1px solid ${colors.border}`, height: 34 }}></td>
                            <td style={{ padding: '7px 12px', borderRight: `1px solid ${colors.border}` }}></td>
                            <td style={{ padding: '7px 12px', borderRight: `1px solid ${colors.border}` }}></td>
                            <td style={{ padding: '7px 12px' }}></td>
                          </tr>
                        ))
                    }
                  </tbody>
                </table>
                {!pastedText && (
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <div style={{ backgroundColor: '#1A2235CC', borderRadius: 8, padding: '10px 20px', fontSize: 13, color: '#9CA3AF', fontWeight: 600, textAlign: 'center' }}>
                      Click here then press Ctrl+V to paste your Excel data
                    </div>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
                {pastedText ? <span style={{ fontSize: 12, color: colors.green, fontWeight: 600 }}><Icon name="check" size={13} strokeWidth={3} /> {pastedText.trim().split('\n').filter(l => l.trim()).length} rows detected</span> : <span style={{ fontSize: 12, color: colors.text3 }}>Click the table and paste with Ctrl+V</span>}
                {pastedText && <button onClick={() => setPastedText('')} style={{ padding: '4px 10px', backgroundColor: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.text3, fontSize: 11, cursor: 'pointer' }}>Clear</button>}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button onClick={handlePastePreview} disabled={!pastedText.trim()} style={{ padding: '10px 24px', backgroundColor: pastedText.trim() ? '#F97316' : colors.surface2, border: 'none', borderRadius: 8, color: pastedText.trim() ? '#0A0F1E' : colors.text3, fontSize: 14, fontWeight: 700, cursor: pastedText.trim() ? 'pointer' : 'not-allowed' }}>Preview Tasks →</button>
              </div>
            </>
          )}
          {importStep === 'preview' && (
            <>
              <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 28, fontWeight: 900, color: colors.green }}>{validCount}</div><div style={{ fontSize: 12, color: colors.text3 }}>Ready</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 28, fontWeight: 900, color: colors.red }}>{parsedTasks.length - validCount}</div><div style={{ fontSize: 12, color: colors.text3 }}>Skipped</div></div>
              </div>
              <div style={{ overflowX: 'auto', borderRadius: 8, border: `1px solid ${colors.border}`, marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#1A2235' }}>
                      {['Task Name', 'Description', 'Priority', 'Due Date', 'Status'].map((h, i) => (
                        <th key={i} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: colors.text3, borderBottom: `1px solid ${colors.border}`, borderRight: i < 4 ? `1px solid ${colors.border}` : 'none' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedTasks.map((task, i) => (
                      <tr key={i} style={{ backgroundColor: task.valid ? (i % 2 === 0 ? '#111827' : colors.bg) : '#2D1515', borderBottom: `1px solid ${colors.border}` }}>
                        <td style={{ padding: '7px 12px', fontSize: 13, color: task.valid ? colors.text : colors.text3, borderRight: `1px solid ${colors.border}` }}>{task.title || '(empty)'}</td>
                        <td style={{ padding: '7px 12px', fontSize: 12, color: '#9CA3AF', borderRight: `1px solid ${colors.border}` }}>{task.description || '—'}</td>
                        <td style={{ padding: '7px 12px', fontSize: 12, borderRight: `1px solid ${colors.border}` }}><span style={{ color: task.priority === 'high' ? colors.red : task.priority === 'low' ? colors.text3 : colors.amber, fontWeight: 700 }}>{task.priority}</span></td>
                        <td style={{ padding: '7px 12px', fontSize: 12, color: '#9CA3AF', borderRight: `1px solid ${colors.border}` }}>{task.dueDate || '—'}</td>
                        <td style={{ padding: '7px 12px', fontSize: 11, fontWeight: 700 }}>{task.valid ? <span style={{ color: colors.green }}><Icon name="check" size={12} strokeWidth={3} /> Ready</span> : <span style={{ color: colors.red }}>Skip</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!selectedFolder && (
                <div style={{ backgroundColor: '#EF444415', border: '1px solid #EF444440', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: colors.red }}>
                  <Icon name="alert" style={{ marginRight: 6 }} />A folder is required — go back and select or create one above before importing.
                </div>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setImportStep('input')} style={{ padding: '10px 20px', backgroundColor: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text3, fontSize: 14, cursor: 'pointer' }}>← Edit</button>
                <button onClick={handleImport} disabled={importing || !selectedFolder || validCount === 0} style={{ flex: 1, padding: '10px 24px', backgroundColor: importing || !selectedFolder || validCount === 0 ? colors.surface2 : '#F97316', border: 'none', borderRadius: 8, color: importing || !selectedFolder || validCount === 0 ? colors.text3 : '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: importing || !selectedFolder || validCount === 0 ? 'not-allowed' : 'pointer' }}>
                  {importing ? 'Importing...' : !selectedFolder ? 'Select a folder first' : `Import ${validCount} Tasks`}
                </button>
              </div>
            </>
          )}
          {importStep === 'done' && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ width: 56, height: 56, borderRadius: 28, margin: '0 auto 12px', backgroundColor: colors.green, color: colors.onAccent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={30} strokeWidth={3} /></div>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
                {`${parsedTasks.filter(t => t.valid !== false).length} Tasks Added!`}
              </div>
              <button onClick={resetImport} style={{ padding: '10px 24px', backgroundColor: '#F97316', border: 'none', borderRadius: 8, color: '#0A0F1E', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Done</button>
            </div>
          )}
          {importStep === 'assign-checklist' && (
            <>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}><Icon name="check" size={18} strokeWidth={3} style={{ color: colors.green, marginRight: 8, verticalAlign: '-3px' }} />Tasks created!</div>
              <div style={{ fontSize: 12, color: colors.text3, marginBottom: 18 }}>
                Now add checklist items — pick a task below, then type or paste one item per line. Switching tasks (or finishing) saves what you typed automatically.
              </div>
              {assignTasksLoading ? (
                <div role="status" aria-label="Loading tasks" style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}><Skeleton height={40} radius={8} /><Skeleton height={120} radius={8} /></div>
              ) : assignableTasks.length === 0 ? (
                <div style={{ padding: '16px 0', fontSize: 13, color: colors.text3 }}>Every task in this project already has a checklist.</div>
              ) : (
                <>
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>TASK</label>
                    <select
                      value={selectedAssignTaskId}
                      onChange={(e) => handleAssignTaskChange(e.target.value)}
                      disabled={assignSaving}
                      style={{ ...inputStyle, cursor: assignSaving ? 'not-allowed' : 'pointer' }}
                    >
                      {assignableTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: colors.text3, letterSpacing: 2 }}>CHECKLIST ITEMS (ONE PER LINE)</label>
                    <span style={{ fontSize: 12, color: assignLineCount > CHECKLIST_ITEM_CAP ? colors.amber : colors.text3 }}>{assignLineCount}/{CHECKLIST_ITEM_CAP}</span>
                  </div>
                  <textarea
                    value={assignItemsText}
                    onChange={(e) => setAssignItemsText(e.target.value)}
                    disabled={assignSaving}
                    placeholder={'Faucet\nSink\nDrain trap...'}
                    style={{ ...inputStyle, resize: 'vertical', minHeight: 140, fontFamily: 'inherit' }}
                  />
                  {assignLineCount > CHECKLIST_ITEM_CAP && (
                    <div style={{ fontSize: 12, color: colors.amber, marginTop: 6 }}>Only the first {CHECKLIST_ITEM_CAP} lines will be saved for this task.</div>
                  )}
                </>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button onClick={handleFinishAssignChecklist} disabled={assignSaving} style={{ padding: '10px 24px', backgroundColor: '#F97316', border: 'none', borderRadius: 8, color: '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: assignSaving ? 'not-allowed' : 'pointer' }}>
                  {assignSaving ? 'Saving...' : 'Done — Save & Close'}
                </button>
              </div>
            </>
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
      {activeTab === 'tasks' && <div style={{ display: isMobile ? 'block' : 'grid', gridTemplateColumns: '240px minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
        {/* Folder panel (desktop): grouped, searchable, sticky */}
        {!isMobile && <aside className="fo-folder-aside" aria-label="Folders">{folderPanel}</aside>}

        <div style={{ minWidth: 0 }}>
        {/* Folder picker (phone): opens the same panel as a bottom sheet */}
        {isMobile && (
          <button
            type="button"
            onClick={() => setFolderSheetOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={folderSheetOpen}
            {...btn('secondary', { width: '100%', justifyContent: 'space-between', marginBottom: 12, padding: '12px 14px' })}
          >
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Folders: <strong style={{ fontWeight: 700 }}>{selectedFolderObj ? selectedFolderObj.name : 'All tasks'}</strong> ({selectedPanelCount})
            </span>
            <Icon name="chevron-right" size={16} style={{ transform: 'rotate(90deg)' }} />
          </button>
        )}

        {selectedFolderObj && (isAdmin || (project?.project_type === 'checklist' && canManageChecklist)) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', marginBottom: 12 }}>
            {isAdmin && <button onClick={() => { setEditingFolder(selectedFolderObj); setEditFolderName(selectedFolderObj.name); }} {...btn('ghost', small)}>Rename folder</button>}
            {isAdmin && <button onClick={() => handleDeleteFolder(selectedFolderObj)} {...btn('ghost', { ...small, color: colors.red })}>Delete folder</button>}
            {project?.project_type === 'checklist' && canManageChecklist && (
              <button onClick={() => setShowFolderChecklistEditor(true)} {...btn('secondary', small)}>Edit folder checklist</button>
            )}
          </div>
        )}

        {editingFolder && (
          <div style={{ ...card, padding: 14, marginBottom: 12, maxWidth: 420 }}>
            <input value={editFolderName} onChange={(e) => setEditFolderName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleRenameFolder()} style={{ ...inputStyle, marginBottom: 10 }} autoFocus />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setEditingFolder(null)} {...btn('ghost', { flex: 1 })}>Cancel</button>
              <button onClick={handleRenameFolder} {...btn('primary', { flex: 1 })}>Save</button>
            </div>
          </div>
        )}
        {folderDeleteBlock && (
          <div role="alert" style={{ marginBottom: 12, padding: '10px 12px', backgroundColor: colors.redSurface, border: `1px solid ${colors.red}`, borderRadius: 8, fontSize: 13, color: colors.text, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ display: 'inline-flex', gap: 8 }}><Icon name="alert" style={{ color: colors.red, marginTop: 1 }} />{folderDeleteBlock.message}</span>
            <button onClick={() => setFolderDeleteBlock(null)} aria-label="Dismiss" style={{ background: 'transparent', border: 'none', color: colors.text2, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}>Dismiss</button>
          </div>
        )}

        {/* Tasks Panel */}
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: isMobile ? '14px 16px' : '16px 20px', borderBottom: `1px solid ${colors.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontFamily: fonts.display, fontSize: 22, fontWeight: 700, letterSpacing: '0.02em', minWidth: 0, overflowWrap: 'anywhere' }}>
                {selectedFolder ? ((folders as any[])?.find((f: any) => f.id === selectedFolder)?.name ?? 'Folder') : 'All tasks'}
                {filteredTasks && <span style={{ color: colors.text3, fontWeight: 600 }}> ({filteredTasks.length})</span>}
                {showArchivedTasks && <span style={{ marginLeft: 8, verticalAlign: 'middle' }}><StatusChip status="archived" label="Archived view" /></span>}
              </h2>
              {isAdmin && (
                <button onClick={() => setShowArchivedTasks(!showArchivedTasks)} {...btn('ghost', small)}>
                  {showArchivedTasks ? 'Back to active tasks' : 'Show archived'}
                </button>
              )}
            </div>
            <input type="text" placeholder="Search tasks..." value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} style={{ ...inputStyle, backgroundColor: colors.bg }} />
          </div>
          {tasksLoading ? (
            <div role="status" aria-label="Loading tasks" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}><Skeleton width="55%" height={14} /><Skeleton width="30%" height={11} /></div>
                  <Skeleton width={90} height={24} radius={999} />
                </div>
              ))}
            </div>
          ) : filteredTasks?.length === 0 ? (
            <div style={{ padding: 20 }}>
              {taskSearch ? (
                <EmptyState title="No matching tasks" message={`No tasks match "${taskSearch}".`} actionLabel="Clear search" onAction={() => setTaskSearch('')} />
              ) : showArchivedTasks ? (
                <EmptyState title="No archived tasks" message="Tasks you archive in this view show up here." actionLabel="Back to active tasks" onAction={() => setShowArchivedTasks(false)} />
              ) : canEdit ? (
                <EmptyState title="No tasks yet" message="Add the first tasks to this project to get started." actionLabel="Add Tasks" onAction={() => { resetImport(); setShowImport(true); }} />
              ) : (
                <EmptyState title="No tasks yet" message="No tasks have been created yet." />
              )}
            </div>
          ) : (
            <div>
              {!isMobile && (
                <div style={{ display: 'grid', gridTemplateColumns: TASK_COLS, gap: 16, padding: '10px 20px', backgroundColor: colors.bg }}>
                  {['Task', 'Assigned', 'Due', 'Status', ''].map((h, hi) => <div key={hi} style={{ ...sectionLabel, fontSize: 10.5 }}>{h}</div>)}
                </div>
              )}
              {filteredTasks?.map((task: any) => {
                const isOverdue = isTaskOverdue(task);
                const names = assigneeNames(task);
                const due = (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, whiteSpace: 'nowrap', color: isOverdue ? colors.red : task.due_date ? colors.text2 : colors.text3, fontWeight: isOverdue ? 700 : 500 }}>
                    {isOverdue && <Icon name="alert" size={13} title="Overdue" />}
                    {task.due_date ? formatDateOnly(task.due_date) : '—'}
                  </span>
                );
                const status = !showArchivedTasks ? (
                  <select
                    aria-label={`Status of ${task.title}`}
                    value={task.status}
                    onChange={(e) => updateStatus({ taskId: task.id, status: e.target.value })}
                    style={{ ...chip(task.status), border: `1px solid ${statusColor(task.status)}`, padding: '4px 8px', cursor: 'pointer', outline: 'none', maxWidth: '100%' }}
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Done</option>
                  </select>
                ) : (
                  <StatusChip status="archived" />
                );
                const actions = (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: isMobile ? 'flex-start' : 'flex-end' }}>
                    {!showArchivedTasks && (
                      <>
                        <button onClick={() => openViewTask(task)} {...btn('ghost', small)}>View</button>
                        {canEdit && <button onClick={() => openEditTask(task)} {...btn('secondary', small)}>Edit</button>}
                        {isAdmin && <button onClick={() => handleArchiveTask(task)} {...btn('ghost', small)}>Archive</button>}
                      </>
                    )}
                    {showArchivedTasks && isAdmin && (
                      <>
                        <button onClick={() => handleRestoreTask(task)} {...btn('secondary', small)}>Restore</button>
                        <button onClick={() => handleDeleteTask(task)} {...btn('danger', small)}>Delete</button>
                      </>
                    )}
                  </div>
                );
                const titleBlock = (
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, overflowWrap: 'anywhere' }}>{task.title}</div>
                    {task.description && <div style={{ fontSize: 12, color: colors.text3, marginTop: 2 }}>{task.description.slice(0, 50)}{task.description.length > 50 ? '...' : ''}</div>}
                    <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <StatusChip status={task.priority} label={`${task.priority} priority`} />
                      {project?.project_type === 'checklist' && (() => {
                        const p = checklistProgress(task);
                        const complete = p.total > 0 && p.done === p.total;
                        return (
                          <span title={`Checklist: ${p.done} of ${p.total} items done`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: radius.pill, border: `1px solid ${complete ? colors.green : colors.border}`, color: complete ? colors.green : colors.text2, fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                            {complete && <Icon name="check" size={11} strokeWidth={3} />}Checklist {p.done}/{p.total}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                );
                return isMobile ? (
                  <div key={task.id} className="fo-row" style={{ padding: '14px 16px', borderTop: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {titleBlock}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <AvatarStack names={names} />
                      {due}
                      {status}
                    </div>
                    {actions}
                  </div>
                ) : (
                  <div key={task.id} className="fo-row" style={{ display: 'grid', gridTemplateColumns: TASK_COLS, gap: 16, alignItems: 'center', padding: '12px 20px', borderTop: `1px solid ${colors.border}` }}>
                    {titleBlock}
                    <div><AvatarStack names={names} /></div>
                    <div>{due}</div>
                    <div>{status}</div>
                    {actions}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </div>
      </div>}

      {isMobile && folderSheetOpen && activeTab === 'tasks' && (
        <div className="fo-sheet-backdrop" onClick={() => setFolderSheetOpen(false)}>
          <div className="fo-sheet" role="dialog" aria-modal="true" aria-labelledby="folder-sheet-title" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${colors.border}` }}>
              <h2 id="folder-sheet-title" style={{ margin: 0, fontFamily: fonts.display, fontSize: 22, fontWeight: 700, letterSpacing: '0.02em' }}>Folders</h2>
              <button type="button" onClick={() => setFolderSheetOpen(false)} {...btn('secondary', { padding: '8px 12px' })}>
                <Icon name="x" size={14} /> Close
              </button>
            </div>
            <div className="fo-sheet-body">{folderPanel}</div>
          </div>
        </div>
      )}
    </div>
  );
}