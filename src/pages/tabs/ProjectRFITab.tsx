import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

interface Props {
  projectId: string;
  isAdmin: boolean;
  canEdit: boolean;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', backgroundColor: '#1F2937',
  border: '1px solid #374151', borderRadius: 8, color: '#FFFFFF',
  fontSize: 14, outline: 'none', boxSizing: 'border-box',
};

const modalOverlay: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex',
  justifyContent: 'center', alignItems: 'center', zIndex: 1000,
};

const modalBox: React.CSSProperties = {
  backgroundColor: '#111827', borderRadius: 16, padding: 32,
  width: '100%', maxWidth: 520, border: '1px solid #1F2937',
  maxHeight: '85vh', overflowY: 'auto',
};

const statusColors: Record<string, string> = {
  open: '#F97316',
  answered: '#22C55E',
  closed: '#6B7280',
  void: '#4B5563',
};

export function ProjectRFITab({ projectId, isAdmin, canEdit }: Props) {
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showNewRFI, setShowNewRFI] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newQuestion, setNewQuestion] = useState('');
  const [newDirectedTo, setNewDirectedTo] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [savingRFI, setSavingRFI] = useState(false);
  const [responseText, setResponseText] = useState('');
  const [responseStatus, setResponseStatus] = useState('answered');
  const [savingResponse, setSavingResponse] = useState(false);

  const { data: rfis } = useQuery({
    queryKey: ['rfis', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rfis')
        .select('*, submitter:submitted_by(full_name), responder:responded_by(full_name)')
        .eq('project_id', projectId)
        .order('rfi_number', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!projectId,
  });

  const filtered = (rfis ?? []).filter((rfi: any) => {
    if (filterStatus === 'all') return true;
    return rfi.status === filterStatus;
  });

  async function handleCreateRFI() {
    if (!newSubject.trim()) return;
    setSavingRFI(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { count } = await supabase.from('rfis').select('*', { count: 'exact', head: true }).eq('project_id', projectId);
      const { error } = await supabase.from('rfis').insert({
        project_id: projectId,
        rfi_number: (count ?? 0) + 1,
        subject: newSubject.trim(),
        question: newQuestion.trim() || null,
        directed_to: newDirectedTo.trim() || null,
        due_date: newDueDate || null,
        status: 'open',
        submitted_by: user!.id,
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['rfis', projectId] });
      setShowNewRFI(false);
      setNewSubject(''); setNewQuestion(''); setNewDirectedTo(''); setNewDueDate('');
    } catch (e: any) { alert(e.message); }
    finally { setSavingRFI(false); }
  }

  async function handleSubmitResponse(rfi: any) {
    if (!responseText.trim()) return;
    setSavingResponse(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('rfis').update({
        response: responseText.trim(),
        responded_by: user!.id,
        responded_at: new Date().toISOString(),
        status: responseStatus,
      }).eq('id', rfi.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['rfis', projectId] });
      setResponseText('');
    } catch (e: any) { alert(e.message); }
    finally { setSavingResponse(false); }
  }

  return (
    <div style={{ color: '#FFFFFF' }}>
      <div style={{ backgroundColor: '#111827', borderRadius: 14, border: '1px solid #1F2937', overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #1F2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>RFI Log</h3>
          <button onClick={() => setShowNewRFI(true)} style={{ padding: '8px 16px', backgroundColor: '#F97316', border: 'none', borderRadius: 8, color: '#0A0F1E', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ New RFI</button>
        </div>

        <div style={{ padding: '12px 24px', borderBottom: '1px solid #1F2937', display: 'flex', gap: 8 }}>
          {[{ key: 'all', label: 'All' }, { key: 'open', label: 'Open' }, { key: 'answered', label: 'Answered' }, { key: 'closed', label: 'Closed' }].map((s) => (
            <button key={s.key} onClick={() => setFilterStatus(s.key)} style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', backgroundColor: filterStatus === s.key ? '#F97316' : '#1F2937', border: `1px solid ${filterStatus === s.key ? '#F97316' : '#374151'}`, color: filterStatus === s.key ? '#0A0F1E' : '#9CA3AF' }}>
              {s.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#4B5563' }}>No RFIs found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#0D1321' }}>
                {['RFI #', 'Subject', 'Directed To', 'Due Date', 'Status', 'Submitted By', 'Date', ''].map((h) => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((rfi: any, i: number) => {
                const isOverdue = rfi.due_date && new Date(rfi.due_date) < new Date() && rfi.status === 'open';
                return (
                  <React.Fragment key={rfi.id}>
                    <tr onClick={() => setExpandedId(expandedId === rfi.id ? null : rfi.id)} style={{ borderTop: '1px solid #1F2937', backgroundColor: expandedId === rfi.id ? '#1F293760' : i % 2 === 0 ? 'transparent' : '#0D132120', cursor: 'pointer' }}>
                      <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: '#F97316' }}>#{rfi.rfi_number}</td>
                      <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>{rfi.subject}</td>
                      <td style={{ padding: '12px 16px', fontSize: 12, color: '#9CA3AF' }}>{rfi.directed_to ?? '—'}</td>
                      <td style={{ padding: '12px 16px', fontSize: 12, color: isOverdue ? '#EF4444' : '#9CA3AF', fontWeight: isOverdue ? 700 : 400 }}>
                        {rfi.due_date ? `${isOverdue ? '⚠️ ' : ''}${new Date(rfi.due_date).toLocaleDateString()}` : '—'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: statusColors[rfi.status] ?? '#6B7280', backgroundColor: (statusColors[rfi.status] ?? '#6B7280') + '20', padding: '3px 10px', borderRadius: 20 }}>{rfi.status}</span>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 12, color: '#9CA3AF' }}>{(rfi.submitter as any)?.full_name ?? '—'}</td>
                      <td style={{ padding: '12px 16px', fontSize: 12, color: '#9CA3AF' }}>{new Date(rfi.created_at).toLocaleDateString()}</td>
                      <td style={{ padding: '12px 16px', fontSize: 12, color: '#6B7280' }}>{expandedId === rfi.id ? '▲' : '▼'}</td>
                    </tr>
                    {expandedId === rfi.id && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0, borderTop: '1px solid #1F2937' }}>
                          <div style={{ backgroundColor: '#0D1321', padding: 24 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                              <div>
                                <div style={{ marginBottom: 12 }}>
                                  <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 700, marginBottom: 4 }}>QUESTION</div>
                                  <p style={{ margin: 0, fontSize: 14, color: '#D1D5DB', lineHeight: 1.6 }}>{rfi.question ?? '—'}</p>
                                </div>
                                {rfi.directed_to && (
                                  <div style={{ marginBottom: 12 }}>
                                    <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 700, marginBottom: 4 }}>DIRECTED TO</div>
                                    <p style={{ margin: 0, fontSize: 14, color: '#D1D5DB' }}>{rfi.directed_to}</p>
                                  </div>
                                )}
                              </div>
                              <div>
                                <div style={{ backgroundColor: '#111827', borderRadius: 10, padding: 16 }}>
                                  {[
                                    { label: 'Submitted By', value: (rfi.submitter as any)?.full_name ?? '—', color: '#FFFFFF' },
                                    { label: 'Date', value: new Date(rfi.created_at).toLocaleDateString(), color: '#9CA3AF' },
                                    { label: 'Due Date', value: rfi.due_date ? new Date(rfi.due_date).toLocaleDateString() : '—', color: isOverdue ? '#EF4444' : '#FFFFFF' },
                                    { label: 'Status', value: rfi.status, color: statusColors[rfi.status] ?? '#6B7280' },
                                  ].map((item) => (
                                    <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid #1F2937' }}>
                                      <span style={{ fontSize: 12, color: '#6B7280' }}>{item.label}</span>
                                      <span style={{ fontSize: 12, fontWeight: 600, color: item.color }}>{item.value}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>

                            {rfi.response && (
                              <div style={{ backgroundColor: '#22C55E10', border: '1px solid #22C55E30', borderRadius: 10, padding: 16, marginBottom: 20 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: '#22C55E', letterSpacing: 2 }}>RESPONSE</span>
                                  <span style={{ fontSize: 11, color: '#6B7280' }}>{(rfi.responder as any)?.full_name ?? '—'}{rfi.responded_at ? ` • ${new Date(rfi.responded_at).toLocaleDateString()}` : ''}</span>
                                </div>
                                <p style={{ margin: 0, fontSize: 14, color: '#D1D5DB', lineHeight: 1.6 }}>{rfi.response}</p>
                              </div>
                            )}

                            {rfi.status === 'open' && (isAdmin || canEdit) && (
                              <div style={{ backgroundColor: '#111827', borderRadius: 10, padding: 16 }}>
                                <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 700, marginBottom: 12 }}>SUBMIT RESPONSE</div>
                                <textarea value={responseText} onChange={(e) => setResponseText(e.target.value)} placeholder="Enter your response..." style={{ ...inputStyle, resize: 'vertical', minHeight: 80, fontFamily: 'inherit' }} />
                                <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
                                  <select value={responseStatus} onChange={(e) => setResponseStatus(e.target.value)} style={{ padding: '8px 12px', backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 8, color: '#FFFFFF', fontSize: 13, cursor: 'pointer', outline: 'none' }}>
                                    <option value="answered">Mark as Answered</option>
                                    <option value="closed">Mark as Closed</option>
                                  </select>
                                  <button onClick={() => handleSubmitResponse(rfi)} disabled={savingResponse || !responseText.trim()} style={{ padding: '8px 20px', backgroundColor: '#F97316', border: 'none', borderRadius: 8, color: '#0A0F1E', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                                    {savingResponse ? 'Submitting...' : 'Submit Response'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* New RFI Modal */}
      {showNewRFI && (
        <div style={modalOverlay} onClick={() => setShowNewRFI(false)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>New RFI</h3>
              <button onClick={() => setShowNewRFI(false)} style={{ backgroundColor: '#1F2937', border: 'none', borderRadius: 8, color: '#9CA3AF', fontSize: 16, cursor: 'pointer', padding: '4px 10px' }}>✕</button>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>SUBJECT *</label>
              <input value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="RFI subject..." style={inputStyle} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>QUESTION</label>
              <textarea value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)} placeholder="Describe the question or request..." style={{ ...inputStyle, resize: 'vertical', minHeight: 80, fontFamily: 'inherit' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>DIRECTED TO</label>
              <input value={newDirectedTo} onChange={(e) => setNewDirectedTo(e.target.value)} placeholder="Name or company..." style={inputStyle} />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>DUE DATE</label>
              <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowNewRFI(false)} style={{ flex: 1, padding: '12px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 10, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleCreateRFI} disabled={savingRFI || !newSubject.trim()} style={{ flex: 2, padding: '12px', backgroundColor: '#F97316', border: 'none', borderRadius: 10, color: '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>{savingRFI ? 'Creating...' : 'Create RFI'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
