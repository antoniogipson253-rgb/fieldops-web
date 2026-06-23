import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../lib/supabase';

const severityColors: Record<string, string> = {
  low: '#1D9E75',
  medium: '#EF9F27',
  high: '#E24B4A',
  critical: '#7C3AED',
};

const severityBg: Record<string, string> = {
  low: '#1D9E7520',
  medium: '#EF9F2720',
  high: '#E24B4A20',
  critical: '#7C3AED20',
};

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

  return (
    <div style={{ padding: 32, color: '#FFFFFF' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px' }}>Safety Incidents</h1>
        <p style={{ color: '#6B7280', fontSize: 13, margin: 0 }}>All incident reports submitted by your crew</p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <div style={{ background: '#111827', borderRadius: 12, padding: '14px 16px', border: '0.5px solid #1F2937', borderLeft: '3px solid #6B7280' }}>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>Total Incidents</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{incidents?.length ?? 0}</p>
        </div>
        <div style={{ background: '#111827', borderRadius: 12, padding: '14px 16px', border: '0.5px solid #1F2937', borderLeft: '3px solid #EF9F27' }}>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>This Week</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{thisWeek}</p>
        </div>
        <div style={{ background: '#111827', borderRadius: 12, padding: '14px 16px', border: '0.5px solid #1F2937', borderLeft: '3px solid #E24B4A' }}>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>High Severity</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: highCount > 0 ? '#E24B4A' : '#FFFFFF' }}>{highCount}</p>
        </div>
        <div style={{ background: '#111827', borderRadius: 12, padding: '14px 16px', border: '0.5px solid #1F2937', borderLeft: '3px solid #7C3AED' }}>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>Critical</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: criticalCount > 0 ? '#7C3AED' : '#FFFFFF' }}>{criticalCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          style={{ padding: '10px 16px', background: '#111827', border: '1px solid #1F2937', borderRadius: 10, color: '#FFFFFF', fontSize: 14, outline: 'none', cursor: 'pointer', minWidth: 200 }}
        >
          <option value="all">All Projects</option>
          {projects?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <div style={{ display: 'flex', gap: 8 }}>
          {['all', 'low', 'medium', 'high', 'critical'].map((s) => (
            <button
              key={s}
              onClick={() => setSelectedSeverity(s)}
              style={{
                padding: '9px 16px',
                background: selectedSeverity === s ? (s === 'all' ? '#F97316' : severityColors[s]) : '#111827',
                border: '1px solid',
                borderColor: selectedSeverity === s ? (s === 'all' ? '#F97316' : severityColors[s]) : '#1F2937',
                borderRadius: 10,
                color: selectedSeverity === s ? '#FFFFFF' : '#9CA3AF',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <span style={{ color: '#4B5563', fontSize: 13 }}>{incidents?.length ?? 0} incident{incidents?.length !== 1 ? 's' : ''}</span>
      </div>

      {/* List */}
      {isLoading ? (
        <div style={{ color: '#F97316', fontSize: 13 }}>Loading...</div>
      ) : (incidents ?? []).length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#4B5563' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#FFFFFF', marginBottom: 6 }}>No incidents reported</div>
          <div style={{ fontSize: 13 }}>Incident reports submitted from the mobile app will appear here</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(incidents ?? []).map((incident: any) => (
            <div key={incident.id} style={{ background: '#111827', borderRadius: 14, border: '0.5px solid #1F2937', overflow: 'hidden' }}>
              {/* Row */}
              <div
                onClick={() => setExpandedId(expandedId === incident.id ? null : incident.id)}
                style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderLeft: `4px solid ${severityColors[incident.severity] ?? '#6B7280'}` }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#1F2937')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{incident.incident_type}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: severityColors[incident.severity], background: severityBg[incident.severity], padding: '2px 10px', borderRadius: 20 }}>
                      {incident.severity?.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: '#6B7280' }}>
                    <span style={{ color: '#F97316', fontWeight: 600 }}>{(incident.reporter as any)?.full_name ?? 'Unknown'}</span>
                    {(incident.project as any)?.name && <span> · {(incident.project as any).name}</span>}
                    <span> · {formatDate(incident.incident_date)} at {formatTime(incident.incident_date)}</span>
                  </div>
                </div>
                <span style={{ color: '#6B7280', fontSize: 18, transform: expandedId === incident.id ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>▾</span>
              </div>

              {/* Expanded */}
              {expandedId === incident.id && (
                <div style={{ padding: '0 20px 20px 24px', borderTop: '0.5px solid #1F2937' }}>
                  {incident.description && (
                    <div style={{ marginTop: 16 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, margin: '0 0 8px' }}>DESCRIPTION</p>
                      <p style={{ fontSize: 14, color: '#D1D5DB', lineHeight: 1.6, margin: 0 }}>{incident.description}</p>
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
                    {incident.injured_person && (
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 700, color: '#E24B4A', letterSpacing: 2, margin: '0 0 6px' }}>INJURED PERSON</p>
                        <p style={{ fontSize: 14, color: '#D1D5DB', margin: 0 }}>{incident.injured_person}</p>
                      </div>
                    )}
                    {incident.location && (
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, margin: '0 0 6px' }}>LOCATION</p>
                        <p style={{ fontSize: 14, color: '#D1D5DB', margin: 0 }}>{incident.location}</p>
                      </div>
                    )}
                  </div>
                  {incident.photo_url && (
                    <div style={{ marginTop: 16 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, margin: '0 0 8px' }}>PHOTO</p>
                      <img
                        src={incident.photo_url}
                        alt="Incident"
                        style={{ width: 160, height: 120, objectFit: 'cover', borderRadius: 10, cursor: 'pointer' }}
                        onClick={() => window.open(incident.photo_url, '_blank')}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}