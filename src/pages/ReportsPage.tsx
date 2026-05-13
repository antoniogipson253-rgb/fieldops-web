import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function ReportsPage() {
  const [selectedProject, setSelectedProject] = useState('all');
  const [expandedReport, setExpandedReport] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'date' | 'name'>('date');

  const { data: projects } = useQuery({
    queryKey: ['web-reports-projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name')
        .eq('archived', false)
        .order('name', { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: reports, isLoading } = useQuery({
    queryKey: ['web-reports', selectedProject],
    queryFn: async () => {
      let query = supabase
        .from('daily_reports')
        .select(`
          *,
          project:project_id (name),
          author:created_by (full_name)
        `)
        .order('report_date', { ascending: false });

      if (selectedProject !== 'all') {
        query = query.eq('project_id', selectedProject);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const sortedReports = [...(reports ?? [])].sort((a, b) => {
    if (sortBy === 'name') {
      const nameA = (a.author as any)?.full_name ?? '';
      const nameB = (b.author as any)?.full_name ?? '';
      return nameA.localeCompare(nameB);
    }
    return new Date(b.report_date).getTime() - new Date(a.report_date).getTime();
  });

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  return (
    <div style={{ padding: 32, color: '#FFFFFF' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, marginBottom: 4 }}>Daily Reports</h1>
        <p style={{ color: '#6B7280', fontSize: 14, margin: 0 }}>
          Field reports submitted by your crew
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          style={{
            padding: '10px 16px',
            backgroundColor: '#111827',
            border: '1px solid #1F2937',
            borderRadius: 10,
            color: '#FFFFFF',
            fontSize: 14,
            outline: 'none',
            cursor: 'pointer',
            minWidth: 200,
          }}
        >
          <option value="all">All Projects</option>
          {projects?.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {/* Sort buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setSortBy('date')}
            style={{
              padding: '10px 16px',
              backgroundColor: sortBy === 'date' ? '#F97316' : '#111827',
              border: '1px solid',
              borderColor: sortBy === 'date' ? '#F97316' : '#1F2937',
              borderRadius: 10,
              color: sortBy === 'date' ? '#0A0F1E' : '#9CA3AF',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            📅 Sort by Date
          </button>
          <button
            onClick={() => setSortBy('name')}
            style={{
              padding: '10px 16px',
              backgroundColor: sortBy === 'name' ? '#F97316' : '#111827',
              border: '1px solid',
              borderColor: sortBy === 'name' ? '#F97316' : '#1F2937',
              borderRadius: 10,
              color: sortBy === 'name' ? '#0A0F1E' : '#9CA3AF',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            👤 Sort by Name
          </button>
        </div>

        <span style={{ color: '#4B5563', fontSize: 13 }}>
          {sortedReports.length} report{sortedReports.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Reports List */}
      {isLoading ? (
        <div style={{ color: '#F97316' }}>Loading...</div>
      ) : sortedReports.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#4B5563' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📝</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#FFFFFF', marginBottom: 6 }}>No reports yet</div>
          <div style={{ fontSize: 14 }}>Daily reports submitted from the mobile app will appear here</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sortedReports.map((report) => (
            <div key={report.id} style={{
              backgroundColor: '#111827',
              borderRadius: 14,
              border: '1px solid #1F2937',
              overflow: 'hidden',
            }}>
              {/* Report Header */}
              <div
                onClick={() => setExpandedReport(expandedReport === report.id ? null : report.id)}
                style={{
                  padding: '16px 24px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1F2937')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                    {formatDate(report.report_date)}
                  </div>
                  <div style={{ fontSize: 13, color: '#6B7280' }}>
                    <span style={{ color: '#F97316', fontWeight: 600 }}>
                      {(report.author as any)?.full_name ?? 'Unknown'}
                    </span>
                    {' '}•{' '}
                    {(report.project as any)?.name}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {report.weather && (
                    <span style={{
                      fontSize: 12,
                      color: '#9CA3AF',
                      backgroundColor: '#1F2937',
                      padding: '4px 10px',
                      borderRadius: 20,
                    }}>
                      🌤 {report.weather}
                    </span>
                  )}
                  {report.issues && (
                    <span style={{
                      fontSize: 12,
                      color: '#EF4444',
                      backgroundColor: '#EF444420',
                      padding: '4px 10px',
                      borderRadius: 20,
                    }}>
                      ⚠️ Issues
                    </span>
                  )}
                  <span style={{
                    color: '#6B7280',
                    fontSize: 18,
                    transform: expandedReport === report.id ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s',
                    display: 'inline-block',
                  }}>
                    ▾
                  </span>
                </div>
              </div>

              {/* Report Body */}
              {expandedReport === report.id && (
                <div style={{ padding: '0 24px 24px 24px', borderTop: '1px solid #1F2937' }}>
                  {report.notes && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>NOTES</div>
                      <div style={{ fontSize: 14, color: '#D1D5DB', lineHeight: 1.6 }}>{report.notes}</div>
                    </div>
                  )}
                  {report.issues && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#EF4444', letterSpacing: 2, marginBottom: 8 }}>⚠️ ISSUES</div>
                      <div style={{ fontSize: 14, color: '#D1D5DB', lineHeight: 1.6 }}>{report.issues}</div>
                    </div>
                  )}
                  {report.crew_log && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>CREW LOG</div>
                      <div style={{ fontSize: 14, color: '#D1D5DB', lineHeight: 1.6 }}>{report.crew_log}</div>
                    </div>
                  )}
                  {report.photo_keys?.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>
                        PHOTOS ({report.photo_keys.length})
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {report.photo_keys.map((key: string) => {
                          const { data } = supabase.storage.from('task-photos').getPublicUrl(key);
                          return (
                            <img
                              key={key}
                              src={data.publicUrl}
                              alt="Report"
                              style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 8, cursor: 'pointer' }}
                              onClick={() => window.open(data.publicUrl, '_blank')}
                            />
                          );
                        })}
                      </div>
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