-- ====================================================================
-- REVORA — PRODUCTION ROLE-BASED AUTHENTICATION & ADMIN PROVISIONING
-- Migration File: supabase/migrations/20261015000000_production_auth_roles.sql
-- ====================================================================

-- 1. Update the signup trigger to assign 'admin' only to the designated admin account
--    (evv18407@gmail.com) and assign 'user' to all other accounts by default.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  designated_admin text := 'evv18407@gmail.com';
  assigned_role text;
begin
  if lower(trim(new.email)) = lower(designated_admin) then
    assigned_role := 'admin';
  else
    assigned_role := 'user';
  end if;

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
    assigned_role
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    updated_at = timezone('utc'::text, now());
    -- Note: role is deliberately NOT updated on conflict so users cannot elevate their own role.

  return new;
end;
$$;

-- Ensure the trigger is attached to auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. Demote all existing accounts in profiles to standard 'user'
update public.profiles
set role = 'user', updated_at = timezone('utc'::text, now())
where lower(trim(email)) <> 'evv18407@gmail.com';

-- 3. Provision the designated admin account as the ONLY admin in profiles
update public.profiles
set role = 'admin', updated_at = timezone('utc'::text, now())
where lower(trim(email)) = 'evv18407@gmail.com';

-- 4. Secure procedure for existing administrators to promote or demote users
create or replace function public.set_user_role(target_email text, new_role text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Enforce that only authenticated admins or service_role can execute this
  if current_user not in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role') then
    if not public.is_admin(auth.uid()) then
      raise exception 'Only administrators can change user roles.';
    end if;
  end if;

  if new_role not in ('user', 'admin') then
    raise exception 'Invalid role: must be either user or admin.';
  end if;

  update public.profiles
  set role = new_role, updated_at = timezone('utc'::text, now())
  where lower(trim(email)) = lower(trim(target_email));

  if not found then
    raise exception 'No profile found for email: %', target_email;
  end if;

  return true;
end;
$$;

revoke all on function public.set_user_role(text, text) from public;
grant execute on function public.set_user_role(text, text) to authenticated, service_role;
