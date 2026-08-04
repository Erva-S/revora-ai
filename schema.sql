-- ====================================================================
-- SUPABASE POSTGRES SCHEMA FOR ASSIST (futurrizon-meeting-assistant)
-- Run this script directly in your Supabase SQL Editor
-- ====================================================================

-- 1. Create Profiles table linked to Supabase auth.users
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text,
  avatar_url text,
  role text default 'user' check (role in ('user', 'admin')),
  updated_at timestamp with time zone default timezone('utc'::text, now()),
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- 2. Enable Row Level Security (RLS)
alter table public.profiles enable row level security;

-- 3. RLS Policy: Users can view their own profile
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  using ( auth.uid() = id );

-- 4. RLS Policy: Users can update their own profile
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using ( auth.uid() = id );

-- 5. RLS Policy: Admins can view all profiles
drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Admins can view all profiles"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- 6. RLS Policy: Admins can update all profiles
drop policy if exists "Admins can update all profiles" on public.profiles;
create policy "Admins can update all profiles"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- 7. Trigger to auto-create profile on user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    case when new.email = 'admin@assist.ai' then 'admin' else 'user' end
  );
  return new;
end;
$$ language plpgsql security definer;

-- Drop trigger if exists and recreate
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
