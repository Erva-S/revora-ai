-- ====================================================================
-- REVORA — meeting lifecycle timing and dispatch idempotency
--
-- Additive migration. Provider status remains the source of truth for the
-- call lifecycle; these columns make provider/application latency observable
-- without changing the existing meetings.status check constraint.
-- ====================================================================

alter table public.meetings
  add column if not exists provider_status text,
  add column if not exists provider_status_at timestamptz,
  add column if not exists bot_creation_requested_at timestamptz,
  add column if not exists bot_joining_started_at timestamptz,
  add column if not exists bot_joined_at timestamptz,
  add column if not exists last_human_left_at timestamptz,
  add column if not exists bot_leave_requested_at timestamptz,
  add column if not exists bot_departure_confirmed_at timestamptz,
  add column if not exists meeting_completed_at timestamptz;

create index if not exists meetings_provider_status_idx
  on public.meetings (provider_status);

-- A reservation is created before POST /v2/bots. This prevents a retried
-- browser request or two concurrent admin requests from creating two provider
-- bots for the same logical dispatch. It intentionally contains no provider
-- payload, recording URL, transcript, or credential.
create table if not exists public.meeting_bot_dispatches (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique,
  planned_meeting_id uuid references public.planned_meetings(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  owner_id uuid references auth.users(id) on delete set null,
  project_id uuid,
  meeting_url text not null,
  title text,
  platform text,
  bot_id text unique,
  meeting_id uuid references public.meetings(id) on delete set null,
  state text not null default 'creating'
    check (state in ('creating', 'created', 'unknown', 'failed')),
  planned_link text check (planned_link in ('linked', 'failed') or planned_link is null),
  error_message text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists meeting_bot_dispatches_planned_key
  on public.meeting_bot_dispatches (planned_meeting_id)
  where planned_meeting_id is not null;

create index if not exists meeting_bot_dispatches_state_idx
  on public.meeting_bot_dispatches (state, updated_at);

drop trigger if exists meeting_bot_dispatches_set_updated_at on public.meeting_bot_dispatches;
create trigger meeting_bot_dispatches_set_updated_at
  before update on public.meeting_bot_dispatches
  for each row execute procedure public.set_updated_at();

alter table public.meeting_bot_dispatches enable row level security;
revoke all on table public.meeting_bot_dispatches from anon, authenticated;
grant all on table public.meeting_bot_dispatches to service_role;

comment on table public.meeting_bot_dispatches is
  'Service-only dispatch reservations. Prevents duplicate MeetingBaaS bot creation and records ambiguous provider outcomes.';
comment on column public.meetings.last_human_left_at is
  'Provider-confirmed all-participants-left signal; historical participant lists are not used as an active count.';
