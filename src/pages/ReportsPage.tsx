import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export default function ReportsPage() {
  const navigate = useNavigate();

  const { data: projects } = useQuery({
    queryKey: ['web-projects-for-reports'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name, status')
        .eq('archived', false)
        .order('name', { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const reportLinks = [
    {
      title: 'Payroll Reports',
      description: 'View and configure automated weekly payroll reports, lunch deductions, and flagged clock-ins.',
      action: () => navigate('/payroll'),
      accent: '#22C55E',
    },
    {
      title: 'Time Tracking',
      description: 'View detailed timesheet entries for your team across all projects.',
      action: () => navigate('/timesheet'),
      accent: '#378ADD',
    },
    {
      title: 'Punch List',
      description: 'View open and resolved punch list items across all projects.',
      action: () => navigate('/punch-list'),
      accent: '#A78BFA',
    },
    {
      title: 'Safety Incidents',
      description: 'View reported safety incidents and their status.',
      action: () => navigate('/incidents'),
      accent: '#EF4444',
    },
  ];

  return (
    <div style={{ padding: 32, color: '#FFFFFF' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, marginBottom: 4 }}>Reports</h1>
        <p style={{ color: '#6B7280', fontSize: 14, margin: 0 }}>Company-wide reporting and exports</p>
      </div>

      {/* General report links */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 32 }}>
        {reportLinks.map((report) => (
          <div
            key={report.title}
            onClick={report.action}
            style={{
              backgroundColor: '#111827',
              borderRadius: 14,
              border: '1px solid #1F2937',
              borderLeft: `3px solid ${report.accent}`,
              padding: 20,
              cursor: 'pointer',
              transition: 'border-color 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = report.accent)}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#1F2937')}
          >
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{report.title}</div>
            <div style={{ fontSize: 13, color: '#9CA3AF', lineHeight: 1.5 }}>{report.description}</div>
          </div>
        ))}
      </div>

      {/* Daily Reports by project */}
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Daily Job Site Reports</h2>
        <p style={{ color: '#6B7280', fontSize: 13, marginBottom: 16 }}>
          Select a project to view daily reports, including weather, crew on site, issues, materials, and photos. Export individual reports as PDF.
        </p>

        {!projects || projects.length === 0 ? (
          <div style={{ backgroundColor: '#111827', borderRadius: 14, border: '1px solid #1F2937', padding: 40, textAlign: 'center', color: '#4B5563' }}>
            No active projects.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {projects.map((project: any) => (
              <div
                key={project.id}
                onClick={() => navigate(`/projects/${project.id}/daily-reports`)}
                style={{
                  backgroundColor: '#111827',
                  borderRadius: 12,
                  border: '1px solid #1F2937',
                  padding: '14px 20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#F97316')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#1F2937')}
              >
                <span style={{ fontSize: 14, fontWeight: 600 }}>{project.name}</span>
                <span style={{ fontSize: 13, color: '#F97316', fontWeight: 600 }}>View Reports →</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}