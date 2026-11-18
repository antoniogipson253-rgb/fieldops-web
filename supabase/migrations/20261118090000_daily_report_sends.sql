-- Archive of automatic daily reports that were actually sent.
--
--  - daily_report_sends: one row per project per local report day, written ONLY by the
--    send-daily-reports edge function (service role) through record_daily_report_send().
--    Scheduled (cron) sends only; test sends never create rows.
--      status 'sent'               : delivered; content is exactly what was emailed.
--      status 'delivery_uncertain' : the email provider timed out / 5xx after a retry, so it may
--                                    have been delivered; content kept because recipients may
--                                    have it. Never retried (same rule as the send itself).
--      status 'failed'             : rejected by the provider, nothing delivered; no content.
--                                    A retry inside the 2-hour window that succeeds updates the
--                                    same row to 'sent' with content.
--    A 'sent' row is never overwritten.
--  - Readable by company admins and project managers of the project's company
--    (can_manage_project_reports). No client access. No insert/update/delete from the app.
--
-- Nothing here touches daily_reports (the old manual reports), its RLS or its trigger, the
-- spreadsheet export, folder checklists, missing-part reminders or any cron job.
-- Runs as one transaction.

create table public.daily_report_sends (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  report_date date not null,                       -- the project's local calendar day
  status text not null check (status in ('sent', 'delivery_uncertain', 'failed')),
  scheduled_at timestamptz,                        -- the day's scheduled send time
  sent_at timestamptz,                             -- when the provider accepted it (null if failed)
  recipient_emails text[] not null default '{}',
  subject text not null,
  content_html text,                               -- exactly the HTML that was emailed
  content_text text,                               -- plain-text version of the same content
  summary jsonb not null default '{}'::jsonb,      -- counts and the time window covered
  error text,
  attempts integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_report_sends_one_per_day unique (project_id, report_date),
  constraint daily_report_sends_content_when_delivered
    check (status = 'failed' or content_html is not null)
);

alter table public.daily_report_sends enable row level security;
revoke all on public.daily_report_sends from anon, authenticated;
grant select on public.daily_report_sends to authenticated;

create policy "Admins and project managers can read sent daily reports"
  on public.daily_report_sends for select to authenticated
  using (public.can_manage_project_reports(project_id));

-- Writer used by the edge function. Upsert on (project_id, report_date); never downgrades or
-- replaces a 'sent' row. Returns the row id, or null when an existing 'sent' row was kept.
create or replace function public.record_daily_report_send(
  p_project_id uuid,
  p_report_date date,
  p_status text,
  p_scheduled_at timestamptz,
  p_sent_at timestamptz,
  p_recipient_emails text[],
  p_subject text,
  p_content_html text,
  p_content_text text,
  p_summary jsonb,
  p_error text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into public.daily_report_sends as d
    (project_id, report_date, status, scheduled_at, sent_at, recipient_emails, subject,
     content_html, content_text, summary, error)
  values
    (p_project_id, p_report_date, p_status, p_scheduled_at, p_sent_at, coalesce(p_recipient_emails, '{}'), p_subject,
     case when p_status = 'failed' then null else p_content_html end,
     case when p_status = 'failed' then null else p_content_text end,
     coalesce(p_summary, '{}'::jsonb), p_error)
  on conflict (project_id, report_date) do update set
    status = excluded.status,
    scheduled_at = excluded.scheduled_at,
    sent_at = excluded.sent_at,
    recipient_emails = excluded.recipient_emails,
    subject = excluded.subject,
    content_html = excluded.content_html,
    content_text = excluded.content_text,
    summary = excluded.summary,
    error = excluded.error,
    attempts = d.attempts + 1,
    updated_at = now()
  where d.status <> 'sent'
  returning d.id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.record_daily_report_send(uuid, date, text, timestamptz, timestamptz, text[], text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_daily_report_send(uuid, date, text, timestamptz, timestamptz, text[], text, text, text, jsonb, text) to service_role;
