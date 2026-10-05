-- Keep received provider data separate from the mutable display transcript.
alter table public.meetings add column if not exists raw_transcription jsonb;
alter table public.meetings add column if not exists raw_diarization text;
alter table public.meetings add column if not exists transcript_source_metadata jsonb;

create table if not exists public.meeting_transcript_sources (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  content_hash text not null,
  provider text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique(meeting_id, content_hash)
);
alter table public.meeting_transcript_sources enable row level security;
revoke all on public.meeting_transcript_sources from public, anon, authenticated, service_role;
grant select, insert, delete on public.meeting_transcript_sources to service_role;

comment on table public.meeting_transcript_sources is
  'Append-only raw webhook/artifact snapshots; service-only debugging/reprocessing, deduplicated by content hash.';
comment on column public.meetings.raw_transcription is
  'Unmodified provider transcription (latest processed source); historical versions remain in meeting_transcript_sources.';
comment on column public.meetings.transcript_segments is
  'Deterministic display turns with word timing, source speaker IDs, source utterance indices and overlap/evidence metadata. Never rewritten by Gemini.';
