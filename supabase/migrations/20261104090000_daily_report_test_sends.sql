-- Log of "Send test report" requests: rate limiting (per project per hour) and an audit
-- trail of where each test email went. Written and read only by the send-daily-reports
-- edge function (service role). No API access: RLS on, no policies, no grants.

create table public.daily_report_test_sends (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  target text not null check (target in ('self', 'recipient')),
  recipient_id uuid,                       -- project_report_recipients.id when target = 'recipient'
  sent_to text,                            -- resolved server-side, never taken from the browser
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

create index daily_report_test_sends_project_created_idx
  on public.daily_report_test_sends(project_id, created_at);

alter table public.daily_report_test_sends enable row level security;
revoke all on public.daily_report_test_sends from anon, authenticated;
