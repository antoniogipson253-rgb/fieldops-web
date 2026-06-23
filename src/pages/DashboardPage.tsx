import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useIsAdmin, useCurrentUser, useUserRole } from '../lib/useIsAdmin';
import { useIsMobile } from '../hooks/useIsMobile';

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

const card: React.CSSProperties = {
  background: '#111827',
  border: '0.5px solid #1F2937',
  borderRadius: 14,
  padding: '18px 20px',
  marginBottom: 14,
};

const cardTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#6B7280',
  letterSpacing: 2,
  textTransform: 'uppercase',
  margin: '0 0 14px',
};

const statCard = (accentColor: string): React.CSSProperties => ({
  background: '#111827',
  border: '0.5px solid #1F2937',
  borderLeft: `3px solid ${accentColor}`,
  borderRadius: 12,
  padding: '14px 16px',
});

const badge = (bg: string, color: string): React.CSSProperties => ({
  fontSize: 11,
  padding: '3px 8px',
  borderRadius: 6,
  fontWeight: 600,
  background: bg,
  color,
  whiteSpace: 'nowrap',
});

const priorityBadge: Record<string, React.CSSProperties> = {
  high: badge('#FCEBEB', '#A32D2D'),
  medium: badge('#FAEEDA', '#854F0B'),
  low: badge('#EAF3DE', '#3B6D11'),
};

const statusBadge: Record<string, React.CSSProperties> = {
  open: badge('#1F2937', '#9CA3AF'),
  in_progress: badge('#E6F1FB', '#185FA5'),
  completed: badge('#EAF3DE', '#3B6D11'),
};

const statusLabel: Record<string, string> = {
  open: 'Open', in_progress: 'In Progress', completed: 'Done',
};

const statusColors: Record<string, string> = {
  active: '#22C55E',
  on_hold: '#F97316',
  completed: '#6B7280',
};

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
        const color = statusColors[p.status] ?? '#6B7280';
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
            <a href="/projects/${p.id}" style="display:block;text-align:center;padding:6px 12px;background:#F97316;color:#FFFFFF;border-radius:6px;font-size:12px;font-weight:700;text-decoration:none;">
              View Project →
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
        style={{ height: 300, borderRadius: 10, overflow: 'hidden', border: '1px solid #1F2937', marginTop: 14 }}
      />
      <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
        {Object.entries(statusColors).map(([status, color]) => (
          <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
            <span style={{ fontSize: 11, color: '#6B7280' }}>{status.replace('_', ' ')}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function AdminDashboard({ currentUserId }: { currentUserId: string }) {
  const isMobile = useIsMobile();
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
        .select('id, title, status, priority, due_date, project:project_id(name), assignee:assigned_to(full_name)')
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

  const barColors = ['#378ADD', '#EF9F27', '#1D9E75', '#E24B4A', '#8B5CF6'];
  const mappedProjects = (projects ?? []).filter((p: any) => p.latitude && p.longitude);

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: '#FFFFFF' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px' }}>Dashboard</h1>
          <p style={{ color: '#6B7280', fontSize: 13, margin: 0 }}>Good morning — here's what's happening today</p>
        </div>
        <div style={{ fontSize: 12, color: '#6B7280', background: '#111827', border: '0.5px solid #1F2937', borderRadius: 8, padding: '6px 12px' }}>{today}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
        <div style={statCard('#378ADD')}>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>Active projects</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{stats?.activeProjects ?? 0}</p>
          <p style={{ fontSize: 11, color: '#4B5563', margin: '3px 0 0' }}>of {stats?.totalProjects ?? 0} total</p>
        </div>
        <div style={statCard('#EF9F27')}>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>Open tasks</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{stats?.openTasks ?? 0}</p>
          <p style={{ fontSize: 11, color: '#4B5563', margin: '3px 0 0' }}>of {stats?.totalTasks ?? 0} total</p>
        </div>
        <div style={statCard('#1D9E75')}>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>Clocked in now</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{stats?.clockedIn?.length ?? 0}</p>
          <p style={{ fontSize: 11, color: '#4B5563', margin: '3px 0 0' }}>of {stats?.memberCount ?? 0} members</p>
        </div>
        <div style={statCard('#639922')}>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>Hours this week</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{stats?.weekHours ?? 0}</p>
          <p style={{ fontSize: 11, color: '#4B5563', margin: '3px 0 0' }}>all employees</p>
        </div>
        <div style={statCard('#E24B4A')}>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>Flagged clock-ins</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{stats?.flagged?.length ?? 0}</p>
          <p style={{ fontSize: 11, color: '#4B5563', margin: '3px 0 0' }}>this week</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 320px', gap: 16 }}>
        <div>
          <div style={card}>
            <p style={cardTitle}>Project progress</p>
            {(projects ?? []).length === 0 && <p style={{ color: '#4B5563', fontSize: 13 }}>No active projects.</p>}
            {(projects ?? []).map((p: any, i: number) => {
              const pct = projectProgress?.[p.id] ?? 0;
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  <div style={{ flex: 2, height: 5, background: '#1F2937', borderRadius: 3, overflow: 'hidden', minWidth: 80 }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: barColors[i % barColors.length], borderRadius: 3, transition: 'width 0.4s ease' }} />
                  </div>
                  <span style={{ fontSize: 12, color: '#6B7280', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                </div>
              );
            })}
            {mappedProjects.length > 0 && (
              <ProjectMap projects={projects ?? []} projectProgress={projectProgress ?? {}} />
            )}
            {mappedProjects.length === 0 && (projects ?? []).length > 0 && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: '#0D1321', borderRadius: 8, border: '1px solid #1F2937' }}>
                <p style={{ fontSize: 12, color: '#4B5563', margin: 0 }}>
                  No job site coordinates set yet. Open the mobile app and set coordinates on your projects to see them on the map.
                </p>
              </div>
            )}
          </div>

          <div style={card}>
            <p style={cardTitle}>Tasks due this week</p>
            {(dueTasks ?? []).length === 0 && <p style={{ color: '#4B5563', fontSize: 13 }}>No tasks due this week.</p>}
            {(dueTasks ?? []).map((t: any) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '0.5px solid #1F2937' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{t.title}</div>
                  <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{(t.project as any)?.name} · {(t.assignee as any)?.full_name ?? 'Unassigned'}</div>
                </div>
                <span style={priorityBadge[t.priority] ?? badge('#1F2937', '#9CA3AF')}>{t.priority}</span>
                <span style={statusBadge[t.status] ?? badge('#1F2937', '#9CA3AF')}>{statusLabel[t.status] ?? t.status}</span>
              </div>
            ))}
          </div>

          {(stats?.flagged ?? []).length > 0 && (
            <div style={card}>
              <p style={cardTitle}>Flagged clock-ins this week</p>
              {(stats?.flagged ?? []).map((f: any) => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#FCEBEB10', borderRadius: 8, marginBottom: 8, border: '0.5px solid #A32D2D40' }}>
                  <span style={{ fontSize: 13, color: '#EF4444', flex: 1 }}>{(f.profiles as any)?.full_name} — {f.flag_reason}</span>
                  <span style={{ fontSize: 11, color: '#6B7280' }}>{timeAgo(f.clock_in)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div style={card}>
            <p style={cardTitle}>Clocked in now</p>
            {(stats?.clockedIn ?? []).length === 0 && <p style={{ color: '#4B5563', fontSize: 13 }}>Nobody clocked in yet.</p>}
            {(stats?.clockedIn ?? []).map((e: any) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '0.5px solid #1F2937' }}>
                <div style={{ width: 28, height: 28, borderRadius: 14, background: '#1F2937', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#F97316', flexShrink: 0 }}>
                  {initials((e.profiles as any)?.full_name ?? '?')}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{(e.profiles as any)?.full_name}</div>
                  <div style={{ fontSize: 11, color: '#6B7280' }}>Since {formatTime(e.clock_in)} · {(e.project as any)?.name ?? 'No project'}</div>
                </div>
                <div style={{ width: 7, height: 7, borderRadius: 4, background: '#1D9E75', flexShrink: 0 }} />
              </div>
            ))}
          </div>

          <div style={card}>
            <p style={cardTitle}>Recent Activity</p>
            {(activity ?? []).length === 0 && (
              <p style={{ color: '#4B5563', fontSize: 13 }}>No recent activity.</p>
            )}
            {(activity ?? []).map((n: any) => (
              <div
                key={n.id}
                onClick={() => { if (n.project_id) window.location.href = `/projects/${n.project_id}`; }}
                style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: '0.5px solid #1F2937', alignItems: 'flex-start', cursor: n.project_id ? 'pointer' : 'default', borderRadius: 6 }}
                onMouseOver={(e) => { if (n.project_id) (e.currentTarget as HTMLDivElement).style.background = '#1F293740'; }}
                onMouseOut={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
              >
                <div style={{ width: 7, height: 7, borderRadius: 4, marginTop: 5, flexShrink: 0, background: n.title?.includes('Comment') ? '#378ADD' : n.title?.includes('Status') ? '#F97316' : n.title?.includes('Report') ? '#1D9E75' : '#6B7280' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, lineHeight: 1.5, color: '#FFFFFF' }}>{n.body}</div>
                  <div style={{ fontSize: 11, color: '#4B5563', marginTop: 2 }}>{timeAgo(n.created_at)}</div>
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
        .select('id, title, status, priority, due_date, project:project_id(name), assignee:assigned_to(full_name)')
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
      const { data } = await supabase
        .from('daily_reports')
        .select('id, report_date, project:project_id(name), author:created_by(full_name)')
        .in('project_id', projectIds)
        .order('report_date', { ascending: false })
        .limit(5);
      return data ?? [];
    },
    enabled: projectIds.length > 0,
    staleTime: 0,
  });

  const barColors = ['#378ADD', '#EF9F27', '#1D9E75', '#E24B4A'];
  const openTasks = (tasks ?? []).filter((t: any) => t.status === 'open').length;
  const inProgressTasks = (tasks ?? []).filter((t: any) => t.status === 'in_progress').length;

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: '#FFFFFF' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px' }}>My Projects</h1>
          <p style={{ color: '#6B7280', fontSize: 13, margin: 0 }}>Overview of projects you're managing</p>
        </div>
        <div style={{ fontSize: 12, color: '#6B7280', background: '#111827', border: '0.5px solid #1F2937', borderRadius: 8, padding: '6px 12px' }}>{today}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <div style={statCard('#378ADD')}>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>My projects</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{(pmProjects ?? []).length}</p>
          <p style={{ fontSize: 11, color: '#4B5563', margin: '3px 0 0' }}>active</p>
        </div>
        <div style={statCard('#EF9F27')}>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>Open tasks</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{openTasks}</p>
          <p style={{ fontSize: 11, color: '#4B5563', margin: '3px 0 0' }}>across my projects</p>
        </div>
        <div style={statCard('#1D9E75')}>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>Crew on site</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{(crew ?? []).length}</p>
          <p style={{ fontSize: 11, color: '#4B5563', margin: '3px 0 0' }}>clocked in now</p>
        </div>
        <div style={statCard('#E24B4A')}>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>In progress</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{inProgressTasks}</p>
          <p style={{ fontSize: 11, color: '#4B5563', margin: '3px 0 0' }}>tasks</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 300px', gap: 16 }}>
        <div>
          <div style={card}>
            <p style={cardTitle}>Project progress</p>
            {(pmProjects ?? []).length === 0 && <p style={{ color: '#4B5563', fontSize: 13 }}>No projects assigned.</p>}
            {(pmProjects ?? []).map((p: any, i: number) => {
              const prog = projectProgress?.[p.id];
              const pct = prog && prog.total > 0 ? Math.round((prog.completed / prog.total) * 100) : 0;
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  <div style={{ flex: 2, height: 5, background: '#1F2937', borderRadius: 3, overflow: 'hidden', minWidth: 80 }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: barColors[i % barColors.length], borderRadius: 3, transition: 'width 0.4s ease' }} />
                  </div>
                  <span style={{ fontSize: 12, color: '#6B7280', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                </div>
              );
            })}
          </div>

          <div style={card}>
            <p style={cardTitle}>Tasks needing attention</p>
            {(tasks ?? []).length === 0 && <p style={{ color: '#4B5563', fontSize: 13 }}>No open tasks.</p>}
            {(tasks ?? []).map((t: any) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '0.5px solid #1F2937' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{t.title}</div>
                  <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{(t.project as any)?.name} · {(t.assignee as any)?.full_name ?? 'Unassigned'}</div>
                </div>
                <span style={priorityBadge[t.priority] ?? badge('#1F2937', '#9CA3AF')}>{t.priority}</span>
                <span style={statusBadge[t.status] ?? badge('#1F2937', '#9CA3AF')}>{statusLabel[t.status] ?? t.status}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div style={card}>
            <p style={cardTitle}>Crew on site now</p>
            {(crew ?? []).length === 0 && <p style={{ color: '#4B5563', fontSize: 13 }}>Nobody clocked in.</p>}
            {(crew ?? []).map((e: any) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '0.5px solid #1F2937' }}>
                <div style={{ width: 28, height: 28, borderRadius: 14, background: '#1F2937', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#F97316', flexShrink: 0 }}>
                  {initials((e.profiles as any)?.full_name ?? '?')}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{(e.profiles as any)?.full_name}</div>
                  <div style={{ fontSize: 11, color: '#6B7280' }}>{(e.project as any)?.name} · Since {formatTime(e.clock_in)}</div>
                </div>
                <div style={{ width: 7, height: 7, borderRadius: 4, background: '#1D9E75', flexShrink: 0 }} />
              </div>
            ))}
          </div>

          <div style={card}>
            <p style={cardTitle}>Recent reports</p>
            {(reports ?? []).length === 0 && <p style={{ color: '#4B5563', fontSize: 13 }}>No reports submitted.</p>}
            {(reports ?? []).map((r: any) => (
              <div key={r.id} style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: '0.5px solid #1F2937', alignItems: 'flex-start' }}>
                <div style={{ width: 7, height: 7, borderRadius: 4, background: '#378ADD', marginTop: 5, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13 }}>Daily report — {(r.project as any)?.name}</div>
                  <div style={{ fontSize: 11, color: '#4B5563', marginTop: 2 }}>{(r.author as any)?.full_name} · {new Date(r.report_date).toLocaleDateString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkerDashboard({ currentUserId }: { currentUserId: string }) {
  const isMobile = useIsMobile();
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
      const { data } = await supabase
        .from('tasks')
        .select('id, title, status, priority, due_date, project:project_id(name)')
        .eq('assigned_to', currentUserId)
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

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: '#FFFFFF' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px' }}>My Day</h1>
          <p style={{ color: '#6B7280', fontSize: 13, margin: 0 }}>
            {isClockedIn ? `On site — ${(clockStatus.project as any)?.name ?? 'No project'}` : 'Not clocked in'}
          </p>
        </div>
        <div style={{ fontSize: 12, color: '#6B7280', background: '#111827', border: '0.5px solid #1F2937', borderRadius: 8, padding: '6px 12px' }}>{today}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div style={{ background: isClockedIn ? '#0F2D1F' : '#111827', border: `0.5px solid ${isClockedIn ? '#1D9E75' : '#1F2937'}`, borderRadius: 14, padding: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: isClockedIn ? '#1D9E75' : '#6B7280', margin: '0 0 4px' }}>
            {isClockedIn ? 'Clocked in' : 'Clocked out'}
          </p>
          <p style={{ fontSize: 12, color: isClockedIn ? '#5DCAA5' : '#4B5563', margin: '0 0 16px' }}>
            {isClockedIn ? `Since ${formatTime(clockStatus.clock_in)}` : 'Tap Time Clock to clock in'}
          </p>
          <div style={{ fontSize: 11, color: '#4B5563', marginTop: 4 }}>Use the Time Clock page to clock in/out</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={statCard('#378ADD')}>
            <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>Today</p>
            <p style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{todayHours}h</p>
          </div>
          <div style={statCard('#1D9E75')}>
            <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>This week</p>
            <p style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{weekHours}h</p>
          </div>
          <div style={statCard('#EF9F27')}>
            <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>Regular</p>
            <p style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{regularHours}h</p>
          </div>
          <div style={statCard(overtimeHours > 0 ? '#E24B4A' : '#4B5563')}>
            <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>Overtime</p>
            <p style={{ fontSize: 22, fontWeight: 700, margin: 0, color: overtimeHours > 0 ? '#EF4444' : '#FFFFFF' }}>{overtimeHours}h</p>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
        <div style={card}>
          <p style={cardTitle}>My tasks</p>
          {(myTasks ?? []).length === 0 && <p style={{ color: '#4B5563', fontSize: 13 }}>No tasks assigned to you.</p>}
          {(myTasks ?? []).map((t: any) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '0.5px solid #1F2937' }}>
              <div style={{ width: 16, height: 16, borderRadius: 4, border: t.status === 'completed' ? 'none' : '1.5px solid #374151', background: t.status === 'completed' ? '#1D9E75' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {t.status === 'completed' && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, textDecoration: t.status === 'completed' ? 'line-through' : 'none', color: t.status === 'completed' ? '#6B7280' : '#FFFFFF' }}>{t.title}</div>
                <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{(t.project as any)?.name}</div>
              </div>
              <span style={statusBadge[t.status] ?? badge('#1F2937', '#9CA3AF')}>{statusLabel[t.status] ?? t.status}</span>
            </div>
          ))}
        </div>

        <div style={card}>
          <p style={cardTitle}>My hours this week</p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 80, marginBottom: 8 }}>
            {dailyHours.map((h, i) => {
              const isToday = days[i].toDateString() === new Date().toDateString();
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 10, color: '#6B7280' }}>{h > 0 ? h : ''}</span>
                  <div style={{ width: '100%', height: h > 0 ? `${Math.round((h / maxHours) * 60)}px` : '4px', background: isToday ? '#F97316' : h > 0 ? '#378ADD' : '#1F2937', borderRadius: '3px 3px 0 0', minHeight: 4 }} />
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {dayLabels.map((d, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: days[i].toDateString() === new Date().toDateString() ? '#F97316' : '#6B7280' }}>{d}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: isAdmin } = useIsAdmin();
  const { data: currentUser } = useCurrentUser();
  const { data: userRole } = useUserRole();

  if (!currentUser || userRole === undefined) {
    return <div style={{ padding: 32, color: '#F97316' }}>Loading...</div>;
  }

  if (isAdmin) return <AdminDashboard currentUserId={currentUser.id} />;
  if (userRole === 'project_manager') return <PMDashboard currentUserId={currentUser.id} />;
  return <WorkerDashboard currentUserId={currentUser.id} />;
}