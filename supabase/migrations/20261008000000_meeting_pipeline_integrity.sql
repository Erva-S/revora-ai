-- Apply only after verifying hosted migration history. No historical migration is replayed.
alter table public.transcripts add column if not exists turn_index int;
alter table public.transcripts add column if not exists start_seconds numeric;
alter table public.transcripts add column if not exists end_seconds numeric;
create unique index if not exists transcripts_meeting_turn_key
  on public.transcripts(meeting_id,turn_index) where turn_index is not null;

-- A lease serializes provider completion, recovery, and admin reprocessing.
alter table public.meetings add column if not exists transcript_processing_token uuid;
alter table public.meetings add column if not exists transcript_processing_at timestamptz;

-- Archive previously browser-readable raw data before clearing those caches.
insert into public.meeting_transcript_sources(meeting_id,content_hash,provider,payload)
select id, 'legacy-' || md5(jsonb_build_object('provider_transcription',raw_transcription,
  'diarization_artifact',raw_diarization,'webhook_payload',raw_payload)::text), transcription_provider,
  jsonb_build_object('provider_transcription',raw_transcription,'diarization_artifact',raw_diarization,
    'webhook_payload',raw_payload,'standardized_transcription',raw_payload->'data'->'transcription')
from public.meetings where raw_transcription is not null or raw_diarization is not null
  or (raw_payload is not null and raw_payload->>'archive_version' is distinct from '1')
on conflict(meeting_id,content_hash) do nothing;
update public.meetings set raw_transcription=null, raw_diarization=null,
  raw_payload=case when raw_payload is null then null else jsonb_build_object('archive_version',1,
    'event',raw_payload->'event','data',jsonb_build_object('bot_id',bot_id,'status',
      jsonb_build_object('code',raw_payload->'data'->'status'->'code',
        'created_at',raw_payload->'data'->'status'->'created_at'))) end
where raw_transcription is not null or raw_diarization is not null
  or (raw_payload is not null and raw_payload->>'archive_version' is distinct from '1');

create or replace function public.claim_meeting_transcript(p_meeting_id uuid,p_bot_id text,p_token uuid,p_reprocess boolean default false)
returns text language plpgsql security definer set search_path=public as $$
declare m public.meetings;
begin
  select * into m from public.meetings where id=p_meeting_id and bot_id=p_bot_id for update;
  if not found then raise exception 'Meeting/bot mismatch'; end if;
  if m.transcript_processing_token is not null and m.transcript_processing_at > now()-interval '10 minutes' then return 'processing'; end if;
  if not p_reprocess and (m.status='summarized' or (m.status='completed' and m.processing_stage='completed')) then return 'completed'; end if;
  update public.meetings set transcript_processing_token=p_token,transcript_processing_at=now() where id=m.id;
  return 'claimed';
end $$;

-- All three transcript representations commit together, derived from ONE turns array.
create or replace function public.persist_meeting_transcript(p_meeting_id uuid,p_bot_id text,p_token uuid,p_turns jsonb,p_patch jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare m public.meetings; transcript_text text;
begin
  select * into m from public.meetings where id=p_meeting_id and bot_id=p_bot_id for update;
  if not found or m.transcript_processing_token is distinct from p_token then raise exception 'Meeting/bot/lease mismatch'; end if;
  if jsonb_typeof(p_turns) <> 'array' then raise exception 'Turns must be an array'; end if;
  select coalesce(string_agg((t->>'speaker') || ': ' || (t->>'text'),E'\n' order by n),'') into transcript_text
    from jsonb_array_elements(p_turns) with ordinality as a(t,n);
  update public.meetings set transcript_segments=p_turns,transcript=transcript_text,
    status='completed',processing_stage='transcript_ready',error_message=null,
    transcription_provider=p_patch->>'transcription_provider',transcript_metrics=p_patch->'transcript_metrics',
    transcript_source_metadata=p_patch->'transcript_source_metadata',
    duration_secs=coalesce((p_patch->>'duration_secs')::int,duration_secs),
    ended_at=coalesce((p_patch->>'ended_at')::timestamptz,ended_at),
    started_at=coalesce((p_patch->>'started_at')::timestamptz,started_at),
    raw_transcription=null,raw_diarization=null
  where id=m.id;
  delete from public.transcripts where meeting_id=m.id;
  insert into public.transcripts(meeting_id,speaker,text,turn_index,start_seconds,end_seconds)
    select m.id,t->>'speaker',t->>'text',(n-1)::int,(t->>'start_time')::numeric,(t->>'end_time')::numeric
    from jsonb_array_elements(p_turns) with ordinality as a(t,n) order by n;
  -- Keep optional context ordering aliases populated without requiring context migration.
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='transcripts' and column_name='segment_index') then
    execute 'update public.transcripts set segment_index=turn_index,start_time=start_seconds,end_time=end_seconds where meeting_id=$1' using m.id;
  end if;
  return m.id;
end $$;

revoke all on function public.claim_meeting_transcript(uuid,text,uuid,boolean) from public,anon,authenticated;
revoke all on function public.persist_meeting_transcript(uuid,text,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.claim_meeting_transcript(uuid,text,uuid,boolean) to service_role;
grant execute on function public.persist_meeting_transcript(uuid,text,uuid,jsonb,jsonb) to service_role;
