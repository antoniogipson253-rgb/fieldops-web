// Archive of scheduled daily reports (daily_report_sends). Pure helpers + the writer.
// Only the scheduled (cron) path calls archiveSend; test sends never do.

export type ArchiveStatus = 'sent' | 'delivery_uncertain' | 'failed';

export type ArchiveInput = {
  projectId: string;
  reportDate: string;            // 'YYYY-MM-DD', project-local
  status: ArchiveStatus;
  scheduledAt: Date;
  sentAt: Date | null;
  recipients: string[];
  subject: string;
  html: string;
  summary: Record<string, unknown>;
  error: string | null;
};

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#039;': "'", '&apos;': "'", '&nbsp;': ' ',
  '&middot;': '·', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&rsquo;': '’', '&lsquo;': '‘', '&rdquo;': '”', '&ldquo;': '“',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;|&#0?39;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

// Plain-text version of the emailed HTML: block elements become line breaks, table cells are
// separated by spaces, tags and <style>/<head> content are dropped, entities decoded.
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|table|section|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== ''))
    .join('\n')
    .trim();
}

// Arguments for public.record_daily_report_send. Failed sends carry no content.
export function archiveArgs(a: ArchiveInput) {
  const keepContent = a.status !== 'failed';
  return {
    p_project_id: a.projectId,
    p_report_date: a.reportDate,
    p_status: a.status,
    p_scheduled_at: a.scheduledAt.toISOString(),
    p_sent_at: a.sentAt ? a.sentAt.toISOString() : null,
    p_recipient_emails: [...new Set(a.recipients.map((e) => e.trim()).filter(Boolean))],
    p_subject: a.subject,
    p_content_html: keepContent ? a.html : null,
    p_content_text: keepContent ? htmlToText(a.html) : null,
    p_summary: a.summary,
    p_error: a.error ? a.error.slice(0, 1000) : null,
  };
}

// Writes the archive row. Never throws: an archive problem must never change what happens to
// the email itself (no resend, no released claim). Returns a short result for the summary.
// deno-lint-ignore no-explicit-any
export async function archiveSend(admin: any, a: ArchiveInput): Promise<'archived' | 'kept_existing' | 'archive_failed'> {
  try {
    const { data, error } = await admin.rpc('record_daily_report_send', archiveArgs(a));
    if (error) throw error;
    return data ? 'archived' : 'kept_existing';
  } catch (e: any) {
    console.error(`Project ${a.projectId}: archiving the ${a.reportDate} report (${a.status}) failed: ${e?.message ?? e}`);
    return 'archive_failed';
  }
}
