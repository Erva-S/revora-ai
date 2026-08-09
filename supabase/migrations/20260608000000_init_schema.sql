-- ====================================================================
-- REVORA AI MEETING ASSISTANT — CORE DATABASE SCHEMA MIGRATION
-- Migration File: supabase/migrations/20260608000000_init_schema.sql
-- ====================================================================

-- 1. Profiles Table (Linked to auth.users)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text,
  avatar_url text,
  role text default 'user' check (role in ('user', 'admin')),
  updated_at timestamptz default timezone('utc'::text, now()),
  created_at timestamptz default timezone('utc'::text, now())
);

-- 2. Meetings Table
create table if not exists public.meetings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users on delete cascade,
  title         text,
  meeting_url   text,
  platform      text check (platform in ('google_meet', 'zoom', 'teams', 'video_call')),
  status        text not null default 'scheduled'
                check (status in ('scheduled', 'pending', 'recording', 'completed', 'summarized', 'failed')),
  bot_id        text,
  started_at    timestamptz,
  ended_at      timestamptz,
  summary       text,
  action_items  jsonb not null default '[]'::jsonb,
  transcript    text,
  duration_secs integer,
  error_message text,
  raw_payload   jsonb,
  created_at    timestamptz not null default timezone('utc'::text, now()),
  updated_at    timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists meetings_bot_id_key on public.meetings (bot_id) where bot_id is not null;
create index if not exists meetings_user_id_idx on public.meetings (user_id);
create index if not exists meetings_created_at_idx on public.meetings (created_at desc);
create index if not exists meetings_status_idx on public.meetings (status);

-- 3. Transcripts Table
create table if not exists public.transcripts (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  speaker    text,
  text       text not null,
  timestamp  timestamptz default timezone('utc'::text, now()),
  created_at timestamptz default timezone('utc'::text, now())
);

create index if not exists transcripts_meeting_id_idx on public.transcripts (meeting_id);

-- 4. Summaries Table
create table if not exists public.summaries (
  id                uuid primary key default gen_random_uuid(),
  meeting_id        uuid not null references public.meetings(id) on delete cascade,
  executive_summary text not null,
  key_decisions     jsonb default '[]'::jsonb,
  sentiment         text check (sentiment in ('positive', 'neutral', 'negative', 'mixed')),
  created_at        timestamptz default timezone('utc'::text, now())
);

create index if not exists summaries_meeting_id_idx on public.summaries (meeting_id);

-- 5. Action Items Table
create table if not exists public.action_items (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  task       text not null,
  assignee   text,
  due_date   date,
  status     text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  created_at timestamptz default timezone('utc'::text, now())
);

create index if not exists action_items_meeting_id_idx on public.action_items (meeting_id);
create index if not exists action_items_status_idx on public.action_items (status);

-- 6. Triggers for updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists meetings_set_updated_at on public.meetings;
create trigger meetings_set_updated_at
  before update on public.meetings
  for each row execute procedure public.set_updated_at();

-- 7. Grant Table Permissions to API Roles
grant select, insert, update, delete on table public.profiles to authenticated, anon, service_role;
grant select, insert, update, delete on table public.meetings to authenticated, anon, service_role;
grant select, insert, update, delete on table public.transcripts to authenticated, anon, service_role;
grant select, insert, update, delete on table public.summaries to authenticated, anon, service_role;
grant select, insert, update, delete on table public.action_items to authenticated, anon, service_role;

-- 8. Row Level Security (RLS) Configuration
alter table public.profiles enable row level security;
alter table public.meetings enable row level security;
alter table public.transcripts enable row level security;
alter table public.summaries enable row level security;
alter table public.action_items enable row level security;

-- Helper function: is_admin (security definer)
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and role = 'admin'
  );
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated, service_role;

-- RLS Policies: Profiles
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile" on public.profiles for select using ( auth.uid() = id );

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update using ( auth.uid() = id );

-- RLS Policies: Meetings
drop policy if exists "Users can view own meetings" on public.meetings;
create policy "Users can view own meetings" on public.meetings for select to authenticated, anon using ( auth.uid() = user_id or user_id is null );

drop policy if exists "Users can insert own meetings" on public.meetings;
create policy "Users can insert own meetings" on public.meetings for insert to authenticated, anon with check ( true );

drop policy if exists "Users can update own meetings" on public.meetings;
create policy "Users can update own meetings" on public.meetings for update to authenticated, anon using ( auth.uid() = user_id or user_id is null );

drop policy if exists "Users can delete own meetings" on public.meetings;
create policy "Users can delete own meetings" on public.meetings for delete to authenticated, anon using ( auth.uid() = user_id or user_id is null );

-- RLS Policies: Transcripts
drop policy if exists "Users can access meeting transcripts" on public.transcripts;
create policy "Users can access meeting transcripts" on public.transcripts for all to authenticated, anon using (
  exists (
    select 1 from public.meetings m
    where m.id = transcripts.meeting_id and (m.user_id = auth.uid() or m.user_id is null)
  )
);

-- RLS Policies: Summaries
drop policy if exists "Users can access meeting summaries" on public.summaries;
create policy "Users can access meeting summaries" on public.summaries for all to authenticated, anon using (
  exists (
    select 1 from public.meetings m
    where m.id = summaries.meeting_id and (m.user_id = auth.uid() or m.user_id is null)
  )
);

-- RLS Policies: Action Items
drop policy if exists "Users can access meeting action items" on public.action_items;
create policy "Users can access meeting action items" on public.action_items for all to authenticated, anon using (
  exists (
    select 1 from public.meetings m
    where m.id = action_items.meeting_id and (m.user_id = auth.uid() or m.user_id is null)
  )
);

-- 9. Realtime Publication Enablement
do $$
begin
  alter publication supabase_realtime add table public.meetings;
  alter publication supabase_realtime add table public.transcripts;
  alter publication supabase_realtime add table public.summaries;
  alter publication supabase_realtime add table public.action_items;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
