-- ====================================================================
-- REVORA — DYNAMIC CLIENT CREATION, AUTHENTICATION & DATA ISOLATION
-- Migration File: supabase/migrations/20261015010000_client_authentication.sql
-- ====================================================================

-- 1. Extend public.clients with contact email, contact person, company, and status
alter table public.clients
  add column if not exists email text,
  add column if not exists contact_name text,
  add column if not exists company text,
  add column if not exists status text not null default 'active';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_email_unique') then
    alter table public.clients add constraint clients_email_unique unique (email);
  end if;
exception
  when others then null;
end $$;

create index if not exists clients_email_idx on public.clients(lower(email));

-- 2. Extend public.profiles with client_id and allow 'client' role
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('user', 'admin', 'client'));

alter table public.profiles
  add column if not exists client_id uuid references public.clients(id) on delete set null;

create index if not exists idx_profiles_client_id on public.profiles(client_id);

-- Ensure profiles.username is nullable to support all auth signup methods
alter table public.profiles alter column username drop not null;

-- 3. Security Helper Functions
create or replace function public.get_auth_client_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select client_id from public.profiles where id = auth.uid() limit 1;
$$;

revoke all on function public.get_auth_client_id() from public;
grant execute on function public.get_auth_client_id() to authenticated, service_role;

create or replace function public.is_client(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = coalesce(uid, auth.uid()) and (role = 'client' or client_id is not null)
  );
$$;

revoke all on function public.is_client(uuid) from public;
grant execute on function public.is_client(uuid) to authenticated, service_role;

-- 4. Dynamic Client Provisioning Stored Procedure (Admin Only)
create or replace function public.admin_provision_client(
  p_client_name text,
  p_contact_email text,
  p_contact_name text default null,
  p_password text default null,
  p_company text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_client_id uuid;
  v_user_id uuid;
  v_encrypted_pw text;
  v_clean_email text := lower(trim(p_contact_email));
  v_clean_name text := trim(p_client_name);
  v_contact text := coalesce(nullif(trim(p_contact_name), ''), split_part(v_clean_email, '@', 1));
  v_now timestamptz := timezone('utc', now());
  v_default_pw text := 'RevoraClient2026!';
  v_raw_pw text;
  v_base_username text;
  v_username text;
begin
  -- Enforce admin only
  if not public.is_admin() and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'Unauthorized: Only administrators can create or provision clients.';
  end if;

  if v_clean_name is null or v_clean_name = '' then
    raise exception 'Client name is required.';
  end if;

  if v_clean_email is null or v_clean_email = '' then
    raise exception 'Client contact email is required.';
  end if;

  v_base_username := substring(regexp_replace(split_part(v_clean_email, '@', 1), '[^a-zA-Z0-9_.-]', '', 'g') from 1 for 20);
  if length(v_base_username) < 3 then
    v_base_username := v_base_username || 'usr';
  end if;
  v_username := v_base_username;
  while exists (select 1 from public.profiles where lower(username) = lower(v_username)) loop
    v_username := substring(v_base_username from 1 for 15) || '_' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 4);
  end loop;

  -- 1. Create or update client record in public.clients
  select id into v_client_id from public.clients
   where lower(name) = lower(v_clean_name) or lower(email) = v_clean_email
   limit 1;

  if v_client_id is null then
    insert into public.clients (name, email, contact_name, company, created_by, created_at, updated_at)
    values (v_clean_name, v_clean_email, v_contact, coalesce(p_company, v_clean_name), auth.uid(), v_now, v_now)
    returning id into v_client_id;
  else
    update public.clients
    set name = v_clean_name,
        email = v_clean_email,
        contact_name = v_contact,
        company = coalesce(p_company, company, v_clean_name),
        updated_at = v_now
    where id = v_client_id;
  end if;

  -- 2. Check if auth user exists in auth.users
  select id into v_user_id from auth.users where lower(email) = v_clean_email limit 1;

  v_raw_pw := coalesce(nullif(trim(p_password), ''), v_default_pw);
  v_encrypted_pw := extensions.crypt(v_raw_pw, extensions.gen_salt('bf', 10));

  if v_user_id is null then
    -- Provision new auth.users account
    v_user_id := gen_random_uuid();
    insert into auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      aud,
      role,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change_token_current,
      email_change,
      phone_change,
      phone_change_token,
      reauthentication_token,
      created_at,
      updated_at
    ) values (
      v_user_id,
      '00000000-0000-0000-0000-000000000000'::uuid,
      v_clean_email,
      v_encrypted_pw,
      v_now,
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_contact, 'name', v_contact, 'client_id', v_client_id),
      'authenticated',
      'authenticated',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      v_now,
      v_now
    );

    -- Provision identity row for Supabase GoTrue email signin
    insert into auth.identities (
      id,
      provider_id,
      user_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) values (
      v_user_id,
      v_user_id::text,
      v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', v_clean_email, 'full_name', v_contact, 'email_verified', true),
      'email',
      v_now,
      v_now,
      v_now
    );
  else
    -- Existing auth user: update password, confirmed status, and empty string tokens
    update auth.users
    set encrypted_password = v_encrypted_pw,
        email_confirmed_at = coalesce(email_confirmed_at, v_now),
        raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('client_id', v_client_id),
        confirmation_token = coalesce(confirmation_token, ''),
        recovery_token = coalesce(recovery_token, ''),
        email_change_token_new = coalesce(email_change_token_new, ''),
        email_change_token_current = coalesce(email_change_token_current, ''),
        email_change = coalesce(email_change, ''),
        phone_change = coalesce(phone_change, ''),
        phone_change_token = coalesce(phone_change_token, ''),
        reauthentication_token = coalesce(reauthentication_token, ''),
        updated_at = v_now
    where id = v_user_id;

    -- Ensure identity row exists
    if not exists (select 1 from auth.identities where user_id = v_user_id and provider = 'email') then
      insert into auth.identities (
        id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) values (
        v_user_id, v_user_id::text, v_user_id, jsonb_build_object('sub', v_user_id::text, 'email', v_clean_email, 'full_name', v_contact, 'email_verified', true),
        'email', v_now, v_now, v_now
      );
    end if;
  end if;

  -- 3. Link profile to client and role 'client'
  insert into public.profiles (id, email, full_name, username, client_id, role, updated_at)
  values (v_user_id, v_clean_email, v_contact, v_username, v_client_id, 'client', v_now)
  on conflict (id) do update set
    client_id = v_client_id,
    role = case when public.profiles.role = 'admin' and lower(trim(public.profiles.email)) = 'evv18407@gmail.com' then 'admin' else 'client' end,
    full_name = coalesce(v_contact, public.profiles.full_name),
    updated_at = v_now;

  return jsonb_build_object(
    'success', true,
    'client_id', v_client_id,
    'user_id', v_user_id,
    'name', v_clean_name,
    'email', v_clean_email,
    'contact_name', v_contact
  );
end;
$$;

revoke all on function public.admin_provision_client(text, text, text, text, text) from public;
grant execute on function public.admin_provision_client(text, text, text, text, text) to authenticated, service_role;

-- 5. Stored Procedure to List Clients with Linked Data Counts (Admin Only)
create or replace function public.admin_list_clients()
returns table (
  id uuid,
  name text,
  email text,
  contact_name text,
  company text,
  status text,
  created_at timestamptz,
  project_count bigint,
  meeting_count bigint,
  user_email text,
  user_full_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select 
    c.id,
    c.name,
    c.email,
    c.contact_name,
    c.company,
    c.status,
    c.created_at,
    (select count(*) from public.projects p where p.client_id = c.id) as project_count,
    (select count(*) from public.meetings m 
     join public.projects p on p.id = m.project_id 
     where p.client_id = c.id) as meeting_count,
    u.email as user_email,
    u.full_name as user_full_name
  from public.clients c
  left join public.profiles u on u.client_id = c.id
  order by c.created_at desc;
$$;

revoke all on function public.admin_list_clients() from public;
grant execute on function public.admin_list_clients() to authenticated, service_role;

-- 6. Trigger to automatically link client accounts upon signup (OAuth or Email)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  designated_admin text := 'evv18407@gmail.com';
  assigned_role text := 'user';
  found_client_id uuid;
  assigned_name text;
  base_username text;
  gen_username text;
begin
  -- 1. Check if designated admin
  if lower(trim(new.email)) = lower(designated_admin) then
    assigned_role := 'admin';
  else
    -- 2. Check if email matches a registered client
    select id, contact_name into found_client_id, assigned_name
    from public.clients
    where lower(trim(email)) = lower(trim(new.email))
    limit 1;

    if found_client_id is not null then
      assigned_role := 'client';
    elsif (new.raw_user_meta_data->>'client_id') is not null then
      found_client_id := (new.raw_user_meta_data->>'client_id')::uuid;
      assigned_role := 'client';
    end if;
  end if;

  assigned_name := coalesce(
    assigned_name,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1)
  );

  base_username := substring(regexp_replace(split_part(new.email, '@', 1), '[^a-zA-Z0-9_.-]', '', 'g') from 1 for 20);
  if length(base_username) < 3 then
    base_username := base_username || 'usr';
  end if;
  gen_username := base_username;
  while exists (select 1 from public.profiles where lower(username) = lower(gen_username) and id <> new.id) loop
    gen_username := substring(base_username from 1 for 15) || '_' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 4);
  end loop;

  insert into public.profiles (id, email, full_name, username, avatar_url, role, client_id)
  values (
    new.id,
    new.email,
    assigned_name,
    gen_username,
    new.raw_user_meta_data->>'avatar_url',
    assigned_role,
    found_client_id
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    client_id = coalesce(excluded.client_id, public.profiles.client_id),
    role = case
      when lower(trim(excluded.email)) = lower(designated_admin) then 'admin'
      when excluded.client_id is not null then 'client'
      else public.profiles.role
    end,
    updated_at = timezone('utc'::text, now());

  return new;
end;
$$;

-- 7. Row Level Security Policies for Data Isolation
alter table public.clients enable row level security;
alter table public.projects enable row level security;
alter table public.meetings enable row level security;
alter table public.transcripts enable row level security;
alter table public.summaries enable row level security;
alter table public.action_items enable row level security;

-- Client Policies
alter policy "clients_select_policy" on public.clients 
  using (public.is_admin() or id = public.get_auth_client_id());
alter policy "clients_insert_policy" on public.clients 
  with check (public.is_admin());
alter policy "clients_update_policy" on public.clients 
  using (public.is_admin()) with check (public.is_admin());

-- Project Policies
alter policy "projects_select_policy" on public.projects 
  using (public.is_admin() or client_id = public.get_auth_client_id() or created_by = auth.uid());
alter policy "projects_insert_policy" on public.projects 
  with check (public.is_admin() or client_id = public.get_auth_client_id());
alter policy "projects_update_policy" on public.projects 
  using (public.is_admin() or client_id = public.get_auth_client_id()) 
  with check (public.is_admin() or client_id = public.get_auth_client_id());

-- Meeting Policies
alter policy "Users can view own meetings" on public.meetings using (
  public.is_admin() 
  or user_id = auth.uid() 
  or (
    project_id is not null 
    and public.get_auth_client_id() is not null 
    and project_id in (select id from public.projects where client_id = public.get_auth_client_id())
  )
);

alter policy "Users can update own meetings" on public.meetings using (
  public.is_admin() 
  or user_id = auth.uid() 
  or (
    project_id is not null 
    and public.get_auth_client_id() is not null 
    and project_id in (select id from public.projects where client_id = public.get_auth_client_id())
  )
);

alter policy "Users can delete own meetings" on public.meetings using (
  public.is_admin() or user_id = auth.uid()
);
