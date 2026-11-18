import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useIsAdmin } from '../lib/useIsAdmin';
import { useIsMobile } from '../hooks/useIsMobile';
import { btn, card, colors, input, sectionLabel, tint } from '../theme';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import Icon from '../components/ui/Icon';

export default function FilesPage() {
  const queryClient = useQueryClient();
  const { data: isAdmin } = useIsAdmin();
  const isMobile = useIsMobile();
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

  function fileTag(fileType: string) {
    const type = (fileType ?? '').toLowerCase();
    const c = type === 'pdf' ? colors.red
      : ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(type) ? colors.blue
      : ['doc', 'docx', 'txt', 'rtf'].includes(type) ? colors.violet
      : ['xls', 'xlsx', 'csv'].includes(type) ? colors.green
      : ['dwg', 'dxf'].includes(type) ? colors.amber
      : colors.gray;
    return (
      <span aria-label={`${type.toUpperCase() || 'File'} file`} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 44, padding: '3px 6px', borderRadius: 6, backgroundColor: tint(c, 0.15), border: `1px solid ${tint(c, 0.45)}`, color: c, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', flexShrink: 0 }}>
        {(type || 'file').toUpperCase().slice(0, 4)}
      </span>
    );
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

  const COLS = 'minmax(0, 2.4fr) minmax(0, 1fr) 80px minmax(0, 1fr) 110px 130px';
  const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: colors.text2, marginBottom: 6 };

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: colors.text }}>
      <PageHeader
        title="Files"
        subtitle="Submittals, floor plans and project documents"
        actions={isAdmin ? (
          <>
            <label htmlFor="upload-project" className="fo-sr-only">Project to upload to</label>
            <select
              id="upload-project"
              value={uploadProjectId}
              onChange={(e) => setUploadProjectId(e.target.value)}
              style={{ ...input, width: 'auto', minWidth: 200, cursor: 'pointer', color: uploadProjectId ? colors.text : colors.text3 }}
            >
              <option value="">Select project to upload to</option>
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
              {...btn('primary')}
            >
              <Icon name="upload" size={15} /> {uploading ? 'Uploading...' : 'Upload file'}
            </button>
            <input ref={fileInputRef} type="file" onChange={handleUpload} style={{ display: 'none' }} />
          </>
        ) : undefined}
      />

      {/* Filters */}
      <div style={{ ...card, padding: isMobile ? 12 : 14, marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: isMobile ? '1 1 100%' : '0 1 260px', minWidth: 0 }}>
          <label htmlFor="files-project" style={fieldLabel}>Project</label>
          <select id="files-project" value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)} style={{ ...input, cursor: 'pointer', backgroundColor: colors.bg }}>
            <option value="all">All projects</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: '1 1 240px', minWidth: 0, position: 'relative' }}>
          <label htmlFor="files-search" style={fieldLabel}>Search</label>
          <span aria-hidden="true" style={{ position: 'absolute', left: 12, bottom: 13, color: colors.text3, display: 'inline-flex' }}><Icon name="search" size={15} /></span>
          <input id="files-search" type="search" placeholder="Search file names..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...input, paddingLeft: 36, backgroundColor: colors.bg }} />
        </div>
      </div>

      {/* Files */}
      {isLoading ? (
        <div style={{ ...card, padding: 0 }} role="status" aria-label="Loading files">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderTop: i ? `1px solid ${colors.border}` : 'none' }}>
              <Skeleton width={44} height={22} radius={6} />
              <Skeleton width="40%" height={14} />
            </div>
          ))}
        </div>
      ) : filtered?.length === 0 ? (
        search || selectedProject !== 'all' ? (
          <EmptyState title="No files found" message="No files match this project or search." actionLabel="Show all files" onAction={() => { setSearch(''); setSelectedProject('all'); }} />
        ) : (
          <EmptyState
            title="No files yet"
            message={isAdmin ? 'Pick a project above and upload the first document.' : 'No files have been uploaded yet.'}
            actionLabel={isAdmin && uploadProjectId ? 'Upload file' : undefined}
            onAction={() => fileInputRef.current?.click()}
          />
        )
      ) : (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 18px', fontSize: 13, color: colors.text2, borderBottom: `1px solid ${colors.border}` }}>
            {filtered?.length ?? 0} file{filtered?.length === 1 ? '' : 's'}
          </div>
          {!isMobile && (
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '10px 18px', backgroundColor: colors.bg }}>
              {['File', 'Project', 'Size', 'Uploaded by', 'Date', ''].map((h, i) => <div key={i} style={{ ...sectionLabel, fontSize: 10.5 }}>{h}</div>)}
            </div>
          )}
          {filtered?.map((file) => {
            const actions = (
              <div style={{ display: 'flex', gap: 8, justifyContent: isMobile ? 'flex-start' : 'flex-end' }}>
                <button onClick={() => handleOpen(file)} {...btn('secondary', { padding: '6px 12px', fontSize: 13 })}>Open</button>
                {isAdmin && (
                  <button type="button" className="fo-icon-btn fo-icon-btn-danger" onClick={() => handleDelete(file)} aria-label={`Delete ${file.name}`} title="Delete file">
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </div>
            );
            const nameBlock = (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                {fileTag(file.file_type)}
                <div style={{ fontSize: 14, fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{file.name}</div>
              </div>
            );
            return isMobile ? (
              <div key={file.id} className="fo-row" style={{ padding: '14px 16px', borderTop: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {nameBlock}
                <div style={{ fontSize: 12, color: colors.text2 }}>
                  {(file.project as any)?.name ?? 'Unknown'} · {formatFileSize(file.file_size)} · {(file.uploader as any)?.full_name ?? 'Unknown'} · {formatDate(file.created_at)}
                </div>
                {actions}
              </div>
            ) : (
              <div key={file.id} className="fo-row" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', padding: '12px 18px', borderTop: `1px solid ${colors.border}` }}>
                {nameBlock}
                <div style={{ fontSize: 13, color: colors.text2, overflowWrap: 'anywhere' }}>{(file.project as any)?.name ?? 'Unknown'}</div>
                <div style={{ fontSize: 13, color: colors.text2 }}>{formatFileSize(file.file_size)}</div>
                <div style={{ fontSize: 13, color: colors.text2, overflowWrap: 'anywhere' }}>{(file.uploader as any)?.full_name ?? 'Unknown'}</div>
                <div style={{ fontSize: 13, color: colors.text2 }}>{formatDate(file.created_at)}</div>
                {actions}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
