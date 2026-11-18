import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useIsMobile } from '../hooks/useIsMobile';
import { btn, card, colors, fonts, tint } from '../theme';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import Icon, { type IconName } from '../components/ui/Icon';

export default function ReportsPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const { data: projects, isLoading } = useQuery({
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

  const reportLinks: { title: string; description: string; action: () => void; accent: string; icon: IconName }[] = [
    {
      title: 'Payroll reports',
      description: 'Automated weekly payroll emails with hours, lunch deductions, net hours, flags and missing clock-outs.',
      action: () => navigate('/payroll'),
      accent: colors.green,
      icon: 'dollar',
    },
    {
      title: 'Time tracking',
      description: 'Detailed timesheet entries for your team across all projects.',
      action: () => navigate('/timesheet'),
      accent: colors.blue,
      icon: 'clock',
    },
    {
      title: 'Punch list',
      description: 'Open and resolved punch list items across all projects.',
      action: () => navigate('/punch-list'),
      accent: colors.violet,
      icon: 'clipboard',
    },
    {
      title: 'Safety incidents',
      description: 'Reported safety incidents and their severity.',
      action: () => navigate('/incidents'),
      accent: colors.red,
      icon: 'shield',
    },
  ];

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: colors.text }}>
      <PageHeader title="Reports" subtitle="Company-wide reporting and exports" />

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))', gap: 16, marginBottom: 36 }}>
        {reportLinks.map((report) => (
          <button
            key={report.title}
            type="button"
            onClick={report.action}
            className="fo-card fo-card-link"
            style={{ ...card, borderTop: `3px solid ${report.accent}`, textAlign: 'left', color: 'inherit', font: 'inherit', display: 'flex', alignItems: 'flex-start', gap: 14 }}
          >
            <span aria-hidden="true" style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', backgroundColor: tint(report.accent, 0.15), color: report.accent }}>
              <Icon name={report.icon} size={19} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontFamily: fonts.display, fontSize: 22, fontWeight: 700, letterSpacing: '0.02em', lineHeight: 1.15 }}>{report.title}</span>
              <span style={{ display: 'block', fontSize: 14, color: colors.text2, lineHeight: 1.5, marginTop: 4 }}>{report.description}</span>
            </span>
            <span aria-hidden="true" style={{ color: colors.text2, alignSelf: 'center' }}><Icon name="arrow-right" size={18} /></span>
          </button>
        ))}
      </div>

      {/* Daily Reports by project */}
      <h2 style={{ margin: 0, fontFamily: fonts.display, fontSize: 26, fontWeight: 700, letterSpacing: '0.02em' }}>Daily reports</h2>
      <p style={{ color: colors.text2, fontSize: 14, margin: '4px 0 14px', lineHeight: 1.5 }}>
        Every automatic daily report that was emailed, by project, exactly as it was sent. Set them up per project under Edit.
      </p>

      {isLoading ? (
        <div style={{ ...card, padding: 0 }} role="status" aria-label="Loading projects">
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ padding: '14px 18px', borderTop: i ? `1px solid ${colors.border}` : 'none' }}><Skeleton width="40%" height={14} /></div>
          ))}
        </div>
      ) : !projects || projects.length === 0 ? (
        <EmptyState title="No active projects" message="Daily reports appear here for each active project." actionLabel="Go to Projects" onAction={() => navigate('/projects')} />
      ) : (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          {projects.map((project: any, i: number) => (
            <div key={project.id} className="fo-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: isMobile ? '12px 14px' : '12px 18px', borderTop: i ? `1px solid ${colors.border}` : 'none' }}>
              <span style={{ fontSize: 15, fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{project.name}</span>
              <button type="button" onClick={() => navigate(`/projects/${project.id}/daily-reports`)} aria-label={`View daily reports for ${project.name}`} {...btn('secondary', { padding: '7px 14px', fontSize: 13 })}>
                View
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
