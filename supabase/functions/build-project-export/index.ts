import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import ExcelJS from 'npm:exceljs@4.4.0';
import { corsHeaders, json, bearer, isServiceRole, UUID_RE } from '../_shared/common.ts';
import { buildWorkbook, loadExportData, exportFileName, XLSX_MIME } from '../_shared/project_export.ts';
import { localDateOf } from '../_shared/schedule.ts';

// build-project-export (verify_jwt = true)
//
//  - Download (user JWT, body { projectId }): caller must be a member of the company that owns
//    the project (can_read_project_export, checked AS the caller). Builds a fresh file from the
//    app's data, stores it as project-exports/<project_id>.xlsx and returns it.
//    Returned as application/octet-stream so supabase-js functions.invoke hands back a Blob.
//  - Queue (service-role token, body { mode: 'queue' }; pg_cron every minute): rebuilds stored
//    files for projects that changed, once a project has been quiet for 30 s or dirty for 90 s,
//    so rapid taps produce one rebuild.

const BUCKET = 'project-exports';
const QUIET_MS = 30 * 1000;
const MAX_WAIT_MS = 90 * 1000;
const MAX_PER_RUN = 20;

async function buildBytes(admin: SupabaseClient, projectId: string) {
  const data = await loadExportData(admin, projectId);
  if (!data) return null;
  const { workbook, counts, sheets } = buildWorkbook(ExcelJS, data);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  return { data, bytes, counts, sheets };
}

async function store(admin: SupabaseClient, projectId: string, bytes: Uint8Array) {
  const { error } = await admin.storage.from(BUCKET).upload(`${projectId}.xlsx`, bytes, { contentType: XLSX_MIME, upsert: true });
  if (error) throw error;
}

async function runQueue(admin: SupabaseClient) {
  const now = Date.now();
  const summary = { success: true, mode: 'queue', candidates: 0, built: 0, waiting: 0, removed: 0, failures: [] as { project_id: string; error: string }[] };

  const { data: rows, error } = await admin
    .from('project_export_queue')
    .select('project_id, dirty_at, first_dirty_at, last_built_at')
    .order('first_dirty_at', { ascending: true })
    .limit(500);
  if (error) throw error;

  const due = (rows ?? []).filter((r: any) => !r.last_built_at || new Date(r.last_built_at) < new Date(r.dirty_at));
  summary.candidates = due.length;

  for (const r of due) {
    if (summary.built >= MAX_PER_RUN) break;
    const dirty = new Date(r.dirty_at).getTime();
    const first = new Date(r.first_dirty_at).getTime();
    if (now - dirty < QUIET_MS && now - first < MAX_WAIT_MS) { summary.waiting++; continue; }

    const startedAt = new Date().toISOString();
    // Claim: only if nothing changed since we read it (compare-and-set on dirty_at).
    const { data: claimed, error: claimError } = await admin.from('project_export_queue')
      .update({ last_built_at: startedAt, last_error: null })
      .eq('project_id', r.project_id).eq('dirty_at', r.dirty_at).select('project_id');
    if (claimError) throw claimError;
    if (!claimed || claimed.length === 0) { summary.waiting++; continue; }

    try {
      const built = await buildBytes(admin, r.project_id);
      if (!built) {
        // Project was deleted: remove its stored file and queue row.
        await admin.storage.from(BUCKET).remove([`${r.project_id}.xlsx`]);
        await admin.from('project_export_queue').delete().eq('project_id', r.project_id);
        summary.removed++;
        continue;
      }
      await store(admin, r.project_id, built.bytes);
      summary.built++;
    } catch (e: any) {
      const message = String(e?.message ?? e).slice(0, 500);
      console.error(`Project ${r.project_id}: export build failed: ${message}`);
      // Release the claim so the next run retries.
      await admin.from('project_export_queue').update({ last_built_at: r.last_built_at, last_error: message }).eq('project_id', r.project_id);
      summary.failures.push({ project_id: r.project_id, error: message });
    }
  }
  return summary;
}

async function runDownload(admin: SupabaseClient, token: string, projectId: unknown) {
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) return json({ success: false, error: 'Not authenticated' }, 401);
  if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) return json({ success: false, error: 'projectId is required' }, 400);

  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  });
  const { data: allowed, error: rpcError } = await asUser.rpc('can_read_project_export', { p_project_id: projectId });
  if (rpcError) throw rpcError;
  if (allowed !== true) return json({ success: false, error: 'Only members of the company that owns this project can download its spreadsheet' }, 403);

  const built = await buildBytes(admin, projectId);
  if (!built) return json({ success: false, error: 'Project not found' }, 404);
  try { await store(admin, projectId, built.bytes); } catch (e: any) { console.error(`Project ${projectId}: storing export failed: ${e?.message ?? e}`); }

  const { data: settings } = await admin.from('project_report_settings').select('timezone').eq('project_id', projectId).maybeSingle();
  const filename = exportFileName(built.data.project.name, localDateOf(new Date(), settings?.timezone ?? 'America/Chicago'));
  return new Response(built.bytes, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const token = bearer(req);
    if (!token) return json({ success: false, error: 'Not authenticated' }, 401);
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));

    if (isServiceRole(token)) {
      if ((body as any)?.mode === 'queue') return json(await runQueue(admin));
      return json({ success: false, error: 'Unknown mode' }, 400);
    }
    return await runDownload(admin, token, (body as any)?.projectId);
  } catch (e: any) {
    console.error('build-project-export error:', e?.message ?? e);
    return json({ success: false, error: e?.message ?? 'Unexpected error' }, 500);
  }
});
