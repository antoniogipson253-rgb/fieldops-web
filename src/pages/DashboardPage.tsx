import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useIsAdmin, useCurrentUser, useUserRole } from '../lib/useIsAdmin';
import { useIsMobile } from '../hooks/useIsMobile';
import { card as baseCard, colors, fonts, radius, sectionLabel, statusColor, tint } from '../theme';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusChip from '../components/ui/StatusChip';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import Icon from '../components/ui/Icon';

// Postgres `timestamp without time zone` columns come back from PostgREST with no
// 'Z'/offset suffix, which makes `new Date()` misparse a UTC instant as local time.
// Force UTC interpretation when no timezone marker is present.
function toInstant(timestamp: string): Date {
  // Postgres can emit a 2-digit-only UTC offset (e.g. "+00") when minutes are zero —
  // the minutes group must be optional or a valid offset like "+00" gets missed,
  // causing a spurious 'Z' to be appended and corrupting an already-correct timestamp.
  const hasTzMarker = /Z$|[+-]\d{2}(:?\d{2})?$/.test(timestamp);
  return new Date(hasTzMarker ? timestamp : `${timestamp}Z`);
}

// task_assignees is embedded as task_assignees(profile:profiles(full_name)).
function taskAssigneeNames(task: any): string {
  const names = (task?.task_assignees ?? []).map((ta: any) => ta.profile?.full_name).filter(Boolean);
  return names.length > 0 ? names.join(', ') : 'Unassigned';
}

function formatTime(dateStr: string) {
  return toInstant(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

const card: React.CSSProperties = { ...baseCard, marginBottom: 16 };

const cardTitle: React.CSSProperties = { ...sectionLabel, margin: '0 0 14px' };

const statusLabel: Record<string, string> = {
  open: 'Open', in_progress: 'In Progress', completed: 'Done',
};

// Map pin colors for the project statuses shown on the map (same colors as StatusChip).
const MAP_STATUSES = ['active', 'on_hold', 'completed'];

/** A row inside a card list: hover background, rounded, divider under it. */
const listRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 8px',
  margin: '0 -8px',
  borderRadius: 8,
  borderBottom: `1px solid ${colors.border}`,
};

const rowTitle: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: colors.text };
const rowMeta: React.CSSProperties = { fontSize: 12, color: colors.text3, marginTop: 2 };

function avatar(name: string) {
  return (
    <div style={{ width: 30, height: 30, borderRadius: 15, background: colors.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: colors.text, flexShrink: 0 }}>
      {initials(name)}
    </div>
  );
}

function LiveDot() {
  return <div aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: colors.green, flexShrink: 0 }} />;
}

function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Skeleton width="60%" height={14} />
          <Skeleton width="35%" height={11} />
        </div>
      ))}
    </div>
  );
}

function ProgressRow({ name, pct }: { name: string; pct: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
      <span style={{ fontSize: 14, fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <div style={{ flex: 2, height: 6, background: colors.track, borderRadius: 3, overflow: 'hidden', minWidth: 80 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: colors.accent, borderRadius: 3, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontFamily: fonts.display, fontSize: 18, fontWeight: 700, color: colors.text, minWidth: 44, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

function DateBadge() {
  return (
    <div style={{ fontSize: 12, color: colors.text2, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: '6px 12px' }}>{today}</div>
  );
}

function ProjectMap({ projects, projectProgress }: { projects: any[]; projectProgress: Record<string, number> }) {
  const mapRef = useRef<any>(null);
  const mapInstanceRef = useRef<any>(null);

  const mappedProjects = projects.filter((p: any) => p.latitude && p.longitude);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;
    if (mappedProjects.length === 0) return;

    import('leaflet').then((L) => {
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      });

      const map = L.map(mapRef.current!).setView(
        [mappedProjects[0].latitude, mappedProjects[0].longitude],
        10
      );

      mapInstanceRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);

      mappedProjects.forEach((p: any) => {
        const color = statusColor(p.status);
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:24px;height:24px;border-radius:50%;background:${color};border:3px solid #FFFFFF;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
          popupAnchor: [0, -16],
        });

        
        const popup = L.popup({ maxWidth: 220 }).setContent(`
          <div style="font-family:sans-serif;padding:4px;">
            <div style="font-size:14px;font-weight:700;margin-bottom:6px;">${p.name}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
              <div style="width:8px;height:8px;border-radius:50%;background:${color};"></div>
              <span style="font-size:12px;color:#666;">${p.status?.replace('_', ' ')}</span>
            </div>
            <a href="/projects/${p.id}" style="display:block;text-align:center;padding:6px 12px;background:#F97316;color:#0A0F1E;border-radius:8px;font-size:12px;font-weight:700;text-decoration:none;">
              View Project
            </a>
          </div>
        `);

        L.marker([p.latitude, p.longitude], { icon }).bindPopup(popup).addTo(map);
      });

      if (mappedProjects.length > 1) {
        const bounds = L.latLngBounds(mappedProjects.map((p: any) => [p.latitude, p.longitude]));
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappedProjects.length]);

  if (mappedProjects.length === 0) return null;

  return (
    <>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
      <div
        ref={mapRef}
        style={{ height: 300, borderRadius: 10, overflow: 'hidden', border: `1px solid ${colors.border}`, marginTop: 14 }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {MAP_STATUSES.map((status) => <StatusChip key={status} status={status} />)}
      </div>
    </>
  );
}

function AdminDashboard({ currentUserId }: { currentUserId: string }) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { data: stats } = useQuery({
    queryKey: ['admin-dash-stats'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user!.id).single();
      const companyId = profile?.company_id;

      const [projects, tasks, members, clockedInRes, flaggedRes, weekHours] = await Promise.all([
        supabase.from('projects').select('id, status').eq('archived', false),
        supabase.from('tasks').select('id, status').eq('archived', false),
        supabase.from('profiles').select('id').eq('company_id', companyId),
        supabase.from('time_entries').select('id, user_id, clock_in, project:project_id(name)').is('clock_out', null),
        supabase.from('time_entries').select('id, user_id, flag_reason, clock_in, project:project_id(name)').eq('flagged', true).gte('clock_in', new Date(Date.now() - 7 * 86400000).toISOString()).order('clock_in', { ascending: false }),
        supabase.from('time_entries').select('total_minutes').eq('company_id', companyId).gte('clock_in', new Date(Date.now() - 7 * 86400000).toISOString()).not('clock_out', 'is', null),
      ]);

      const allUserIds = [
        ...new Set([
          ...(clockedInRes.data ?? []).map((e: any) => e.user_id),
          ...(flaggedRes.data ?? []).map((e: any) => e.user_id),
        ])
      ];

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', allUserIds.length > 0 ? allUserIds : ['00000000-0000-0000-0000-000000000000']);

      const profileMap: Record<string, string> = {};
      for (const p of profiles ?? []) {
        profileMap[p.id] = p.full_name ?? 'Unknown';
      }

      const clockedIn = (clockedInRes.data ?? []).map((e: any) => ({
        ...e,
        profiles: { full_name: profileMap[e.user_id] ?? 'Unknown' },
      }));

      const flagged = (flaggedRes.data ?? []).map((e: any) => ({
        ...e,
        profiles: { full_name: profileMap[e.user_id] ?? 'Unknown' },
      }));

      const totalWeekHours = (weekHours.data ?? []).reduce((s: number, e: any) => s + (e.total_minutes ?? 0), 0) / 60;

      return {
        activeProjects: (projects.data ?? []).filter((p: any) => p.status === 'active').length,
        totalProjects: (projects.data ?? []).length,
        openTasks: (tasks.data ?? []).filter((t: any) => t.status === 'open').length,
        totalTasks: (tasks.data ?? []).length,
        memberCount: (members.data ?? []).length,
        clockedIn,
        flagged,
        weekHours: Math.round(totalWeekHours * 10) / 10,
      };
    },
    staleTime: 0,
  });

  const { data: projects } = useQuery({
    queryKey: ['admin-dash-projects'],
    queryFn: async () => {
      const { data } = await supabase
        .from('projects')
        .select('id, name, status, latitude, longitude, address')
        .eq('archived', false)
        .eq('status', 'active')
        .limit(10);
      return data ?? [];
    },
    staleTime: 0,
  });

  const projectIdsKey = (projects ?? []).map((p: any) => p.id).join(',');

  const { data: projectProgress } = useQuery({
    queryKey: ['admin-dash-progress', projectIdsKey],
    queryFn: async () => {
      if (!projects || projects.length === 0) return {};
      const result: Record<string, number> = {};
      for (const p of projects) {
        const { data } = await supabase
          .from('tasks')
          .select('status, archived')
          .eq('project_id', p.id);
        const tasks = data ?? [];
        const completed = tasks.filter((t: any) => t.status === 'completed' || t.archived).length;
        result[p.id] = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;
      }
      return result;
    },
    enabled: !!projects && projects.length > 0,
    staleTime: 0,
  });

  const { data: dueTasks } = useQuery({
    queryKey: ['admin-dash-due-tasks'],
    queryFn: async () => {
      const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString();
      const { data } = await supabase
        .from('tasks')
        .select('id, title, status, priority, due_date, project:project_id(name), task_assignees(profile:profiles(full_name))')
        .eq('archived', false)
        .neq('status', 'completed')
        .lte('due_date', nextWeek)
        .order('due_date', { ascending: true })
        .limit(5);
      return data ?? [];
    },
    staleTime: 0,
  });

  const { data: activity } = useQuery({
    queryKey: ['admin-dash-activity'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user!.id)
        .single();

      if (!profile?.company_id) return [];

      const { data: members } = await supabase
        .from('company_members')
        .select('user_id')
        .eq('company_id', profile.company_id);

      const memberIds = (members ?? []).map((m: any) => m.user_id);
      if (memberIds.length === 0) return [];

      const { data } = await supabase
        .from('notifications')
        .select('*')
        .in('user_id', memberIds)
        .order('created_at', { ascending: false })
        .limit(10);

      if (!data || data.length === 0) return [];

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', memberIds);

      const profileMap: Record<string, string> = {};
      for (const p of profiles ?? []) {
        profileMap[p.id] = p.full_name ?? 'Unknown';
      }

      return data.map((n: any) => ({
        ...n,
        senderName: profileMap[n.user_id] ?? 'Someone',
      }));
    },
    staleTime: 0,
  });

  const mappedProjects = (projects ?? []).filter((p: any) => p.latitude && p.longitude);
  const flaggedCount = stats?.flagged?.length ?? 0;

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: colors.text }}>
      <PageHeader title="Dashboard" subtitle="Good morning — here's what's happening today" actions={<DateBadge />} />

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(5, minmax(0, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatCard label="Active projects" tone="accent" value={stats?.activeProjects} sub={stats ? `of ${stats.totalProjects} total` : undefined} />
        <StatCard label="Open tasks" tone="gray" value={stats?.openTasks} sub={stats ? `of ${stats.totalTasks} total` : undefined} />
        <StatCard label="Clocked in now" tone="green" value={stats?.clockedIn?.length} sub={stats ? `of ${stats.memberCount} members` : undefined} />
        <StatCard label="Hours this week" tone="blue" value={stats?.weekHours} sub="all employees" />
        <StatCard label="Flagged clock-ins" tone="red" alert={flaggedCount > 0} value={stats ? flaggedCount : undefined} sub="this week" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 320px', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={card}>
            <p style={cardTitle}>Project progress</p>
            {projects === undefined && <ListSkeleton />}
            {projects !== undefined && projects.length === 0 && (
              <EmptyState compact title="No active projects" message="Active projects and their progress show up here." actionLabel="Go to Projects" onAction={() => navigate('/projects')} />
            )}
            {(projects ?? []).map((p: any) => (
              <ProgressRow key={p.id} name={p.name} pct={projectProgress?.[p.id] ?? 0} />
            ))}
            {mappedProjects.length > 0 && (
              <ProjectMap projects={projects ?? []} projectProgress={projectProgress ?? {}} />
            )}
            {mappedProjects.length === 0 && (projects ?? []).length > 0 && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: colors.bg, borderRadius: 8, border: `1px solid ${colors.border}` }}>
                <p style={{ fontSize: 13, color: colors.text2, margin: 0 }}>
                  No job site coordinates set yet. Open the mobile app and set coordinates on your projects to see them on the map.
                </p>
              </div>
            )}
          </div>

          <div style={card}>
            <p style={cardTitle}>Tasks due this week</p>
            {dueTasks === undefined && <ListSkeleton />}
            {dueTasks !== undefined && dueTasks.length === 0 && (
              <EmptyState compact title="Nothing due this week" message="Tasks due in the next 7 days will appear here." actionLabel="View tasks" onAction={() => navigate('/tasks')} />
            )}
            {(dueTasks ?? []).map((t: any) => (
              <div key={t.id} className="fo-row" style={{ ...listRow, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <div style={rowTitle}>{t.title}</div>
                  <div style={rowMeta}>{(t.project as any)?.name} · {taskAssigneeNames(t)}</div>
                </div>
                <StatusChip status={t.priority} />
                <StatusChip status={t.status} label={statusLabel[t.status] ?? t.status} />
              </div>
            ))}
          </div>

          {flaggedCount > 0 && (
            <div style={card}>
              <p style={cardTitle}>Flagged clock-ins this week</p>
              {(stats?.flagged ?? []).map((f: any) => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: colors.redSurface, borderRadius: 8, marginBottom: 8, border: `1px solid ${tint(colors.red, 0.4)}` }}>
                  <Icon name="alert" size={15} style={{ color: colors.red }} />
                  <span style={{ fontSize: 14, color: colors.text, flex: 1, minWidth: 0 }}>
                    <strong style={{ color: colors.red, fontWeight: 600 }}>{(f.profiles as any)?.full_name}</strong> — {f.flag_reason}
                  </span>
                  <span style={{ fontSize: 12, color: colors.text3, whiteSpace: 'nowrap' }}>{timeAgo(f.clock_in)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={card}>
            <p style={cardTitle}>Clocked in now</p>
            {stats === undefined && <ListSkeleton rows={2} />}
            {stats !== undefined && (stats.clockedIn ?? []).length === 0 && (
              <EmptyState compact title="Nobody clocked in yet" message="Crew members appear here when they clock in from the mobile app." actionLabel="View timesheet" onAction={() => navigate('/timesheet')} />
            )}
            {(stats?.clockedIn ?? []).map((e: any) => (
              <div key={e.id} style={listRow}>
                {avatar((e.profiles as any)?.full_name ?? '?')}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={rowTitle}>{(e.profiles as any)?.full_name}</div>
                  <div style={rowMeta}>Since {formatTime(e.clock_in)} · {(e.project as any)?.name ?? 'No project'}</div>
                </div>
                <LiveDot />
              </div>
            ))}
          </div>

          <div style={card}>
            <p style={cardTitle}>Recent activity</p>
            {activity === undefined && <ListSkeleton />}
            {activity !== undefined && activity.length === 0 && (
              <EmptyState compact title="No recent activity" message="Comments, status changes and reports from your team show up here." actionLabel="Go to Projects" onAction={() => navigate('/projects')} />
            )}
            {(activity ?? []).map((n: any) => (
              <div
                key={n.id}
                className={n.project_id ? 'fo-row' : undefined}
                onClick={() => { if (n.project_id) window.location.href = `/projects/${n.project_id}`; }}
                style={{ ...listRow, alignItems: 'flex-start', cursor: n.project_id ? 'pointer' : 'default' }}
              >
                <div style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, flexShrink: 0, background: n.title?.includes('Comment') ? colors.blue : n.title?.includes('Status') ? colors.amber : n.title?.includes('Report') ? colors.green : colors.gray }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, lineHeight: 1.5, color: colors.text }}>{n.body}</div>
                  <div style={rowMeta}>{timeAgo(n.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PMDashboard({ currentUserId }: { currentUserId: string }) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { data: pmProjects } = useQuery({
    queryKey: ['pm-dash-projects', currentUserId],
    queryFn: async () => {
      const { data } = await supabase
        .from('project_members')
        .select('project:project_id(id, name, status)')
        .eq('user_id', currentUserId);
      return (data ?? []).map((d: any) => d.project).filter(Boolean);
    },
    staleTime: 0,
  });

  const projectIds = (pmProjects ?? []).map((p: any) => p.id);
  const projectIdsKey = projectIds.join(',');

  const { data: projectProgress } = useQuery({
    queryKey: ['pm-dash-progress', projectIdsKey],
    queryFn: async () => {
      const result: Record<string, { total: number; completed: number }> = {};
      for (const id of projectIds) {
        const { data } = await supabase
          .from('tasks')
          .select('status, archived')
          .eq('project_id', id);
        const tasks = data ?? [];
        const completed = tasks.filter((t: any) => t.status === 'completed' || t.archived).length;
        result[id] = { total: tasks.length, completed };
      }
      return result;
    },
    enabled: projectIds.length > 0,
    staleTime: 0,
  });

  const { data: tasks } = useQuery({
    queryKey: ['pm-dash-tasks', projectIdsKey],
    queryFn: async () => {
      if (projectIds.length === 0) return [];
      const { data } = await supabase
        .from('tasks')
        .select('id, title, status, priority, due_date, project:project_id(name), task_assignees(profile:profiles(full_name))')
        .eq('archived', false)
        .in('project_id', projectIds)
        .neq('status', 'completed')
        .order('due_date', { ascending: true })
        .limit(8);
      return data ?? [];
    },
    enabled: projectIds.length > 0,
    staleTime: 0,
  });

  const { data: crew } = useQuery({
    queryKey: ['pm-dash-crew', projectIdsKey],
    queryFn: async () => {
      if (projectIds.length === 0) return [];
      const { data } = await supabase
        .from('time_entries')
        .select('id, clock_in, user_id, project:project_id(name)')
        .is('clock_out', null)
        .in('project_id', projectIds);

      if (!data || data.length === 0) return [];

      const userIds = [...new Set(data.map((e: any) => e.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);

      const profileMap: Record<string, string> = {};
      for (const p of profiles ?? []) {
        profileMap[p.id] = p.full_name ?? 'Unknown';
      }

      return data.map((e: any) => ({
        ...e,
        profiles: { full_name: profileMap[e.user_id] ?? 'Unknown' },
      }));
    },
    enabled: projectIds.length > 0,
    staleTime: 0,
  });

  const { data: reports } = useQuery({
    queryKey: ['pm-dash-reports', projectIdsKey],
    queryFn: async () => {
      if (projectIds.length === 0) return [];
      // Automatic daily reports that were emailed (readable by admins/PMs of the project's company).
      const { data } = await supabase
        .from('daily_report_sends')
        .select('id, project_id, report_date, status, sent_at, project:project_id(name)')
        .in('project_id', projectIds)
        .order('report_date', { ascending: false })
        .order('sent_at', { ascending: false })
        .limit(5);
      return data ?? [];
    },
    enabled: projectIds.length > 0,
    staleTime: 0,
  });

  const openTasks = (tasks ?? []).filter((t: any) => t.status === 'open').length;
  const inProgressTasks = (tasks ?? []).filter((t: any) => t.status === 'in_progress').length;
  // Queries that are disabled until the project list arrives stay undefined when there are no projects.
  const noProjects = pmProjects !== undefined && projectIds.length === 0;
  const tasksReady = tasks !== undefined || noProjects;
  const crewReady = crew !== undefined || noProjects;
  const reportsReady = reports !== undefined || noProjects;

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: colors.text }}>
      <PageHeader title="My Projects" subtitle="Overview of projects you're managing" actions={<DateBadge />} />

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatCard label="My projects" tone="accent" value={pmProjects === undefined ? undefined : pmProjects.length} sub="active" />
        <StatCard label="Open tasks" tone="gray" value={tasksReady ? openTasks : undefined} sub="across my projects" />
        <StatCard label="Crew on site" tone="green" value={crewReady ? (crew ?? []).length : undefined} sub="clocked in now" />
        <StatCard label="In progress" tone="blue" value={tasksReady ? inProgressTasks : undefined} sub="tasks" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 300px', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={card}>
            <p style={cardTitle}>Project progress</p>
            {pmProjects === undefined && <ListSkeleton />}
            {noProjects && (
              <EmptyState compact title="No projects assigned" message="Projects you're added to as a manager appear here." actionLabel="Go to Projects" onAction={() => navigate('/projects')} />
            )}
            {(pmProjects ?? []).map((p: any) => {
              const prog = projectProgress?.[p.id];
              const pct = prog && prog.total > 0 ? Math.round((prog.completed / prog.total) * 100) : 0;
              return <ProgressRow key={p.id} name={p.name} pct={pct} />;
            })}
          </div>

          <div style={card}>
            <p style={cardTitle}>Tasks needing attention</p>
            {!tasksReady && <ListSkeleton />}
            {tasksReady && (tasks ?? []).length === 0 && (
              <EmptyState compact title="No open tasks" message="Open and in-progress tasks on your projects show up here." actionLabel="View tasks" onAction={() => navigate('/tasks')} />
            )}
            {(tasks ?? []).map((t: any) => (
              <div key={t.id} className="fo-row" style={{ ...listRow, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <div style={rowTitle}>{t.title}</div>
                  <div style={rowMeta}>{(t.project as any)?.name} · {taskAssigneeNames(t)}</div>
                </div>
                <StatusChip status={t.priority} />
                <StatusChip status={t.status} label={statusLabel[t.status] ?? t.status} />
              </div>
            ))}
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={card}>
            <p style={cardTitle}>Crew on site now</p>
            {!crewReady && <ListSkeleton rows={2} />}
            {crewReady && (crew ?? []).length === 0 && (
              <EmptyState compact title="Nobody on site" message="Crew members appear here when they clock in on one of your projects." actionLabel="View team" onAction={() => navigate('/team')} />
            )}
            {(crew ?? []).map((e: any) => (
              <div key={e.id} style={listRow}>
                {avatar((e.profiles as any)?.full_name ?? '?')}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={rowTitle}>{(e.profiles as any)?.full_name}</div>
                  <div style={rowMeta}>{(e.project as any)?.name} · Since {formatTime(e.clock_in)}</div>
                </div>
                <LiveDot />
              </div>
            ))}
          </div>

          <div style={card}>
            <p style={cardTitle}>Recent reports</p>
            {!reportsReady && <ListSkeleton rows={2} />}
            {reportsReady && (reports ?? []).length === 0 && (
              <EmptyState compact title="No reports sent yet." message="Automatic daily reports appear here after they are emailed." actionLabel="Open Reports" onAction={() => navigate('/reports')} />
            )}
            {(reports ?? []).map((r: any) => (
              <button
                key={r.id}
                className="fo-row"
                onClick={() => navigate(`/projects/${r.project_id}/daily-reports`)}
                style={{ ...listRow, width: 'calc(100% + 16px)', borderTop: 'none', borderLeft: 'none', borderRight: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', font: 'inherit' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={rowTitle}>{(r.project as any)?.name}</div>
                  <div style={rowMeta}>Daily report · {new Date(r.report_date + 'T12:00:00').toLocaleDateString()}</div>
                </div>
                <StatusChip status={r.status} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkerDashboard({ currentUserId }: { currentUserId: string }) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { data: clockStatus } = useQuery({
    queryKey: ['worker-clock-status', currentUserId],
    queryFn: async () => {
      const { data } = await supabase
        .from('time_entries')
        .select('id, clock_in, project:project_id(name)')
        .eq('user_id', currentUserId)
        .is('clock_out', null)
        .maybeSingle();
      return data;
    },
    staleTime: 0,
  });

  const { data: weekEntries } = useQuery({
    queryKey: ['worker-week-entries', currentUserId],
    queryFn: async () => {
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
      startOfWeek.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from('time_entries')
        .select('total_minutes, clock_in')
        .eq('user_id', currentUserId)
        .gte('clock_in', startOfWeek.toISOString())
        .not('clock_out', 'is', null);
      return data ?? [];
    },
    staleTime: 0,
  });

  const { data: myTasks } = useQuery({
    queryKey: ['worker-tasks', currentUserId],
    queryFn: async () => {
      if (!currentUserId) return [];
      // "My Tasks" — resolved via task_assignees now instead of a single
      // assigned_to column. This is the actual visibility for this widget.
      const { data: myAssignments, error: assignErr } = await supabase
        .from('task_assignees')
        .select('task_id')
        .eq('user_id', currentUserId);
      if (assignErr) throw assignErr;
      const taskIds = (myAssignments ?? []).map((a: any) => a.task_id);
      if (taskIds.length === 0) return [];

      const { data } = await supabase
        .from('tasks')
        .select('id, title, status, priority, due_date, project:project_id(name)')
        .in('id', taskIds)
        .eq('archived', false)
        .order('due_date', { ascending: true })
        .limit(8);
      return data ?? [];
    },
    staleTime: 0,
  });

  const weekMinutes = (weekEntries ?? []).reduce((s, e: any) => s + (e.total_minutes ?? 0), 0);
  const weekHours = Math.round((weekMinutes / 60) * 10) / 10;
  const regularHours = Math.min(weekHours, 40);
  const overtimeHours = Math.max(0, weekHours - 40);

  const todayKey = new Date().toLocaleDateString('en-US');
  const todayMinutes = (weekEntries ?? [])
    .filter((e: any) => new Date(e.clock_in).toLocaleDateString('en-US') === todayKey)
    .reduce((s: number, e: any) => s + (e.total_minutes ?? 0), 0);
  const todayHours = Math.round((todayMinutes / 60) * 10) / 10;

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + i);
    return d;
  });

  const dailyHours = days.map((d) => {
    const key = d.toLocaleDateString('en-US');
    const mins = (weekEntries ?? [])
      .filter((e: any) => new Date(e.clock_in).toLocaleDateString('en-US') === key)
      .reduce((s: number, e: any) => s + (e.total_minutes ?? 0), 0);
    return Math.round((mins / 60) * 10) / 10;
  });

  const maxHours = Math.max(...dailyHours, 1);
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const isClockedIn = !!clockStatus;

  const hoursReady = weekEntries !== undefined;

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: colors.text }}>
      <PageHeader
        title="My Day"
        subtitle={isClockedIn ? `On site — ${(clockStatus.project as any)?.name ?? 'No project'}` : 'Not clocked in'}
        actions={<DateBadge />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, marginBottom: 16 }}>
        <div style={{ ...baseCard, background: isClockedIn ? tint(colors.green, 0.1) : colors.surface, borderColor: isClockedIn ? colors.green : colors.border }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            {isClockedIn && <LiveDot />}
            <span style={{ fontFamily: fonts.display, fontSize: 24, fontWeight: 700, letterSpacing: '0.02em', color: isClockedIn ? colors.green : colors.text }}>
              {isClockedIn ? 'Clocked in' : 'Clocked out'}
            </span>
          </div>
          <p style={{ fontSize: 14, color: colors.text2, margin: '0 0 14px' }}>
            {isClockedIn ? `Since ${formatTime(clockStatus.clock_in)}` : 'Tap Time Clock to clock in'}
          </p>
          <div style={{ fontSize: 12, color: colors.text3 }}>Use the Time Clock page to clock in/out</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          <StatCard label="Today" tone="accent" value={hoursReady ? `${todayHours}h` : undefined} />
          <StatCard label="This week" tone="blue" value={hoursReady ? `${weekHours}h` : undefined} />
          <StatCard label="Regular" tone="green" value={hoursReady ? `${regularHours}h` : undefined} />
          <StatCard label="Overtime" tone="gray" alert={overtimeHours > 0} value={hoursReady ? `${overtimeHours}h` : undefined} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
        <div style={card}>
          <p style={cardTitle}>My tasks</p>
          {myTasks === undefined && <ListSkeleton />}
          {myTasks !== undefined && myTasks.length === 0 && (
            <EmptyState compact title="No tasks assigned to you" message="Tasks your manager assigns to you will show up here." actionLabel="View tasks" onAction={() => navigate('/tasks')} />
          )}
          {(myTasks ?? []).map((t: any) => {
            const done = t.status === 'completed';
            return (
              <div key={t.id} className="fo-row" style={listRow}>
                <div style={{ width: 18, height: 18, borderRadius: 5, border: done ? 'none' : `1.5px solid ${colors.text3}`, background: done ? colors.green : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: colors.onAccent }}>
                  {done && <Icon name="check" size={12} strokeWidth={3} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...rowTitle, textDecoration: done ? 'line-through' : 'none', color: done ? colors.text3 : colors.text }}>{t.title}</div>
                  <div style={rowMeta}>{(t.project as any)?.name}</div>
                </div>
                <StatusChip status={t.status} label={statusLabel[t.status] ?? t.status} />
              </div>
            );
          })}
        </div>

        <div style={card}>
          <p style={cardTitle}>My hours this week</p>
          {!hoursReady ? (
            <Skeleton height={100} radius={8} />
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 84, marginBottom: 8 }}>
                {dailyHours.map((h, i) => {
                  const isToday = days[i].toDateString() === new Date().toDateString();
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: isToday ? colors.text : colors.text3 }}>{h > 0 ? h : ''}</span>
                      <div style={{ width: '100%', height: h > 0 ? `${Math.round((h / maxHours) * 60)}px` : '4px', background: h > 0 ? colors.blue : colors.track, borderRadius: '3px 3px 0 0', minHeight: 4, outline: isToday ? `2px solid ${colors.text}` : 'none', outlineOffset: 1 }} />
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {dayLabels.map((d, i) => {
                  const isToday = days[i].toDateString() === new Date().toDateString();
                  return <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 11, fontWeight: isToday ? 700 : 500, color: isToday ? colors.text : colors.text3 }}>{d}</div>;
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  const isMobile = useIsMobile();
  return (
    <div style={{ padding: isMobile ? 16 : 32 }} role="status" aria-label="Loading dashboard">
      <Skeleton width={220} height={34} />
      <Skeleton width={280} height={14} style={{ marginTop: 10, marginBottom: 24 }} />
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 20 }}>
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={96} radius={12} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 320px', gap: 16 }}>
        <Skeleton height={220} radius={12} />
        <Skeleton height={220} radius={12} />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: isAdmin } = useIsAdmin();
  const { data: currentUser } = useCurrentUser();
  const { data: userRole } = useUserRole();

  if (!currentUser || userRole === undefined) {
    return <DashboardSkeleton />;
  }

  if (isAdmin) return <AdminDashboard currentUserId={currentUser.id} />;
  if (userRole === 'project_manager') return <PMDashboard currentUserId={currentUser.id} />;
  return <WorkerDashboard currentUserId={currentUser.id} />;
}