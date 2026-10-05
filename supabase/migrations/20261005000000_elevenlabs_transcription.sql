-- Durable async ElevenLabs jobs. Apply after the existing meeting migrations.
create table if not exists public.meeting_transcription_jobs (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null unique references public.meetings(id) on delete cascade,
  provider text not null default 'elevenlabs' check (provider = 'elevenlabs'),
  model text not null,
  status text not null default 'submitting'
    check (status in ('submitting','submission_unknown','queued','ready','processing','completed','failed')),
  request_id text,
  input_payload jsonb not null,
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.meeting_transcription_jobs enable row level security;
revoke all on public.meeting_transcription_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.meeting_transcription_jobs to service_role;

comment on table public.meeting_transcription_jobs is
  'Service-only ElevenLabs async jobs; retains verified results for processing retries without retranscribing audio.';
comment on column public.meetings.transcription_provider is
  'Actual STT provider for this recording, including direct ElevenLabs batch transcription.';
