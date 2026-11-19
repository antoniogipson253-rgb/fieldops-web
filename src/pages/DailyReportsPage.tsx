import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useIsMobile } from '../hooks/useIsMobile';
import { btn, card, colors, fonts, statusColor, tint } from '../theme';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusChip from '../components/ui/StatusChip';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import Icon from '../components/ui/Icon';

// Archive of the automatic daily reports that were actually sent (daily_report_sends).
// Read-only. Visible to company admins and project managers of the project's company (RLS).

type SendRow = {
  id: string;
  report_date: string;
  status: 'sent' | 'delivery_uncertain' | 'failed';
  sent_at: string | null;
  recipient_emails: string[];
  subject: string;
  attempts: number;
};

type SendContent = { id: string; content_html: string | null; content_text: string | null; error: string | null };

function formatReportDate(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatSentAt(ts: string | null) {
  if (!ts) return null;
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function DailyReportsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [openId, setOpenId] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);

  const { data: project } = useQuery({
    queryKey: ['web-project', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('*').eq('id', id).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: canView, isLoading: checkingAccess } = useQuery({
    queryKey: ['can-manage-project-reports', id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('can_manage_project_reports', { p_project_id: id });
      if (error) return false;
      return data === true;
    },
    enabled: !!id,
  });

  const { data: sends, isLoading, error: listError } = useQuery({
    queryKey: ['daily-report-sends', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_report_sends')
        .select('id, report_date, status, sent_at, recipient_emails, subject, attempts')
        .eq('project_id', id)
        .order('report_date', { ascending: false });
      if (error) throw error;
      return (data ?? []) as SendRow[];
    },
    enabled: !!id && canView === true,
  });

  const { data: content, isLoading: loadingContent } = useQuery({
    queryKey: ['daily-report-send-content', openId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_report_sends')
        .select('id, content_html, content_text, error')
        .eq('id', openId)
        .single();
      if (error) throw error;
      return data as SendContent;
    },
    enabled: !!openId,
  });

  function toggle(rowId: string) {
    setShowText(false);
    setOpenId(openId === rowId ? null : rowId);
  }

  const sentCount = (sends ?? []).filter((s) => s.status === 'sent').length;
  const issueCount = (sends ?? []).filter((s) => s.status !== 'sent').length;
  const detailLabel: React.CSSProperties = { color: colors.text3, fontWeight: 600 };

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: colors.text }}>
      <PageHeader
        title="Daily Reports"
        breadcrumb={[{ label: 'Projects', onClick: () => navigate('/projects') }, { label: project?.name ?? 'Project', onClick: () => navigate(`/projects/${id}`) }, { label: 'Daily reports' }]}
        subtitle={`${project?.name ?? 'Project'}: automatic daily reports as they were emailed, newest first.`}
        actions={
          <button type="button" onClick={() => navigate(`/projects/${id}`)} {...btn('secondary')}>
            <Icon name="chevron-left" size={14} /> Back to Project
          </button>
        }
      />

      {checkingAccess ? (
        <div role="status" aria-label="Loading" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} height={68} radius={12} />)}
        </div>
      ) : canView !== true ? (
        <EmptyState title="No access" message="Only company admins and project managers can view this project's daily reports." />
      ) : isLoading ? (
        <div role="status" aria-label="Loading reports" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} height={68} radius={12} />)}
        </div>
      ) : listError ? (
        <div role="alert" style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, color: colors.red, fontSize: 14, backgroundColor: colors.redSurface, borderColor: tint(colors.red, 0.5) }}>
          <Icon name="alert" size={16} />
          <span>Could not load reports. {(listError as any)?.message ?? ''}</span>
        </div>
      ) : !sends || sends.length === 0 ? (
        <EmptyState title="No reports sent yet" message="Each automatic daily report appears here once it has been emailed." />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 16 }}>
            <StatCard label="Reports" tone="accent" value={sends.length} sub="in the archive" />
            <StatCard label="Sent" tone="green" value={sentCount} />
            <StatCard label="Needs a look" tone="amber" alert={issueCount > 0} value={issueCount} sub="uncertain or not delivered" />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sends.map((s) => {
              const isOpen = openId === s.id;
              const n = s.recipient_emails.length;
              return (
                <div key={s.id} style={{ ...card, padding: 0, overflow: 'hidden', borderColor: isOpen ? colors.accent : colors.border, borderLeft: `4px solid ${statusColor(s.status)}` }}>
                  <button
                    type="button"
                    className="fo-row"
                    onClick={() => toggle(s.id)}
                    aria-expanded={isOpen}
                    style={{ width: '100%', background: 'transparent', border: 'none', color: 'inherit', textAlign: 'left', font: 'inherit', padding: isMobile ? '14px 14px' : '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: fonts.display, fontSize: isMobile ? 19 : 21, fontWeight: 700, letterSpacing: '0.01em', textTransform: 'uppercase', lineHeight: 1.15, marginBottom: 4 }}>{formatReportDate(s.report_date)}</div>
                      <div style={{ fontSize: 13, color: colors.text2 }}>
                        {s.sent_at ? `Sent ${formatSentAt(s.sent_at)}` : 'Not sent'} · {n} recipient{n === 1 ? '' : 's'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                      <StatusChip status={s.status} />
                      <span aria-hidden="true" style={{ color: colors.text2, display: 'inline-flex', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }}>
                        <Icon name="chevron-down" size={18} />
                      </span>
                      <span className="fo-sr-only">{isOpen ? 'Close' : 'Open'}</span>
                    </div>
                  </button>

                  {isOpen && (
                    <div style={{ borderTop: `1px solid ${colors.border}`, padding: isMobile ? 12 : 20 }}>
                      <div style={{ fontSize: 13, color: colors.text, marginBottom: 6, overflowWrap: 'anywhere' }}><span style={detailLabel}>Subject:</span> {s.subject}</div>
                      <div style={{ fontSize: 13, color: colors.text, marginBottom: 12, overflowWrap: 'anywhere' }}>
                        <span style={detailLabel}>To:</span> {n > 0 ? s.recipient_emails.join(', ') : 'None'}
                      </div>
                      {s.status === 'delivery_uncertain' && (
                        <div style={{ display: 'flex', gap: 8, fontSize: 13, color: colors.amber, marginBottom: 12, lineHeight: 1.5 }}>
                          <Icon name="alert" size={15} style={{ marginTop: 2 }} />
                          <span>The email service did not confirm delivery. Recipients may or may not have received this report; it was not resent.</span>
                        </div>
                      )}

                      {loadingContent ? (
                        <Skeleton height={isMobile ? 240 : 320} radius={10} />
                      ) : s.status === 'failed' ? (
                        <div role="alert" style={{ display: 'flex', gap: 8, fontSize: 13, color: colors.red, lineHeight: 1.5 }}>
                          <Icon name="alert" size={15} style={{ marginTop: 2 }} />
                          <span>This report was not delivered, so no copy was kept.{content?.error ? ` Reason: ${content.error}` : ''}</span>
                        </div>
                      ) : content?.content_html ? (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                            <button type="button" onClick={() => setShowText(!showText)} {...btn('ghost', { padding: '6px 12px', fontSize: 13 })}>
                              {showText ? 'Show as emailed' : 'Show plain text'}
                            </button>
                          </div>
                          {showText ? (
                            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', backgroundColor: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 16, fontSize: 13, color: colors.text, margin: 0, fontFamily: 'inherit', lineHeight: 1.55 }}>
                              {content.content_text ?? ''}
                            </pre>
                          ) : (
                            // sandbox with no permissions: the archived email cannot run scripts,
                            // submit forms or reach this page.
                            <iframe
                              title={`Daily report ${s.report_date}`}
                              sandbox=""
                              srcDoc={content.content_html}
                              style={{ width: '100%', height: isMobile ? '70vh' : '75vh', border: `1px solid ${colors.border}`, borderRadius: 10, backgroundColor: '#FFFFFF', display: 'block' }}
                            />
                          )}
                        </>
                      ) : (
                        <div style={{ fontSize: 13, color: colors.text2 }}>No copy of this report is available.</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
