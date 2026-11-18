import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useIsMobile } from '../hooks/useIsMobile';
import { card, colors, input, sectionLabel, statusColor } from '../theme';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusChip from '../components/ui/StatusChip';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import SegmentedControl from '../components/ui/SegmentedControl';
import Icon from '../components/ui/Icon';

// Severity colors come from the theme (StatusChip): low gray, medium amber, high red, critical violet.

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

export default function IncidentsPage() {
  const [selectedProject, setSelectedProject] = useState('all');
  const [selectedSeverity, setSelectedSeverity] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const { data: projects } = useQuery({
    queryKey: ['incidents-projects'],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('id, name').eq('archived', false).order('name');
      return data ?? [];
    },
  });

  const { data: incidents, isLoading } = useQuery({
    queryKey: ['incidents', selectedProject, selectedSeverity],
    queryFn: async () => {
      let query = supabase
        .from('incidents')
        .select(`
          *,
          project:project_id (name),
          reporter:reported_by (full_name)
        `)
        .order('incident_date', { ascending: false });

      if (selectedProject !== 'all') query = query.eq('project_id', selectedProject);
      if (selectedSeverity !== 'all') query = query.eq('severity', selectedSeverity);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  const criticalCount = incidents?.filter((i) => i.severity === 'critical').length ?? 0;
  const highCount = incidents?.filter((i) => i.severity === 'high').length ?? 0;
  const thisWeek = incidents?.filter((i) => {
    const d = new Date(i.incident_date);
    return d >= new Date(Date.now() - 7 * 86400000);
  }).length ?? 0;

  function formatDate(dateStr: string) {
    return toInstant(dateStr).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }

  function formatTime(dateStr: string) {
    return toInstant(dateStr).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }

  const detailLabel: React.CSSProperties = { ...sectionLabel, margin: '0 0 6px' };

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: colors.text }}>
      <PageHeader title="Safety Incidents" subtitle="All incident reports submitted by your crew" />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatCard label="Total incidents" tone="gray" value={isLoading ? undefined : incidents?.length ?? 0} />
        <StatCard label="This week" tone="amber" value={isLoading ? undefined : thisWeek} />
        <StatCard label="High severity" tone="red" alert={highCount > 0} value={isLoading ? undefined : highCount} />
        <StatCard label="Critical" tone="violet" value={isLoading ? undefined : criticalCount} sub={criticalCount > 0 ? 'needs attention' : undefined} />
      </div>

      {/* Filters */}
      <div style={{ ...card, padding: isMobile ? 12 : 14, display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <label htmlFor="incident-project" className="fo-sr-only">Project</label>
        <select
          id="incident-project"
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          style={{ ...input, width: isMobile ? '100%' : 'auto', minWidth: 200, cursor: 'pointer', backgroundColor: colors.bg }}
        >
          <option value="all">All projects</option>
          {projects?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <SegmentedControl
          label="Severity"
          options={['all', 'low', 'medium', 'high', 'critical'].map((s) => ({ value: s, label: s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1) }))}
          value={selectedSeverity}
          onChange={setSelectedSeverity}
          fullWidth={isMobile}
        />
        <span style={{ color: colors.text3, fontSize: 13, marginLeft: isMobile ? 0 : 'auto' }}>{incidents?.length ?? 0} incident{incidents?.length !== 1 ? 's' : ''}</span>
      </div>

      {/* List */}
      {isLoading ? (
        <div role="status" aria-label="Loading incidents" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} height={72} radius={12} />)}
        </div>
      ) : (incidents ?? []).length === 0 ? (
        selectedProject !== 'all' || selectedSeverity !== 'all' ? (
          <EmptyState title="No matching incidents" message="No incidents match this project and severity." actionLabel="Show all incidents" onAction={() => { setSelectedProject('all'); setSelectedSeverity('all'); }} />
        ) : (
          <EmptyState title="No incidents reported" message="Incident reports submitted from the mobile app will appear here." />
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(incidents ?? []).map((incident: any) => {
            const open = expandedId === incident.id;
            const edge = statusColor(incident.severity);
            return (
              <div key={incident.id} style={{ ...card, padding: 0, overflow: 'hidden', borderLeft: `4px solid ${edge}` }}>
                {/* Row */}
                <button
                  type="button"
                  className="fo-row"
                  aria-expanded={open}
                  onClick={() => setExpandedId(open ? null : incident.id)}
                  style={{ width: '100%', padding: isMobile ? '14px 14px' : '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: 'transparent', border: 'none', color: 'inherit', textAlign: 'left', font: 'inherit' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>{incident.incident_type}</span>
                      <StatusChip status={incident.severity} />
                    </div>
                    <div style={{ fontSize: 13, color: colors.text2 }}>
                      <span style={{ color: colors.text, fontWeight: 600 }}>{(incident.reporter as any)?.full_name ?? 'Unknown'}</span>
                      {(incident.project as any)?.name && <span> · {(incident.project as any).name}</span>}
                      <span> · {formatDate(incident.incident_date)} at {formatTime(incident.incident_date)}</span>
                    </div>
                  </div>
                  <span aria-hidden="true" style={{ color: colors.text2, display: 'inline-flex', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }}>
                    <Icon name="chevron-down" size={18} />
                  </span>
                </button>

                {/* Expanded */}
                {open && (
                  <div style={{ padding: isMobile ? '0 14px 16px' : '0 20px 20px', borderTop: `1px solid ${colors.border}` }}>
                    {incident.description && (
                      <div style={{ marginTop: 16 }}>
                        <p style={detailLabel}>Description</p>
                        <p style={{ fontSize: 14, color: colors.text2, lineHeight: 1.6, margin: 0 }}>{incident.description}</p>
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))', gap: 16, marginTop: 16 }}>
                      {incident.injured_person && (
                        <div>
                          <p style={{ ...detailLabel, color: colors.red }}>Injured person</p>
                          <p style={{ fontSize: 14, color: colors.text, margin: 0 }}>{incident.injured_person}</p>
                        </div>
                      )}
                      {incident.location && (
                        <div>
                          <p style={detailLabel}>Location</p>
                          <p style={{ fontSize: 14, color: colors.text, margin: 0 }}>{incident.location}</p>
                        </div>
                      )}
                    </div>
                    {incident.photo_url && (
                      <div style={{ marginTop: 16 }}>
                        <p style={detailLabel}>Photo</p>
                        <img
                          src={incident.photo_url}
                          alt="Incident"
                          style={{ width: 160, height: 120, objectFit: 'cover', borderRadius: 10, cursor: 'pointer', border: `1px solid ${colors.border}` }}
                          onClick={() => window.open(incident.photo_url, '_blank')}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
