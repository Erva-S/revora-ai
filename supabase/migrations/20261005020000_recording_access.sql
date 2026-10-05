-- Reuse meetings.bot_id as the stable MeetingBaaS video identifier. No duplicate
-- recording table or permanent dependence on four-hour presigned URLs.
alter table public.meetings add column if not exists recording_status text
  check (recording_status in ('pending','recording','processing','ready','unavailable','expired','failed'));
alter table public.meetings add column if not exists recording_metadata jsonb not null default '{}'::jsonb;
comment on column public.meetings.recording_url is 'Cached temporary artifact URL; refresh via MeetingBaaS bot_id for every access.';
comment on column public.meetings.recording_metadata is 'Stable video artifact metadata; observed_ready_at is observation time, not provider generation time.';

-- Older deployments publicly expose ownerless recordings through meetings.*.
-- Keep authenticated owner/admin access, including admins managing legacy rows.
-- A restrictive policy intersects all existing permissive policies, including
-- old user_id-is-null policies. It does not widen existing access.
alter table public.meetings enable row level security;
drop policy if exists "Recording meeting isolation" on public.meetings;
create policy "Recording meeting isolation" on public.meetings as restrictive
  for select to anon, authenticated using (
    auth.uid() is not null and (user_id = auth.uid() or public.is_admin())
  );
