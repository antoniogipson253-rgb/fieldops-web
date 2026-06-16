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
  width: '100%', maxWidth: 480, border: '1px solid #1F2937',
  maxHeight: '85vh', overflowY: 'auto',
};

const statusColors: Record<string, string> = {
  pending: '#F97316',
  approved: '#22C55E',
  rejected: '#EF4444',
};

export function ProjectBudgetTab({ projectId, isAdmin, canEdit }: Props) {
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState('all');
  const [showSetBudget, setShowSetBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('Materials');
  const [expenseDescription, setExpenseDescription] = useState('');
  const [savingExpense, setSavingExpense] = useState(false);
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);

  const { data: budget } = useQuery({
    queryKey: ['project-budget', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('project_budgets').select('*').eq('project_id', projectId).maybeSingle();
      return data;
    },
    enabled: !!projectId,
  });

  const { data: expenses } = useQuery({
    queryKey: ['project-expenses', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_expenses')
        .select('*, submitter:submitted_by(full_name)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!projectId,
  });

  const totalBudget = (budget as any)?.budget_amount ?? 0;
  const spent = (expenses ?? []).filter((e: any) => e.status === 'approved').reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
  const remaining = totalBudget - spent;
  const pct = totalBudget > 0 ? Math.round((spent / totalBudget) * 100) : 0;
  const progressColor = pct >= 80 ? '#EF4444' : pct >= 50 ? '#F97316' : '#22C55E';
  const filtered = (expenses ?? []).filter((e: any) => filterStatus === 'all' || e.status === filterStatus);

  async function handleSetBudget() {
    if (!budgetInput) return;
    setSavingBudget(true);
    try {
      const { error } = await supabase.from('project_budgets').upsert(
        { project_id: projectId, budget_amount: parseFloat(budgetInput) },
        { onConflict: 'project_id' }
      );
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['project-budget', projectId] });
      setShowSetBudget(false);
      setBudgetInput('');
    } catch (e: any) { alert(e.message); }
    finally { setSavingBudget(false); }
  }

  async function handleAddExpense() {
    if (!expenseAmount || !expenseDescription) return;
    setSavingExpense(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('project_expenses').insert({
        project_id: projectId,
        amount: parseFloat(expenseAmount),
        category: expenseCategory,
        description: expenseDescription,
        status: 'pending',
        submitted_by: user!.id,
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['project-expenses', projectId] });
      setShowAddExpense(false);
      setExpenseAmount(''); setExpenseDescription(''); setExpenseCategory('Materials');
    } catch (e: any) { alert(e.message); }
    finally { setSavingExpense(false); }
  }

  async function handleApprove(expenseId: string) {
    await supabase.from('project_expenses').update({ status: 'approved' }).eq('id', expenseId);
    queryClient.invalidateQueries({ queryKey: ['project-expenses', projectId] });
  }

  async function handleReject(expenseId: string) {
    await supabase.from('project_expenses').update({ status: 'rejected' }).eq('id', expenseId);
    queryClient.invalidateQueries({ queryKey: ['project-expenses', projectId] });
  }

  return (
    <div style={{ color: '#FFFFFF' }}>
      {/* Budget Overview */}
      <div style={{ backgroundColor: '#111827', borderRadius: 14, border: '1px solid #1F2937', padding: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Budget Overview</h3>
          {isAdmin && (
            <button onClick={() => { setBudgetInput(String(totalBudget || '')); setShowSetBudget(!showSetBudget); }} style={{ padding: '8px 16px', backgroundColor: '#F97316', border: 'none', borderRadius: 8, color: '#0A0F1E', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Set Budget
            </button>
          )}
        </div>

        {showSetBudget && isAdmin && (
          <div style={{ backgroundColor: '#0D1321', borderRadius: 10, padding: 16, marginBottom: 20, border: '1px solid #F97316' }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>TOTAL BUDGET ($)</label>
            <div style={{ display: 'flex', gap: 10 }}>
              <input type="number" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} placeholder="0.00" style={{ ...inputStyle, flex: 1 }} autoFocus />
              <button onClick={handleSetBudget} disabled={savingBudget} style={{ padding: '10px 20px', backgroundColor: '#F97316', border: 'none', borderRadius: 8, color: '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>{savingBudget ? '...' : 'Save'}</button>
              <button onClick={() => setShowSetBudget(false)} style={{ padding: '10px 16px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 8, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        )}

        {pct >= 80 && totalBudget > 0 && (
          <div style={{ backgroundColor: '#EF444420', border: '1px solid #EF4444', borderRadius: 10, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: '#EF4444', fontWeight: 600 }}>
            ⚠️ Budget Warning: {pct}% used
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: totalBudget > 0 ? 20 : 0 }}>
          {[
            { label: 'TOTAL BUDGET', value: `$${totalBudget.toLocaleString()}`, color: '#FFFFFF' },
            { label: 'SPENT', value: `$${spent.toLocaleString()}`, color: progressColor },
            { label: 'REMAINING', value: `$${remaining.toLocaleString()}`, color: remaining < 0 ? '#EF4444' : '#22C55E' },
          ].map((item) => (
            <div key={item.label} style={{ backgroundColor: '#0D1321', borderRadius: 10, padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 700, letterSpacing: 2, marginBottom: 8 }}>{item.label}</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: item.color }}>{item.value}</div>
            </div>
          ))}
        </div>

        {totalBudget > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: '#6B7280' }}>Budget Used</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: progressColor }}>{pct}%</span>
            </div>
            <div style={{ height: 8, backgroundColor: '#1F2937', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, backgroundColor: progressColor, borderRadius: 4, transition: 'width 0.5s ease' }} />
            </div>
          </>
        )}
      </div>

      {/* Expense List */}
      <div style={{ backgroundColor: '#111827', borderRadius: 14, border: '1px solid #1F2937', overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #1F2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Expenses</h3>
          {canEdit && (
            <button onClick={() => setShowAddExpense(true)} style={{ padding: '8px 16px', backgroundColor: '#F97316', border: 'none', borderRadius: 8, color: '#0A0F1E', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ Add Expense</button>
          )}
        </div>

        <div style={{ padding: '12px 24px', borderBottom: '1px solid #1F2937', display: 'flex', gap: 8 }}>
          {['all', 'pending', 'approved', 'rejected'].map((s) => (
            <button key={s} onClick={() => setFilterStatus(s)} style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', backgroundColor: filterStatus === s ? '#F97316' : '#1F2937', border: `1px solid ${filterStatus === s ? '#F97316' : '#374151'}`, color: filterStatus === s ? '#0A0F1E' : '#9CA3AF' }}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#4B5563' }}>No expenses found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#0D1321' }}>
                  {['Date', 'Description', 'Category', 'Amount', 'Submitted By', 'Status', 'Actions'].map((h) => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 1 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((expense: any, i: number) => {
                  const photoUrl = expense.receipt_photo_key
                    ? `${process.env.REACT_APP_SUPABASE_URL}/storage/v1/object/public/project-files/${expense.receipt_photo_key}`
                    : null;
                  return (
                    <tr key={expense.id} style={{ borderTop: '1px solid #1F2937', backgroundColor: i % 2 === 0 ? 'transparent' : '#0D132120' }}>
                      <td style={{ padding: '12px 14px', fontSize: 13, color: '#9CA3AF', whiteSpace: 'nowrap' }}>{new Date(expense.created_at).toLocaleDateString()}</td>
                      <td style={{ padding: '12px 14px', fontSize: 13 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{expense.description}</span>
                          {expense.change_order_id && (
                            <span style={{ fontSize: 10, fontWeight: 700, backgroundColor: '#3B82F620', color: '#3B82F6', border: '1px solid #3B82F640', borderRadius: 4, padding: '2px 6px' }}>CO</span>
                          )}
                        </div>
                        {photoUrl && (
                          <img src={photoUrl} alt="receipt" onClick={() => setViewPhoto(photoUrl)} style={{ display: 'block', width: 40, height: 40, objectFit: 'cover', borderRadius: 6, marginTop: 6, cursor: 'pointer', border: '1px solid #374151' }} />
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: 12, color: '#9CA3AF' }}>{expense.category}</td>
                      <td style={{ padding: '12px 14px', fontSize: 14, fontWeight: 700, color: '#FFFFFF', whiteSpace: 'nowrap' }}>${(expense.amount ?? 0).toLocaleString()}</td>
                      <td style={{ padding: '12px 14px', fontSize: 13, color: '#9CA3AF' }}>{(expense.submitter as any)?.full_name ?? '—'}</td>
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: statusColors[expense.status] ?? '#6B7280', backgroundColor: (statusColors[expense.status] ?? '#6B7280') + '20', padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>{expense.status}</span>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {isAdmin && expense.status === 'pending' && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => handleApprove(expense.id)} style={{ padding: '5px 12px', backgroundColor: '#22C55E20', border: '1px solid #22C55E', borderRadius: 6, color: '#22C55E', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Approve</button>
                            <button onClick={() => handleReject(expense.id)} style={{ padding: '5px 12px', backgroundColor: '#EF444420', border: '1px solid #EF4444', borderRadius: 6, color: '#EF4444', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Reject</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Expense Modal */}
      {showAddExpense && (
        <div style={modalOverlay} onClick={() => setShowAddExpense(false)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Add Expense</h3>
              <button onClick={() => setShowAddExpense(false)} style={{ backgroundColor: '#1F2937', border: 'none', borderRadius: 8, color: '#9CA3AF', fontSize: 16, cursor: 'pointer', padding: '4px 10px' }}>✕</button>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>AMOUNT ($)</label>
              <input type="number" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} placeholder="0.00" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>CATEGORY</label>
              <select value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                {['Materials', 'Equipment', 'Labor', 'Subcontractor', 'Permits', 'Other'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>DESCRIPTION</label>
              <input value={expenseDescription} onChange={(e) => setExpenseDescription(e.target.value)} placeholder="What was this expense for?" style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowAddExpense(false)} style={{ flex: 1, padding: '12px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 10, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleAddExpense} disabled={savingExpense || !expenseAmount || !expenseDescription} style={{ flex: 2, padding: '12px', backgroundColor: '#F97316', border: 'none', borderRadius: 10, color: '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>{savingExpense ? 'Saving...' : 'Submit Expense'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Photo Lightbox */}
      {viewPhoto && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.95)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }} onClick={() => setViewPhoto(null)}>
          <button onClick={() => setViewPhoto(null)} style={{ position: 'absolute', top: 24, right: 24, backgroundColor: '#1F2937', border: 'none', borderRadius: 20, color: '#FFFFFF', fontSize: 16, cursor: 'pointer', width: 40, height: 40 }}>✕</button>
          <img src={viewPhoto} alt="receipt" style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8 }} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
