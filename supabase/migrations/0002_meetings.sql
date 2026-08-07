-- ====================================================================
-- REVORA — MIGRATION 0002: meetings table + RLS hardening
-- Run this in your Supabase SQL Editor (safe to re-run; idempotent).
-- ====================================================================


-- --------------------------------------------------------------------
-- 0. Ensure public.profiles table exists
-- --------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text,
  avatar_url text,
  role text default 'user' check (role in ('user', 'admin')),
  updated_at timestamp with time zone default timezone('utc'::text, now()),
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table public.profiles enable row level security;

-- --------------------------------------------------------------------
-- 1. FIX: infinite recursion in existing profiles admin policies
--
-- The policies created in schema.sql check admin status with a
-- subquery against public.profiles ITSELF. Because that subquery is
-- also subject to RLS, Postgres re-evaluates the same policy forever
-- and throws:
--     42P17: infinite recursion detected in policy for relation "profiles"
--
-- The fix is a SECURITY DEFINER helper that reads profiles with RLS
-- bypassed. We reuse it for the meetings policies below.
-- --------------------------------------------------------------------
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

-- Recreate the recursive profiles policies using the safe helper
drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Admins can view all profiles"
  on public.profiles for select
  to authenticated
  using ( public.is_admin() );

drop policy if exists "Admins can update all profiles" on public.profiles;
create policy "Admins can update all profiles"
  on public.profiles for update
  to authenticated
  using ( public.is_admin() );


-- --------------------------------------------------------------------
-- 1. meetings table
--
-- Row lifecycle:
--   deploy-bot          -> inserts row  (status 'pending', user_id set)
--   meetingbaas-webhook -> updates row by bot_id (status 'summarized')
--
-- user_id is captured at deploy time because the MeetingBaaS webhook
-- payload contains no notion of our users — bot_id is the only join key.
-- --------------------------------------------------------------------
create table if not exists public.meetings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users on delete cascade,
  bot_id        text not null,
  meeting_url   text,
  title         text,
  status        text not null default 'pending'
                check (status in ('pending','recording','completed','summarized','failed')),
  summary       text,
  action_items  jsonb not null default '[]'::jsonb,
  transcript    text,
  duration_secs integer,
  error_message text,
  raw_payload   jsonb,
  created_at    timestamptz not null default timezone('utc'::text, now()),
  updated_at    timestamptz not null default timezone('utc'::text, now())
);

-- bot_id is the join key the webhook matches on, so it must be unique.
-- This also lets the webhook use ON CONFLICT (upsert) safely.
create unique index if not exists meetings_bot_id_key on public.meetings (bot_id);
create index if not exists meetings_user_id_idx    on public.meetings (user_id);
create index if not exists meetings_created_at_idx on public.meetings (created_at desc);
create index if not exists meetings_status_idx     on public.meetings (status);


-- --------------------------------------------------------------------
-- 2. keep updated_at fresh
-- --------------------------------------------------------------------
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


-- --------------------------------------------------------------------
-- 3. Row Level Security
--
-- Writes are intentionally NOT granted to end users. Both Edge
-- Functions use the service_role key, which bypasses RLS entirely —
-- so no INSERT/UPDATE policy is needed for them. This prevents a
-- browser client from forging or editing meeting records.
-- --------------------------------------------------------------------
alter table public.meetings enable row level security;

drop policy if exists "Users can view own meetings" on public.meetings;
create policy "Users can view own meetings"
  on public.meetings for select
  to authenticated
  using ( auth.uid() = user_id );

drop policy if exists "Admins can view all meetings" on public.meetings;
create policy "Admins can view all meetings"
  on public.meetings for select
  to authenticated
  using ( public.is_admin() );

drop policy if exists "Users can delete own meetings" on public.meetings;
create policy "Users can delete own meetings"
  on public.meetings for delete
  to authenticated
  using ( auth.uid() = user_id );


-- --------------------------------------------------------------------
-- 4. Realtime (lets the dashboard live-update when the webhook lands)
-- --------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.meetings;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;


-- --------------------------------------------------------------------
-- 5. Rebrand fix: signup trigger still hardcoded the old assist.ai
--    admin address, while the frontend checks admin@revora.ai.
-- --------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url',
    case when lower(new.email) = 'admin@revora.ai' then 'admin' else 'user' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
