import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useIsAdmin } from '../lib/useIsAdmin';

export default function FilesPage() {
  const queryClient = useQueryClient();
  const { data: isAdmin } = useIsAdmin();
  const [selectedProject, setSelectedProject] = useState('all');
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProjectId, setUploadProjectId] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: projects } = useQuery({
    queryKey: ['web-files-projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name')
        .eq('archived', false)
        .order('name', { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: files, isLoading } = useQuery({
    queryKey: ['web-files', selectedProject],
    queryFn: async () => {
      let query = supabase
        .from('project_files')
        .select(`*, project:project_id (name), uploader:uploaded_by (full_name)`)
        .order('created_at', { ascending: false });
      if (selectedProject !== 'all') query = query.eq('project_id', selectedProject);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const filtered = files?.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!uploadProjectId) {
      alert('Please select a project first.');
      return;
    }
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const fileExt = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
      const storageKey = `${uploadProjectId}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('project-files')
        .upload(storageKey, file, { contentType: file.type });
      if (uploadError) throw uploadError;
      const { error: dbError } = await supabase
        .from('project_files')
        .insert({
          project_id: uploadProjectId,
          uploaded_by: user!.id,
          name: file.name,
          storage_key: storageKey,
          file_type: fileExt,
          file_size: file.size,
        });
      if (dbError) throw dbError;
      queryClient.invalidateQueries({ queryKey: ['web-files'] });
      alert('File uploaded successfully!');
    } catch (e: any) {
      alert('Upload failed: ' + e.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDelete(file: any) {
    if (!window.confirm(`Delete "${file.name}"? This cannot be undone.`)) return;
    try {
      await supabase.storage.from('project-files').remove([file.storage_key]);
      await supabase.from('project_files').delete().eq('id', file.id);
      queryClient.invalidateQueries({ queryKey: ['web-files'] });
    } catch (e: any) {
      alert('Delete failed: ' + e.message);
    }
  }

  async function handleOpen(file: any) {
    try {
      const { data, error } = await supabase.storage
        .from('project-files')
        .createSignedUrl(file.storage_key, 60 * 60);
      if (error) throw error;
      window.open(data.signedUrl, '_blank');
    } catch (e: any) {
      alert('Could not open file: ' + e.message);
    }
  }

  function getFileIcon(fileType: string) {
    const type = fileType.toLowerCase();
    if (type === 'pdf') return '📄';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(type)) return '🖼️';
    if (['doc', 'docx'].includes(type)) return '📝';
    if (['xls', 'xlsx'].includes(type)) return '📊';
    if (['dwg', 'dxf'].includes(type)) return '📐';
    return '📎';
  }

  function formatFileSize(bytes: number) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  return (
    <div style={{ padding: 32, color: '#FFFFFF' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, marginBottom: 4 }}>Files</h1>
          <p style={{ color: '#6B7280', fontSize: 14, margin: 0 }}>Submittals, floor plans, and project documents</p>
        </div>

        {/* Upload — admin only */}
        {isAdmin && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={uploadProjectId}
              onChange={(e) => setUploadProjectId(e.target.value)}
              style={{
                padding: '10px 14px',
                backgroundColor: '#111827',
                border: `1px solid ${uploadProjectId ? '#F97316' : '#374151'}`,
                borderRadius: 10,
                color: uploadProjectId ? '#FFFFFF' : '#6B7280',
                fontSize: 13,
                outline: 'none',
                cursor: 'pointer',
                minWidth: 200,
              }}
            >
              <option value="">← Select project first</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              onClick={() => {
                if (!uploadProjectId) {
                  alert('Please select a project from the dropdown first.');
                  return;
                }
                fileInputRef.current?.click();
              }}
              disabled={uploading}
              style={{
                padding: '10px 20px',
                backgroundColor: uploading ? '#374151' : '#F97316',
                border: 'none',
                borderRadius: 10,
                color: uploading ? '#6B7280' : '#0A0F1E',
                fontSize: 14,
                fontWeight: 800,
                cursor: uploading ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {uploading ? '⏳ Uploading...' : '+ Upload File'}
            </button>
            <input ref={fileInputRef} type="file" onChange={handleUpload} style={{ display: 'none' }} />
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search files..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200, maxWidth: 320, padding: '10px 16px', backgroundColor: '#111827', border: '1px solid #1F2937', borderRadius: 10, color: '#FFFFFF', fontSize: 14, outline: 'none' }}
        />
        <select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          style={{ padding: '10px 16px', backgroundColor: '#111827', border: '1px solid #1F2937', borderRadius: 10, color: '#FFFFFF', fontSize: 14, outline: 'none', cursor: 'pointer', minWidth: 200 }}
        >
          <option value="all">All Projects</option>
          {projects?.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Files Table */}
      {isLoading ? (
        <div style={{ color: '#F97316' }}>Loading...</div>
      ) : filtered?.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#4B5563' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📂</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#FFFFFF', marginBottom: 6 }}>No files found</div>
          <div style={{ fontSize: 14 }}>
            {isAdmin ? 'Select a project and click "+ Upload File" to add files' : 'No files have been uploaded yet'}
          </div>
        </div>
      ) : (
        <div style={{ backgroundColor: '#111827', borderRadius: 14, border: '1px solid #1F2937', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #1F2937', fontSize: 13, color: '#6B7280' }}>
            {filtered?.length ?? 0} files
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#0D1321' }}>
                {['File', 'Project', 'Size', 'Uploaded By', 'Date', ''].map((h) => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered?.map((file, i) => (
                <tr key={file.id} style={{ borderTop: '1px solid #1F2937', backgroundColor: i % 2 === 0 ? 'transparent' : '#0D132110' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 24 }}>{getFileIcon(file.file_type)}</span>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{file.name}</div>
                        <div style={{ fontSize: 11, color: '#6B7280', marginTop: 1 }}>{file.file_type.toUpperCase()}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#9CA3AF' }}>{(file.project as any)?.name ?? 'Unknown'}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#9CA3AF' }}>{formatFileSize(file.file_size)}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#9CA3AF' }}>{(file.uploader as any)?.full_name ?? 'Unknown'}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#9CA3AF' }}>{formatDate(file.created_at)}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => handleOpen(file)} style={{ padding: '6px 14px', backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 8, color: '#9CA3AF', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Open</button>
                      {isAdmin && (
                        <button onClick={() => handleDelete(file)} style={{ padding: '6px 14px', backgroundColor: 'transparent', border: '1px solid #EF4444', borderRadius: 8, color: '#EF4444', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}