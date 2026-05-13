import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function ChatPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setCurrentUser(user));
  }, []);

  const { data: project } = useQuery({
    queryKey: ['web-project', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('name')
        .eq('id', projectId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  const { data: messages } = useQuery({
    queryKey: ['web-chat', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select(`
          *,
          author:user_id (id, full_name)
        `)
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
    refetchInterval: 5000,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Real-time subscription
 useEffect(() => {
    if (!projectId) return;

    const channel = supabase
      .channel(`chat-${projectId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `project_id=eq.${projectId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['web-chat', projectId] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleSend() {
    if (!message.trim() || !currentUser) return;
    setSending(true);
    try {
      const { error } = await supabase.from('messages').insert({
        project_id: projectId,
        user_id: currentUser.id,
        body: message.trim(),
      });
      if (error) throw error;
      setMessage('');
      queryClient.invalidateQueries({ queryKey: ['web-chat', projectId] });
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSending(false);
    }
  }

  function getInitials(name: string | null) {
    if (!name) return '??';
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  }

  function formatTime(dateString: string) {
    return new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
      ' ' + new Date(dateString).toLocaleDateString();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', color: '#FFFFFF' }}>
      {/* Header */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid #1F2937',
        backgroundColor: '#0D1321',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        <button
          onClick={() => navigate(`/projects/${projectId}`)}
          style={{ backgroundColor: 'transparent', border: 'none', color: '#F97316', fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 0 }}
        >
          ← Back
        </button>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>💬 {project?.name}</div>
          <div style={{ fontSize: 12, color: '#6B7280' }}>Project Chat</div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages?.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#4B5563' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#FFFFFF', marginBottom: 4 }}>No messages yet</div>
            <div style={{ fontSize: 13 }}>Start the conversation</div>
          </div>
        )}

        {messages?.map((msg) => {
          const isMe = msg.user_id === currentUser?.id;
          const author = msg.author as any;

          return (
            <div key={msg.id} style={{
              display: 'flex',
              flexDirection: isMe ? 'row-reverse' : 'row',
              gap: 10,
              alignItems: 'flex-end',
            }}>
              {/* Avatar */}
              {!isMe && (
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: '#1F2937',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#F97316',
                  flexShrink: 0,
                }}>
                  {getInitials(author?.full_name)}
                </div>
              )}

              <div style={{ maxWidth: '65%' }}>
                {!isMe && (
                  <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4, paddingLeft: 4 }}>
                    {author?.full_name ?? 'Unknown'}
                  </div>
                )}
                <div style={{
                  backgroundColor: isMe ? '#F97316' : '#111827',
                  color: isMe ? '#0A0F1E' : '#FFFFFF',
                  padding: '10px 14px',
                  borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  fontSize: 14,
                  lineHeight: 1.5,
                  border: isMe ? 'none' : '1px solid #1F2937',
                }}>
                  {msg.body}
                </div>
                <div style={{
                  fontSize: 10,
                  color: '#374151',
                  marginTop: 4,
                  textAlign: isMe ? 'right' : 'left',
                  paddingLeft: isMe ? 0 : 4,
                }}>
                  {formatTime(msg.created_at)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <div style={{
        padding: '16px 24px',
        borderTop: '1px solid #1F2937',
        backgroundColor: '#0D1321',
        display: 'flex',
        gap: 10,
      }}>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Type a message..."
          style={{
            flex: 1,
            padding: '12px 16px',
            backgroundColor: '#111827',
            border: '1px solid #1F2937',
            borderRadius: 12,
            color: '#FFFFFF',
            fontSize: 14,
            outline: 'none',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!message.trim() || sending}
          style={{
            padding: '12px 24px',
            backgroundColor: !message.trim() || sending ? '#374151' : '#F97316',
            border: 'none',
            borderRadius: 12,
            color: !message.trim() || sending ? '#6B7280' : '#0A0F1E',
            fontSize: 14,
            fontWeight: 800,
            cursor: !message.trim() || sending ? 'not-allowed' : 'pointer',
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}