-- ====================================================================
-- REVORA — MIGRATION 0003: meeting-assistant columns (v2 pipeline)
-- Run this in your Supabase SQL Editor (safe to re-run; idempotent).
--
-- Additive only. Does NOT replace public.meetings, drop data, or touch
-- RLS. It reconciles the two earlier meetings definitions (0002_meetings
-- vs 20260608000000_init_schema) so every column the upgraded
-- meetingbaas-webhook writes is guaranteed to exist, and adds the one
-- genuinely new column the v2 recording pipeline needs: recording_url.
-- ====================================================================


-- --------------------------------------------------------------------
-- 1. New column for the v2 pipeline
--
-- MeetingBaaS v2 `bot.completed` returns a signed recording URL (video,
-- falling back to audio). The webhook now stores it so the dashboard can
-- link to the recording. Neither earlier migration defined this column.
-- --------------------------------------------------------------------
alter table public.meetings add column if not exists recording_url text;


-- --------------------------------------------------------------------
-- 2. Reconcile columns the pipeline writes
--
-- The two earlier migrations disagree on the meetings shape:
--   * 0002_meetings.sql        (runs first; `create table if not exists`)
--                              has NO platform / started_at / ended_at.
--   * 20260608..._init_schema  has them, but its `create table if not
--                              exists` is then a no-op, so it never adds
--                              them to a table 0002 already created.
-- deploy-bot inserts `platform` + `started_at`; the webhook writes
-- `ended_at`. So add every column the pipeline touches defensively.
-- `if not exists` makes each a no-op when present — no existing column,
-- default, or data is altered, and a newly-added column is NULL on
-- existing rows (which the CHECK below permits).
-- --------------------------------------------------------------------
alter table public.meetings add column if not exists transcript    text;
alter table public.meetings add column if not exists summary       text;
alter table public.meetings add column if not exists action_items  jsonb not null default '[]'::jsonb;
alter table public.meetings add column if not exists duration_secs integer;
alter table public.meetings add column if not exists error_message text;
alter table public.meetings add column if not exists raw_payload   jsonb;
alter table public.meetings add column if not exists ended_at      timestamptz;
alter table public.meetings add column if not exists started_at    timestamptz;
alter table public.meetings add column if not exists platform      text
  check (platform in ('google_meet', 'zoom', 'teams', 'video_call'));


-- --------------------------------------------------------------------
-- 3. Notes (no action)
--
-- * RLS is intentionally left unchanged. The existing SELECT policy
--     using ( auth.uid() = user_id or user_id is null )
--   plus the is_admin() override already scopes meetings per user, and
--   deploy-bot stamps user_id from the verified JWT — so assistant rows
--   are always owned by their creator. (To enforce STRICT isolation you
--   could drop the "or user_id is null" clause, but that is a separate,
--   deliberate policy change and is not made here.)
--
-- * The status CHECK constraint already permits
--     'pending','recording','completed','summarized','failed'
--   which is exactly the vocabulary the v2 webhook maps onto — so no
--   constraint change is required.
-- --------------------------------------------------------------------
