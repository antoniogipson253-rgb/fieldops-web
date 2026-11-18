import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useIsMobile } from '../hooks/useIsMobile';

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

const STATUS: Record<SendRow['status'], { label: string; color: string; bg: string }> = {
  sent: { label: 'Sent', color: '#34D399', bg: '#064E3B40' },
  delivery_uncertain: { label: 'Delivery uncertain', color: '#FBBF24', bg: '#78350F40' },
  failed: { label: 'Not delivered', color: '#FCA5A5', bg: '#7F1D1D40' },
};

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

  const card = { backgroundColor: '#111827', borderRadius: 14, border: '1px solid #1F2937' } as const;

  function toggle(rowId: string) {
    setShowText(false);
    setOpenId(openId === rowId ? null : rowId);
  }

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: '#FFFFFF' }}>
      <button onClick={() => navigate(`/projects/${id}`)} style={{ backgroundColor: 'transparent', border: 'none', color: '#F97316', fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 0, marginBottom: 16 }}>
        Back to Project
      </button>

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, marginBottom: 4 }}>Daily Reports</h1>
        <p style={{ color: '#6B7280', fontSize: 14, margin: 0 }}>
          {project?.name ?? 'Project'}: automatic daily reports as they were emailed, newest first.
        </p>
      </div>

      {checkingAccess ? (
        <div style={{ color: '#F97316' }}>Loading...</div>
      ) : canView !== true ? (
        <div style={{ ...card, padding: 32, textAlign: 'center', color: '#9CA3AF', fontSize: 14 }}>
          Only company admins and project managers can view this project's daily reports.
        </div>
      ) : isLoading ? (
        <div style={{ color: '#F97316' }}>Loading...</div>
      ) : listError ? (
        <div role="alert" style={{ ...card, padding: 32, textAlign: 'center', color: '#FCA5A5', fontSize: 14 }}>
          Could not load reports. {(listError as any)?.message ?? ''}
        </div>
      ) : !sends || sends.length === 0 ? (
        <div style={{ ...card, padding: 40, textAlign: 'center', color: '#6B7280', fontSize: 14 }}>
          No reports sent yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sends.map((s) => {
            const isOpen = openId === s.id;
            const st = STATUS[s.status];
            const n = s.recipient_emails.length;
            return (
              <div key={s.id} style={{ ...card, border: `1px solid ${isOpen ? '#F97316' : '#1F2937'}`, overflow: 'hidden' }}>
                <button
                  onClick={() => toggle(s.id)}
                  aria-expanded={isOpen}
                  style={{ width: '100%', background: 'transparent', border: 'none', color: 'inherit', textAlign: 'left', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, cursor: 'pointer', flexWrap: 'wrap' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{formatReportDate(s.report_date)}</div>
                    <div style={{ fontSize: 12, color: '#6B7280' }}>
                      {s.sent_at ? `Sent ${formatSentAt(s.sent_at)}` : 'Not sent'} · {n} recipient{n === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: st.color, backgroundColor: st.bg, borderRadius: 999, padding: '3px 10px' }}>{st.label}</span>
                    <span style={{ fontSize: 12, color: '#9CA3AF' }}>{isOpen ? 'Close' : 'Open'}</span>
                  </div>
                </button>

                {isOpen && (
                  <div style={{ borderTop: '1px solid #1F2937', padding: isMobile ? 12 : 20 }}>
                    <div style={{ fontSize: 13, color: '#D1D5DB', marginBottom: 6 }}><span style={{ color: '#6B7280' }}>Subject:</span> {s.subject}</div>
                    <div style={{ fontSize: 13, color: '#D1D5DB', marginBottom: 12, wordBreak: 'break-word' }}>
                      <span style={{ color: '#6B7280' }}>To:</span> {n > 0 ? s.recipient_emails.join(', ') : 'None'}
                    </div>
                    {s.status === 'delivery_uncertain' && (
                      <div style={{ fontSize: 12, color: '#FBBF24', marginBottom: 12 }}>
                        The email service did not confirm delivery. Recipients may or may not have received this report; it was not resent.
                      </div>
                    )}

                    {loadingContent ? (
                      <div style={{ color: '#F97316', fontSize: 13 }}>Loading report...</div>
                    ) : s.status === 'failed' ? (
                      <div role="alert" style={{ fontSize: 13, color: '#FCA5A5' }}>
                        This report was not delivered, so no copy was kept.{content?.error ? ` Reason: ${content.error}` : ''}
                      </div>
                    ) : content?.content_html ? (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                          <button onClick={() => setShowText(!showText)} style={{ background: 'transparent', border: '1px solid #374151', borderRadius: 8, color: '#9CA3AF', fontSize: 12, padding: '4px 10px', cursor: 'pointer' }}>
                            {showText ? 'Show as emailed' : 'Show plain text'}
                          </button>
                        </div>
                        {showText ? (
                          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', backgroundColor: '#0B1220', border: '1px solid #1F2937', borderRadius: 10, padding: 16, fontSize: 13, color: '#D1D5DB', margin: 0, fontFamily: 'inherit' }}>
                            {content.content_text ?? ''}
                          </pre>
                        ) : (
                          // sandbox with no permissions: the archived email cannot run scripts,
                          // submit forms or reach this page.
                          <iframe
                            title={`Daily report ${s.report_date}`}
                            sandbox=""
                            srcDoc={content.content_html}
                            style={{ width: '100%', height: isMobile ? '70vh' : '75vh', border: '1px solid #1F2937', borderRadius: 10, backgroundColor: '#FFFFFF' }}
                          />
                        )}
                      </>
                    ) : (
                      <div style={{ fontSize: 13, color: '#6B7280' }}>No copy of this report is available.</div>
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
