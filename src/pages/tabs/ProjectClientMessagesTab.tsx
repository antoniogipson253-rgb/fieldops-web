import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

interface Props {
  projectId: string;
  isAdmin: boolean;
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

function detectAttachmentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'invoice';
  if (['doc', 'docx', 'xls', 'xlsx'].includes(ext)) return 'document';
  if (['png', 'jpg', 'jpeg'].includes(ext)) return 'photo';
  return 'other';
}

export function ProjectClientMessagesTab({ projectId, isAdmin }: Props) {
  const queryClient = useQueryClient();
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeFile, setComposeFile] = useState<File | null>(null);
  const [sendingCompose, setSendingCompose] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const { data: messages } = useQuery({
    queryKey: ['client-messages', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_messages')
        .select('*, sender:sender_id(full_name)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!projectId,
  });

  const threads: { subject: string; messages: any[]; hasUnread: boolean; lastMsg: any }[] =
    messages
      ? Object.values(
          messages.reduce((acc: any, msg: any) => {
            const subject = msg.subject || '(No Subject)';
            if (!acc[subject]) acc[subject] = { subject, messages: [], hasUnread: false, lastMsg: msg };
            acc[subject].messages.push(msg);
            acc[subject].lastMsg = msg;
            if (!msg.read_by_admin && msg.sender_type === 'client') acc[subject].hasUnread = true;
            return acc;
          }, {})
        )
      : [];

  const selectedMessages = selectedThread
    ? (threads.find((t) => t.subject === selectedThread)?.messages ?? [])
    : [];

  useEffect(() => {
    if (selectedThread) {
      setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [selectedThread, selectedMessages.length]);

  async function markThreadRead(subject: string) {
    const thread = threads.find((t) => t.subject === subject);
    if (!thread) return;
    const unreadIds = thread.messages.filter((m: any) => !m.read_by_admin && m.sender_type === 'client').map((m: any) => m.id);
    if (unreadIds.length > 0) {
      await supabase.from('client_messages').update({ read_by_admin: true }).in('id', unreadIds);
      queryClient.invalidateQueries({ queryKey: ['client-messages', projectId] });
    }
  }

  function selectThread(subject: string) {
    setSelectedThread(subject);
    markThreadRead(subject);
  }

  async function handleSendCompose() {
    if (!composeSubject.trim() || !composeBody.trim()) return;
    setSendingCompose(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      let attachmentKey: string | null = null;
      let attachmentName: string | null = null;
      let attachmentType: string | null = null;

      if (composeFile) {
        attachmentName = composeFile.name;
        attachmentType = detectAttachmentType(composeFile.name);
        const ext = composeFile.name.split('.').pop() ?? 'bin';
        attachmentKey = `client-messages/${projectId}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('project-files').upload(attachmentKey, composeFile);
        if (uploadError) throw uploadError;
      }

      const { error } = await supabase.from('client_messages').insert({
        project_id: projectId,
        subject: composeSubject.trim(),
        body: composeBody.trim(),
        sender_type: 'admin',
        sender_id: user!.id,
        read_by_admin: true,
        read_by_client: false,
        attachment_key: attachmentKey,
        attachment_name: attachmentName,
        attachment_type: attachmentType,
      });
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['client-messages', projectId] });
      setSelectedThread(composeSubject.trim());
      setShowCompose(false);
      setComposeSubject(''); setComposeBody(''); setComposeFile(null);
    } catch (e: any) { alert(e.message); }
    finally { setSendingCompose(false); }
  }

  async function handleSendReply() {
    if (!replyText.trim() || !selectedThread) return;
    setSendingReply(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('client_messages').insert({
        project_id: projectId,
        subject: selectedThread,
        body: replyText.trim(),
        sender_type: 'admin',
        sender_id: user!.id,
        read_by_admin: true,
        read_by_client: false,
      });
      if (error) throw error;
      await markThreadRead(selectedThread);
      queryClient.invalidateQueries({ queryKey: ['client-messages', projectId] });
      setReplyText('');
    } catch (e: any) { alert(e.message); }
    finally { setSendingReply(false); }
  }

  if (!messages || messages.length === 0) {
    return (
      <div style={{ color: '#FFFFFF' }}>
        <div style={{ backgroundColor: '#111827', borderRadius: 14, border: '1px solid #1F2937', padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✉️</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No client messages yet.</div>
          <div style={{ color: '#6B7280', fontSize: 14, marginBottom: 24 }}>Click Compose to start a conversation.</div>
          <button onClick={() => setShowCompose(true)} style={{ padding: '10px 24px', backgroundColor: '#F97316', border: 'none', borderRadius: 10, color: '#0A0F1E', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>✏️ Compose</button>
        </div>
        {showCompose && (
          <div style={modalOverlay} onClick={() => setShowCompose(false)}>
            <div style={modalBox} onClick={(e) => e.stopPropagation()}>
              <ComposeModal
                composeSubject={composeSubject} setComposeSubject={setComposeSubject}
                composeBody={composeBody} setComposeBody={setComposeBody}
                composeFile={composeFile} setComposeFile={setComposeFile}
                sendingCompose={sendingCompose} onSend={handleSendCompose}
                onClose={() => setShowCompose(false)} inputStyle={inputStyle}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ color: '#FFFFFF' }}>
      <div style={{ backgroundColor: '#111827', borderRadius: 14, border: '1px solid #1F2937', overflow: 'hidden', display: 'flex', minHeight: 600 }}>
        {/* Left: Thread List */}
        <div style={{ width: '30%', borderRight: '1px solid #1F2937', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px', borderBottom: '1px solid #1F2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Messages</span>
            <button onClick={() => setShowCompose(true)} style={{ padding: '6px 12px', backgroundColor: '#F97316', border: 'none', borderRadius: 6, color: '#0A0F1E', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✏️ Compose</button>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {threads.map((thread) => {
              const isSelected = selectedThread === thread.subject;
              const lastMsg = thread.lastMsg;
              const preview = lastMsg?.body?.slice(0, 60) ?? '';
              const senderName = (lastMsg?.sender as any)?.full_name ?? (lastMsg?.sender_type === 'client' ? 'Client' : 'You');
              return (
                <div
                  key={thread.subject}
                  onClick={() => selectThread(thread.subject)}
                  style={{ padding: '14px 16px', cursor: 'pointer', borderBottom: '1px solid #1F2937', backgroundColor: isSelected ? '#1F293780' : 'transparent', transition: 'background 0.15s' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: isSelected ? '#F97316' : '#FFFFFF', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>{thread.subject}</span>
                    {thread.hasUnread && <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#F97316', flexShrink: 0 }} />}
                  </div>
                  <div style={{ fontSize: 12, color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>{preview || '—'}</div>
                  <div style={{ fontSize: 11, color: '#4B5563' }}>{senderName} • {lastMsg?.created_at ? new Date(lastMsg.created_at).toLocaleDateString() : ''}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Thread Detail */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {!selectedThread ? (
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#4B5563', fontSize: 14 }}>
              Select a conversation to view messages
            </div>
          ) : (
            <>
              <div style={{ padding: '16px 24px', borderBottom: '1px solid #1F2937' }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{selectedThread}</span>
                <span style={{ marginLeft: 12, fontSize: 12, color: '#6B7280' }}>{selectedMessages.length} message{selectedMessages.length !== 1 ? 's' : ''}</span>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {selectedMessages.map((msg: any) => {
                  const isClient = msg.sender_type === 'client';
                  const senderName = (msg.sender as any)?.full_name ?? (isClient ? 'Client' : 'You');
                  const attachmentUrl = msg.attachment_key
                    ? `${process.env.REACT_APP_SUPABASE_URL}/storage/v1/object/public/project-files/${msg.attachment_key}`
                    : null;
                  return (
                    <div key={msg.id} style={{ backgroundColor: '#0D1321', borderRadius: 10, padding: 16, border: `1px solid ${isClient ? '#F9731630' : '#1F2937'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 700 }}>{senderName}</span>
                          {isClient && <span style={{ fontSize: 10, fontWeight: 700, backgroundColor: '#F9731620', color: '#F97316', border: '1px solid #F9731640', borderRadius: 4, padding: '2px 6px' }}>CLIENT</span>}
                        </div>
                        <span style={{ fontSize: 11, color: '#6B7280' }}>{new Date(msg.created_at).toLocaleString()}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: 14, color: '#D1D5DB', lineHeight: 1.6 }}>{msg.body}</p>
                      {attachmentUrl && msg.attachment_name && (
                        <a href={attachmentUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 12, padding: '8px 14px', backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 8, textDecoration: 'none', color: '#9CA3AF', fontSize: 12 }}>
                          <span>📎</span>
                          <span>{msg.attachment_name}</span>
                          {msg.attachment_type && <span style={{ fontSize: 10, backgroundColor: '#374151', padding: '2px 6px', borderRadius: 4 }}>{msg.attachment_type}</span>}
                        </a>
                      )}
                    </div>
                  );
                })}
                <div ref={threadEndRef} />
              </div>

              <div style={{ padding: '16px 24px', borderTop: '1px solid #1F2937' }}>
                <div style={{ display: 'flex', gap: 10 }}>
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSendReply(); }}
                    placeholder="Type a reply... (Ctrl+Enter to send)"
                    rows={3}
                    style={{ ...inputStyle, resize: 'none', flex: 1, fontFamily: 'inherit' }}
                  />
                  <button onClick={handleSendReply} disabled={sendingReply || !replyText.trim()} style={{ padding: '0 24px', backgroundColor: replyText.trim() ? '#F97316' : '#374151', border: 'none', borderRadius: 10, color: replyText.trim() ? '#0A0F1E' : '#6B7280', fontSize: 14, fontWeight: 800, cursor: replyText.trim() ? 'pointer' : 'not-allowed', minWidth: 80 }}>
                    {sendingReply ? '...' : 'Send'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Compose Modal */}
      {showCompose && (
        <div style={modalOverlay} onClick={() => setShowCompose(false)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <ComposeModal
              composeSubject={composeSubject} setComposeSubject={setComposeSubject}
              composeBody={composeBody} setComposeBody={setComposeBody}
              composeFile={composeFile} setComposeFile={setComposeFile}
              sendingCompose={sendingCompose} onSend={handleSendCompose}
              onClose={() => setShowCompose(false)} inputStyle={inputStyle}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ComposeModal({ composeSubject, setComposeSubject, composeBody, setComposeBody, composeFile, setComposeFile, sendingCompose, onSend, onClose, inputStyle }: any) {
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>New Message</h3>
        <button onClick={onClose} style={{ backgroundColor: '#1F2937', border: 'none', borderRadius: 8, color: '#9CA3AF', fontSize: 16, cursor: 'pointer', padding: '4px 10px' }}>✕</button>
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>SUBJECT</label>
        <input value={composeSubject} onChange={(e: any) => setComposeSubject(e.target.value)} placeholder="Message subject..." style={inputStyle} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>MESSAGE</label>
        <textarea value={composeBody} onChange={(e: any) => setComposeBody(e.target.value)} placeholder="Write your message..." rows={6} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
      </div>
      <div style={{ marginBottom: 24 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 8 }}>ATTACHMENT (OPTIONAL)</label>
        <input
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
          onChange={(e: any) => setComposeFile(e.target.files?.[0] ?? null)}
          style={{ color: '#9CA3AF', fontSize: 13 }}
        />
        {composeFile && <div style={{ marginTop: 6, fontSize: 12, color: '#22C55E' }}>✓ {composeFile.name}</div>}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={{ flex: 1, padding: '12px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 10, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
        <button onClick={onSend} disabled={sendingCompose || !composeSubject.trim() || !composeBody.trim()} style={{ flex: 2, padding: '12px', backgroundColor: '#F97316', border: 'none', borderRadius: 10, color: '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
          {sendingCompose ? 'Sending...' : 'Send Message'}
        </button>
      </div>
    </>
  );
}
