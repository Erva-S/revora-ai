-- ====================================================================
-- REVORA — ADMIN-CONTROLLED BOT DEPLOYMENT: AUTHORIZATION HARDENING
-- Migration File: supabase/migrations/20260902000000_admin_bot_authorization.sql
--
-- Why this file is timestamped (and not "0005_..."):
--   Migrations apply in lexical order, so 20260608000000_init_schema.sql runs
--   AFTER 0002/0003/0004 and re-creates the permissive meetings policies. A
--   "0005_" prefix would be overwritten by it. This file must sort last.
--
-- What changes:
--   * meetings / transcripts / summaries / action_items policies no longer
--     treat `user_id is null` as "everybody's row", and no longer apply to the
--     `anon` role. Reading is scoped to the assigned user; creating, updating
--     and deleting a meeting is admin-only.
--   * profiles gains an admin DELETE policy (the admin directory's delete
--     button silently affected 0 rows before) and a trigger that stops a
--     normal user from promoting themselves to admin through the
--     "Users can update own profile" policy.
--
-- What is deliberately NOT changed:
--   * RLS stays enabled on every table.
--   * The meetingbaas-webhook Edge Function writes with the service-role key,
--     which bypasses RLS, so the recording/transcript/summary/action-item
--     pipeline is unaffected by anything below.
--   * `public.is_admin()` and `public.handle_new_user()` are reused as-is.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. profiles: only admins may change a role
--
-- "Users can update own profile" is `using (auth.uid() = id)` with no column
-- restriction, which let a normal user set their own role to 'admin'. Column
-- privileges can't express "admins may, users may not" (they apply to the
-- whole `authenticated` role), so this is enforced with a trigger that calls
-- the existing is_admin() helper.
-- --------------------------------------------------------------------
create or replace function public.guard_profile_role_change()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role then
    -- Server-side contexts (migrations, the auth trigger, Edge Functions using
    -- the service-role key) are trusted; end-user sessions must be admins.
    if current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role') then
      return new;
    end if;

    if not public.is_admin(auth.uid()) then
      raise exception 'Only administrators can change a profile role';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_role_change on public.profiles;
create trigger profiles_guard_role_change
  before update on public.profiles
  for each row execute procedure public.guard_profile_role_change();

-- Admins can remove a profile (never their own row).
drop policy if exists "Admins can delete profiles" on public.profiles;
create policy "Admins can delete profiles"
  on public.profiles for delete
  to authenticated
  using ( public.is_admin() and id <> auth.uid() );

-- --------------------------------------------------------------------
-- 2. meetings: read = assigned user or admin, write = admin only
--
-- `meetings.user_id` is the existing ownership column and keeps its meaning:
-- "the user permitted to see this meeting". The deploy-bot function sets it to
-- the verified admin caller, or to the profile the admin picked in the
-- deployer ("Give Access To").
-- --------------------------------------------------------------------
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

-- Scheduling a meeting / deploying a bot is an admin capability. (The Edge
-- Function inserts with the service-role key and bypasses RLS; this policy
-- covers anyone reaching the table through the REST API directly.)
drop policy if exists "Users can insert own meetings" on public.meetings;
drop policy if exists "Admins can insert meetings" on public.meetings;
create policy "Admins can insert meetings"
  on public.meetings for insert
  to authenticated
  with check ( public.is_admin() );

drop policy if exists "Users can update own meetings" on public.meetings;
drop policy if exists "Admins can update meetings" on public.meetings;
create policy "Admins can update meetings"
  on public.meetings for update
  to authenticated
  using ( public.is_admin() )
  with check ( public.is_admin() );

drop policy if exists "Users can delete own meetings" on public.meetings;
drop policy if exists "Admins can delete meetings" on public.meetings;
create policy "Admins can delete meetings"
  on public.meetings for delete
  to authenticated
  using ( public.is_admin() );

-- --------------------------------------------------------------------
-- 3. transcripts / summaries / action_items: inherit the meeting's access
--
-- Same shape as before, minus the `or m.user_id is null` escape hatch and the
-- `anon` role. Writes are admin-only; the webhook keeps using service_role.
-- --------------------------------------------------------------------
drop policy if exists "Users can access meeting transcripts" on public.transcripts;
drop policy if exists "Users can view permitted transcripts" on public.transcripts;
create policy "Users can view permitted transcripts"
  on public.transcripts for select
  to authenticated
  using (
    exists (
      select 1 from public.meetings m
      where m.id = transcripts.meeting_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "Admins can manage transcripts" on public.transcripts;
create policy "Admins can manage transcripts"
  on public.transcripts for all
  to authenticated
  using ( public.is_admin() )
  with check ( public.is_admin() );

drop policy if exists "Users can access meeting summaries" on public.summaries;
drop policy if exists "Users can view permitted summaries" on public.summaries;
create policy "Users can view permitted summaries"
  on public.summaries for select
  to authenticated
  using (
    exists (
      select 1 from public.meetings m
      where m.id = summaries.meeting_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "Admins can manage summaries" on public.summaries;
create policy "Admins can manage summaries"
  on public.summaries for all
  to authenticated
  using ( public.is_admin() )
  with check ( public.is_admin() );

drop policy if exists "Users can access meeting action items" on public.action_items;
drop policy if exists "Users can view permitted action items" on public.action_items;
create policy "Users can view permitted action items"
  on public.action_items for select
  to authenticated
  using (
    exists (
      select 1 from public.meetings m
      where m.id = action_items.meeting_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "Admins can manage action items" on public.action_items;
create policy "Admins can manage action items"
  on public.action_items for all
  to authenticated
  using ( public.is_admin() )
  with check ( public.is_admin() );

-- --------------------------------------------------------------------
-- 4. Remove the unauthenticated write grants
--
-- Earlier migrations granted insert/update/delete on every table to `anon`.
-- No policy targets `anon` any more so RLS already denies those statements;
-- revoking the privilege as well means a missing policy can never re-open it.
-- `anon` keeps SELECT (it resolves to zero rows) so nothing in the public
-- landing page changes. `authenticated` and `service_role` are untouched.
-- --------------------------------------------------------------------
revoke insert, update, delete on table public.profiles     from anon;
revoke insert, update, delete on table public.meetings     from anon;
revoke insert, update, delete on table public.transcripts  from anon;
revoke insert, update, delete on table public.summaries    from anon;
revoke insert, update, delete on table public.action_items from anon;

-- --------------------------------------------------------------------
-- 5. Sanity check: RLS must still be on everywhere.
-- --------------------------------------------------------------------
do $$
declare
  unprotected text;
begin
  select string_agg(c.relname, ', ')
    into unprotected
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('profiles', 'meetings', 'transcripts', 'summaries', 'action_items')
    and c.relrowsecurity is false;

  if unprotected is not null then
    raise exception 'Row Level Security is disabled on: %', unprotected;
  end if;
end $$;
