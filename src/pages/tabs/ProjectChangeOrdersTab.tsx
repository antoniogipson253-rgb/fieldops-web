import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

interface Props {
  projectId: string;
  isAdmin: boolean;
  canEdit: boolean;
  teamMembers: any[];
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
  width: '100%', maxWidth: 540, border: '1px solid #1F2937',
  maxHeight: '85vh', overflowY: 'auto',
};

const statusColors: Record<string, string> = {
  draft: '#6B7280',
  sent: '#3B82F6',
  under_review: '#F97316',
  approved: '#22C55E',
  rejected: '#EF4444',
  void: '#4B5563',
};

const reasonOptions = [
  { value: 'owner_request', label: 'Owner Request' },
  { value: 'unforeseen_conditions', label: 'Unforeseen Conditions' },
  { value: 'design_change', label: 'Design Change' },
  { value: 'other', label: 'Other' },
];

export function ProjectChangeOrdersTab({ projectId, isAdmin, canEdit }: Props) {
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showNewCO, setShowNewCO] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newScope, setNewScope] = useState('');
  const [newReason, setNewReason] = useState('owner_request');
  const [newCost, setNewCost] = useState('');
  const [savingCO, setSavingCO] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');
  const [showFolderPicker, setShowFolderPicker] = useState<string | null>(null);
  const [selectedFolderForTask, setSelectedFolderForTask] = useState('');

  const { data: changeOrders } = useQuery({
    queryKey: ['change-orders', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('change_orders')
        .select('*, initiator:initiated_by(full_name)')
        .eq('project_id', projectId)
        .order('co_number', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!projectId,
  });

  const { data: folders } = useQuery({
    queryKey: ['co-folders', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('folders').select('id, name').eq('project_id', projectId);
      return data ?? [];
    },
    enabled: !!projectId,
  });

  const { data: coPhotos } = useQuery({
    queryKey: ['co-photos', expandedId],
    queryFn: async () => {
      if (!expandedId) return [];
      const { data } = await supabase.from('change_order_photos').select('*').eq('change_order_id', expandedId);
      return data ?? [];
    },
    enabled: !!expandedId,
  });

  const filtered = (changeOrders ?? []).filter((co: any) => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'pending') return ['draft', 'sent', 'under_review'].includes(co.status);
    if (filterStatus === 'approved') return co.status === 'approved';
    if (filterStatus === 'rejected') return co.status === 'rejected';
    return true;
  });

  async function handleCreateCO() {
    if (!newTitle.trim()) return;
    setSavingCO(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { count } = await supabase.from('change_orders').select('*', { count: 'exact', head: true }).eq('project_id', projectId);
      const { error } = await supabase.from('change_orders').insert({
        project_id: projectId,
        co_number: (count ?? 0) + 1,
        title: newTitle.trim(),
        description: newDescription.trim() || null,
        scope_of_work: newScope.trim() || null,
        reason: newReason,
        estimated_cost: newCost ? parseFloat(newCost) : null,
        status: 'draft',
        initiated_by: user!.id,
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['change-orders', projectId] });
      setShowNewCO(false);
      setNewTitle(''); setNewDescription(''); setNewScope(''); setNewReason('owner_request'); setNewCost('');
    } catch (e: any) { alert(e.message); }
    finally { setSavingCO(false); }
  }

  async function handleAdvanceStatus(co: any, newStatus: string, notes?: string) {
    try {
      await supabase.from('change_orders').update({ status: newStatus, ...(notes ? { notes } : {}) }).eq('id', co.id);
      if (newStatus === 'approved' && co.estimated_cost) {
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from('project_expenses').insert({
          project_id: projectId,
          amount: co.estimated_cost,
          category: 'Other',
          description: `Change Order #${co.co_number}: ${co.title}`,
          status: 'approved',
          submitted_by: user!.id,
          change_order_id: co.id,
        });
        queryClient.invalidateQueries({ queryKey: ['project-expenses', projectId] });
        queryClient.invalidateQueries({ queryKey: ['project-budget', projectId] });
      }
      if (newStatus === 'void') {
        await supabase.from('project_expenses').update({ status: 'rejected' }).eq('change_order_id', co.id);
        queryClient.invalidateQueries({ queryKey: ['project-expenses', projectId] });
      }
      queryClient.invalidateQueries({ queryKey: ['change-orders', projectId] });
      setRejectNotes('');
    } catch (e: any) { alert(e.message); }
  }

  async function handleConvertToTask(co: any, folderId: string) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('tasks').insert({
        project_id: projectId,
        folder_id: folderId || null,
        title: `CO #${co.co_number}: ${co.title}`,
        description: co.description || co.scope_of_work || null,
        status: 'open',
        priority: 'high',
        created_by: user!.id,
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['web-folder-tasks', projectId] });
      queryClient.invalidateQueries({ queryKey: ['web-folders', projectId] });
      setShowFolderPicker(null);
      alert('Task created!');
    } catch (e: any) { alert(e.message); }
  }

  return (
    <div style={{ color: '#FFFFFF' }}>
      <div style={{ backgroundColor: '#111827', borderRadius: 14, border: '1px solid #1F2937', overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #1F2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Change Orders</h3>
          {canEdit && <button onClick={() => setShowNewCO(true)} style={{ padding: '8px 16px', backgroundColor: '#F97316', border: 'none', borderRadius: 8, color: '#0A0F1E', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ New Change Order</button>}
        </div>

        <div style={{ padding: '12px 24px', borderBottom: '1px solid #1F2937', display: 'flex', gap: 8 }}>
          {['all', 'pending', 'approved', 'rejected'].map((s) => (
            <button key={s} onClick={() => setFilterStatus(s)} style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', backgroundColor: filterStatus === s ? '#F97316' : '#1F2937', border: `1px solid ${filterStatus === s ? '#F97316' : '#374151'}`, color: filterStatus === s ? '#0A0F1E' : '#9CA3AF' }}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#4B5563' }}>No change orders found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#0D1321' }}>
                {['CO #', 'Title', 'Reason', 'Est. Cost', 'Status', 'Initiated By', 'Date', ''].map((h) => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((co: any, i: number) => (
                <React.Fragment key={co.id}>
                  <tr onClick={() => setExpandedId(expandedId === co.id ? null : co.id)} style={{ borderTop: '1px solid #1F2937', backgroundColor: expandedId === co.id ? '#1F293760' : i % 2 === 0 ? 'transparent' : '#0D132120', cursor: 'pointer' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: '#F97316' }}>#{co.co_number}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>{co.title}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#9CA3AF' }}>{co.reason}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700 }}>{co.estimated_cost ? `$${co.estimated_cost.toLocaleString()}` : '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: statusColors[co.status] ?? '#6B7280', backgroundColor: (statusColors[co.status] ?? '#6B7280') + '20', padding: '3px 10px', borderRadius: 20 }}>{co.status.replace('_', ' ')}</span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#9CA3AF' }}>{(co.initiator as any)?.full_name ?? '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#9CA3AF' }}>{new Date(co.created_at).toLocaleDateString()}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#6B7280' }}>{expandedId === co.id ? '▲' : '▼'}</td>
                  </tr>
                  {expandedId === co.id && (
                    <tr>
                      <td colSpan={8} style={{ padding: 0, borderTop: '1px solid #1F2937' }}>
                        <div style={{ backgroundColor: '#0D1321', padding: 24 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                            <div>
                              {co.description && (
                                <div style={{ marginBottom: 12 }}>
                                  <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 700, marginBottom: 4 }}>DESCRIPTION</div>
                                  <p style={{ margin: 0, fontSize: 14, color: '#D1D5DB', lineHeight: 1.6 }}>{co.description}</p>
                                </div>
                              )}
                              {co.scope_of_work && (
                                <div style={{ marginBottom: 12 }}>
                                  <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 700, marginBottom: 4 }}>SCOPE OF WORK</div>
                                  <p style={{ margin: 0, fontSize: 14, color: '#D1D5DB', lineHeight: 1.6 }}>{co.scope_of_work}</p>
                                </div>
                              )}
                              {co.notes && (
                                <div style={{ marginBottom: 12 }}>
                                  <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 700, marginBottom: 4 }}>NOTES</div>
                                  <p style={{ margin: 0, fontSize: 14, color: '#D1D5DB', lineHeight: 1.6 }}>{co.notes}</p>
                                </div>
                              )}
                            </div>
                            <div>
                              <div style={{ backgroundColor: '#111827', borderRadius: 10, padding: 16 }}>
                                <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 700, marginBottom: 12 }}>DETAILS</div>
                                {[
                                  { label: 'Status', value: co.status.replace('_', ' '), color: statusColors[co.status] },
                                  { label: 'Reason', value: co.reason, color: '#FFFFFF' },
                                  { label: 'Est. Cost', value: co.estimated_cost ? `$${co.estimated_cost.toLocaleString()}` : '—', color: '#FFFFFF' },
                                  { label: 'Initiated By', value: (co.initiator as any)?.full_name ?? '—', color: '#FFFFFF' },
                                  { label: 'Created', value: new Date(co.created_at).toLocaleDateString(), color: '#9CA3AF' },
                                ].map((item) => (
                                  <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid #1F2937' }}>
                                    <span style={{ fontSize: 12, color: '#6B7280' }}>{item.label}</span>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: item.color }}>{item.value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>

                          {coPhotos && coPhotos.length > 0 && (
                            <div style={{ marginBottom: 20 }}>
                              <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 700, marginBottom: 8 }}>PHOTOS</div>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {coPhotos.map((p: any) => (
                                  <img key={p.id} src={`${process.env.REACT_APP_SUPABASE_URL}/storage/v1/object/public/project-files/${p.storage_key}`} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid #374151' }} />
                                ))}
                              </div>
                            </div>
                          )}

                          {canEdit && (
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                              {co.status === 'draft' && (
                                <button onClick={() => handleAdvanceStatus(co, 'sent')} style={{ padding: '8px 16px', backgroundColor: '#3B82F620', border: '1px solid #3B82F6', borderRadius: 8, color: '#3B82F6', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Mark as Sent</button>
                              )}
                              {co.status === 'sent' && (
                                <button onClick={() => handleAdvanceStatus(co, 'under_review')} style={{ padding: '8px 16px', backgroundColor: '#F9731620', border: '1px solid #F97316', borderRadius: 8, color: '#F97316', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Mark as Under Review</button>
                              )}
                              {co.status === 'under_review' && (
                                <>
                                  <button onClick={() => handleAdvanceStatus(co, 'approved')} style={{ padding: '8px 16px', backgroundColor: '#22C55E20', border: '1px solid #22C55E', borderRadius: 8, color: '#22C55E', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Approve</button>
                                  <input value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} placeholder="Rejection notes (optional)..." style={{ ...inputStyle, width: 220, padding: '8px 12px', fontSize: 13 }} />
                                  <button onClick={() => handleAdvanceStatus(co, 'rejected', rejectNotes)} style={{ padding: '8px 16px', backgroundColor: '#EF444420', border: '1px solid #EF4444', borderRadius: 8, color: '#EF4444', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Reject</button>
                                </>
                              )}
                              {co.status === 'approved' && (
                                showFolderPicker === co.id ? (
                                  <>
                                    <select value={selectedFolderForTask} onChange={(e) => setSelectedFolderForTask(e.target.value)} style={{ ...inputStyle, width: 200, padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}>
                                      <option value="">No Folder</option>
                                      {(folders ?? []).map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
                                    </select>
                                    <button onClick={() => handleConvertToTask(co, selectedFolderForTask)} style={{ padding: '8px 16px', backgroundColor: '#22C55E20', border: '1px solid #22C55E', borderRadius: 8, color: '#22C55E', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Create Task</button>
                                    <button onClick={() => setShowFolderPicker(null)} style={{ padding: '8px 12px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 8, color: '#6B7280', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                                  </>
                                ) : (
                                  <button onClick={() => setShowFolderPicker(co.id)} style={{ padding: '8px 16px', backgroundColor: '#22C55E20', border: '1px solid #22C55E', borderRadius: 8, color: '#22C55E', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Convert to Task</button>
                                )
                              )}
                              {!['void', 'rejected'].includes(co.status) && (
                                <button onClick={() => { if (window.confirm('Void this change order?')) handleAdvanceStatus(co, 'void'); }} style={{ padding: '8px 16px', backgroundColor: '#4B556320', border: '1px solid #4B5563', borderRadius: 8, color: '#9CA3AF', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Void</button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* New CO Modal */}
      {showNewCO && (
        <div style={modalOverlay} onClick={() => setShowNewCO(false)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>New Change Order</h3>
              <button onClick={() => setShowNewCO(false)} style={{ backgroundColor: '#1F2937', border: 'none', borderRadius: 8, color: '#9CA3AF', fontSize: 16, cursor: 'pointer', padding: '4px 10px' }}>✕</button>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>TITLE *</label>
              <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Change order title..." style={inputStyle} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>REASON</label>
              <select value={newReason} onChange={(e) => setNewReason(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                {reasonOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>ESTIMATED COST ($)</label>
              <input type="number" value={newCost} onChange={(e) => setNewCost(e.target.value)} placeholder="0.00" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>DESCRIPTION</label>
              <textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Describe the change..." style={{ ...inputStyle, resize: 'vertical', minHeight: 80, fontFamily: 'inherit' }} />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>SCOPE OF WORK</label>
              <textarea value={newScope} onChange={(e) => setNewScope(e.target.value)} placeholder="What work is included..." style={{ ...inputStyle, resize: 'vertical', minHeight: 80, fontFamily: 'inherit' }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowNewCO(false)} style={{ flex: 1, padding: '12px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 10, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleCreateCO} disabled={savingCO || !newTitle.trim()} style={{ flex: 2, padding: '12px', backgroundColor: '#F97316', border: 'none', borderRadius: 10, color: '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>{savingCO ? 'Creating...' : 'Create Change Order'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
