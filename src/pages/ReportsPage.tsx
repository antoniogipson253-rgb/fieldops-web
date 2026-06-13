import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import jsPDF from 'jspdf';

type DailyReport = {
  id: string;
  project_id: string;
  created_by: string | null;
  report_date: string;
  notes: string | null;
  weather: string | null;
  issues: string | null;
  crew_log: string | null;
  materials: string | null;
  photo_keys: string[] | null;
  created_at: string;
  updated_at: string | null;
  author?: { id: string; full_name: string | null };
};

type CrewEntry = {
  user_id: string;
  full_name: string | null;
  clock_in: string;
  clock_out: string | null;
};

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

async function imageUrlToBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export default function DailyReportsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const { data: project } = useQuery({
    queryKey: ['web-project', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('*').eq('id', id).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: reports, isLoading } = useQuery({
    queryKey: ['web-daily-reports', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_reports')
        .select(`*, author:created_by (id, full_name)`)
        .eq('project_id', id)
        .order('report_date', { ascending: false });
      if (error) throw error;
      return data as DailyReport[];
    },
    enabled: !!id,
  });

  async function fetchCrewForDate(reportDate: string): Promise<CrewEntry[]> {
    const startOfDay = new Date(reportDate + 'T00:00:00');
    const endOfDay = new Date(reportDate + 'T23:59:59');
    const { data, error } = await supabase
      .from('time_entries')
      .select('user_id, clock_in, clock_out, profiles!user_id(full_name)')
      .eq('project_id', id)
      .gte('clock_in', startOfDay.toISOString())
      .lte('clock_in', endOfDay.toISOString())
      .order('clock_in', { ascending: true });
    if (error) return [];
    const seen = new Set<string>();
    const crew: CrewEntry[] = [];
    for (const entry of data ?? []) {
      if (seen.has(entry.user_id)) continue;
      seen.add(entry.user_id);
      crew.push({
        user_id: entry.user_id,
        full_name: (entry.profiles as any)?.full_name ?? 'Unknown',
        clock_in: entry.clock_in,
        clock_out: entry.clock_out,
      });
    }
    return crew;
  }

  async function handleExportPDF(report: DailyReport) {
    setExportingId(report.id);
    try {
      const crew = await fetchCrewForDate(report.report_date);

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = 210;
      let y = 0;

      // Header
      doc.setFillColor(249, 115, 22);
      doc.rect(0, 0, pageWidth, 20, 'F');
      doc.setTextColor(10, 15, 30);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('FIELDOPS PRO — DAILY REPORT', 14, 13);

      y = 28;
      doc.setTextColor(20, 20, 20);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text(project?.name ?? 'Project', 14, y);

      y += 8;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      doc.text(formatDate(report.report_date), 14, y);

      y += 6;
      doc.text(`Submitted by: ${report.author?.full_name ?? 'Unknown'}`, 14, y);

      if (report.weather) {
        y += 6;
        doc.text(`Weather: ${report.weather.replace(/[^\x00-\x7F]/g, '').trim()}`, 14, y);
      }

      y += 10;
      doc.setDrawColor(220, 220, 220);
      doc.line(14, y, pageWidth - 14, y);
      y += 8;

      const addSection = (title: string, content: string | null) => {
        if (!content || !content.trim()) return;
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(249, 115, 22);
        doc.text(title, 14, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(40, 40, 40);
        const lines = doc.splitTextToSize(content, pageWidth - 28);
        doc.text(lines, 14, y);
        y += lines.length * 5 + 6;
      };

      // Crew on site
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(249, 115, 22);
      doc.text('CREW ON SITE', 14, y);
      y += 6;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(40, 40, 40);
      if (crew.length === 0) {
        doc.text('No clock-in records for this day.', 14, y);
        y += 6;
      } else {
        for (const c of crew) {
          const line = `${c.full_name} — ${formatTime(c.clock_in)}${c.clock_out ? ` to ${formatTime(c.clock_out)}` : ' (still clocked in)'}`;
          doc.text(line, 14, y);
          y += 5;
        }
      }
      y += 6;

      addSection('ADDITIONAL CREW NOTES', report.crew_log);
      addSection('WORK COMPLETED / NOTES', report.notes);
      addSection('ISSUES / DELAYS', report.issues);
      addSection('MATERIALS & DELIVERIES', report.materials);

      // Photos
      if (report.photo_keys && report.photo_keys.length > 0) {
        if (y > 220) { doc.addPage(); y = 20; }
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(249, 115, 22);
        doc.text(`PHOTOS (${report.photo_keys.length})`, 14, y);
        y += 8;

        let xPos = 14;
        const imgSize = 55;
        for (const key of report.photo_keys) {
          const { data: urlData } = supabase.storage.from('task-photos').getPublicUrl(key);
          const base64 = await imageUrlToBase64(urlData.publicUrl);
          if (base64) {
            if (xPos + imgSize > pageWidth - 14) {
              xPos = 14;
              y += imgSize + 6;
            }
            if (y + imgSize > 280) {
              doc.addPage();
              y = 20;
              xPos = 14;
            }
            try {
              doc.addImage(base64, 'JPEG', xPos, y, imgSize, imgSize);
            } catch {
              // skip if format unsupported
            }
            xPos += imgSize + 6;
          }
        }
        y += imgSize + 10;
      }

      // Footer
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(`Generated ${new Date().toLocaleString()} — FieldOps Pro`, 14, 290);
        doc.text(`Page ${i} of ${pageCount}`, pageWidth - 30, 290);
      }

      doc.save(`Daily Report - ${project?.name ?? 'Project'} - ${report.report_date}.pdf`);
    } catch (e: any) {
      alert('Failed to export PDF: ' + e.message);
    } finally {
      setExportingId(null);
    }
  }

  return (
    <div style={{ padding: 32, color: '#FFFFFF' }}>
      <button onClick={() => navigate(`/projects/${id}`)} style={{ backgroundColor: 'transparent', border: 'none', color: '#F97316', fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 0, marginBottom: 16 }}>
        ← Back to Project
      </button>

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, marginBottom: 4 }}>Daily Reports</h1>
        <p style={{ color: '#6B7280', fontSize: 14, margin: 0 }}>{project?.name ?? 'Project'} — site activity log</p>
      </div>

      {isLoading ? (
        <div style={{ color: '#F97316' }}>Loading...</div>
      ) : !reports || reports.length === 0 ? (
        <div style={{ backgroundColor: '#111827', borderRadius: 14, border: '1px solid #1F2937', padding: 40, textAlign: 'center', color: '#4B5563' }}>
          No daily reports submitted yet for this project.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {reports.map((report) => {
            const isExpanded = expandedId === report.id;
            return (
              <div key={report.id} style={{ backgroundColor: '#111827', borderRadius: 14, border: `1px solid ${isExpanded ? '#F97316' : '#1F2937'}`, overflow: 'hidden' }}>
                <div
                  onClick={() => setExpandedId(isExpanded ? null : report.id)}
                  style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                >
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{formatDate(report.report_date)}</div>
                    <div style={{ fontSize: 12, color: '#6B7280' }}>
                      By {report.author?.full_name ?? 'Unknown'}
                      {report.weather ? ` · ${report.weather}` : ''}
                      {report.photo_keys && report.photo_keys.length > 0 ? ` · ${report.photo_keys.length} photo${report.photo_keys.length !== 1 ? 's' : ''}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleExportPDF(report); }}
                      disabled={exportingId === report.id}
                      style={{ padding: '8px 16px', backgroundColor: exportingId === report.id ? '#374151' : '#F97316', border: 'none', borderRadius: 8, color: exportingId === report.id ? '#9CA3AF' : '#0A0F1E', fontSize: 12, fontWeight: 700, cursor: exportingId === report.id ? 'not-allowed' : 'pointer' }}
                    >
                      {exportingId === report.id ? 'Generating...' : 'Export PDF'}
                    </button>
                    <span style={{ fontSize: 18, color: '#374151' }}>{isExpanded ? '▾' : '▸'}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ padding: '0 20px 20px 20px', borderTop: '1px solid #1F2937' }}>
                    <div style={{ paddingTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      {report.issues && (
                        <DetailBlock title="Issues / Delays" content={report.issues} accent="#EF4444" />
                      )}
                      {report.notes && (
                        <DetailBlock title="Notes" content={report.notes} accent="#378ADD" />
                      )}
                      {report.crew_log && (
                        <DetailBlock title="Additional Crew Notes" content={report.crew_log} accent="#A78BFA" />
                      )}
                      {report.materials && (
                        <DetailBlock title="Materials & Deliveries" content={report.materials} accent="#EF9F27" />
                      )}
                    </div>

                    {report.photo_keys && report.photo_keys.length > 0 && (
                      <div style={{ marginTop: 16 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 1, marginBottom: 8 }}>PHOTOS</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
                          {report.photo_keys.map((key) => {
                            const { data } = supabase.storage.from('task-photos').getPublicUrl(key);
                            return (
                              <a key={key} href={data.publicUrl} target="_blank" rel="noreferrer">
                                <img src={data.publicUrl} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8, border: '1px solid #1F2937' }} />
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {!report.issues && !report.notes && !report.crew_log && !report.materials && (!report.photo_keys || report.photo_keys.length === 0) && (
                      <div style={{ paddingTop: 16, color: '#4B5563', fontSize: 13 }}>No additional details recorded for this report.</div>
                    )}

                    {report.updated_at && (
                      <div style={{ marginTop: 16, fontSize: 11, color: '#374151' }}>
                        Last updated {new Date(report.updated_at).toLocaleString()}
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

function DetailBlock({ title, content, accent }: { title: string; content: string; accent: string }) {
  return (
    <div style={{ backgroundColor: '#0D1321', borderRadius: 10, padding: 14, borderLeft: `3px solid ${accent}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: 1, marginBottom: 6 }}>{title.toUpperCase()}</div>
      <div style={{ fontSize: 13, color: '#D1D5DB', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{content}</div>
    </div>
  );
}