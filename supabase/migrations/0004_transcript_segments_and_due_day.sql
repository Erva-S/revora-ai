-- ====================================================================
-- REVORA — 0004: structured transcript segments + spoken deadlines
--
-- Additive only. Does not touch RLS, existing columns, or the
-- meetings.status CHECK constraint (scheduled|pending|recording|
-- completed|summarized|failed still applies unchanged).
--
--   meetings.transcript_segments  jsonb  — the structured transcript the
--       webhook now produces: [{speaker, text, start_time, end_time}].
--       meetings.transcript keeps the plain "Speaker: text" rendering the
--       existing UI already reads, so nothing breaks.
--   meetings.processing_stage     text   — fine-grained pipeline stage for
--       display (bot_dispatched … completed / processing_failed). Kept
--       separate from `status` so the existing CHECK stays valid.
--   action_items.due_day          text   — the deadline exactly as spoken
--       ("Wednesday", "end of the month"). due_date stays a real date and
--       is only filled when the calendar date can be computed.
-- ====================================================================

alter table public.meetings
  add column if not exists transcript_segments jsonb not null default '[]'::jsonb;

alter table public.meetings
  add column if not exists processing_stage text;

alter table public.action_items
  add column if not exists due_day text;

comment on column public.meetings.transcript_segments is
  'Structured transcript turns from MeetingBaaS: [{speaker,text,start_time,end_time}]. Source of truth for speaker/timing.';
comment on column public.meetings.processing_stage is
  'Display-level pipeline stage: bot_dispatched, meeting_in_progress, meeting_ended, recording_retrieved, transcript_processing, transcript_ready, summary_processing, completed, processing_failed.';
comment on column public.action_items.due_day is
  'Deadline as spoken in the meeting (e.g. "Wednesday"). Preserved even when due_date cannot be resolved.';
