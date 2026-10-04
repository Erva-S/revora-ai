-- Separate, explicitly invoked data step AFTER the context migration.
-- Locks writers during the count/rebuild transaction; schedule during low activity.
-- Source ordering comes ONLY from transcript_segments, never insert timestamps.
begin;
do $$
begin
  if exists(select 1 from pg_constraint where contype='f' and confrelid='public.transcripts'::regclass) then
    raise exception 'Other tables reference transcript row IDs; reconcile their backfill before rebuilding rows';
  end if;
end $$;
lock table public.meetings in share mode;
lock table public.transcripts in share row exclusive mode;
do $$
declare m record; row_count bigint; segment_count int; rebuilt int:=0; skipped int:=0;
begin
  for m in select id,transcript_segments from public.meetings order by id loop
    if jsonb_typeof(m.transcript_segments) is distinct from 'array' then
      raise notice 'SKIP %: segments missing/not an array',m.id; skipped:=skipped+1; continue;
    end if;
    segment_count:=jsonb_array_length(m.transcript_segments);
    select count(*) into row_count from public.transcripts where meeting_id=m.id;
    if row_count<>segment_count then
      raise notice 'SKIP %: transcript rows %, segments %',m.id,row_count,segment_count;
      skipped:=skipped+1; continue;
    end if;
    if segment_count=0 then continue; end if;
    if exists(select 1 from jsonb_array_elements(m.transcript_segments) s
      where jsonb_typeof(s)<>'object' or jsonb_typeof(s->'text') is distinct from 'string'
        or jsonb_typeof(s->'start_time') is distinct from 'number'
        or jsonb_typeof(s->'end_time') is distinct from 'number') then
      raise notice 'SKIP %: malformed source segments',m.id; skipped:=skipped+1; continue;
    end if;
    -- True no-op on repeat, including row IDs and insertion timestamps.
    if not exists(select 1 from jsonb_array_elements(m.transcript_segments) with ordinality s(v,n)
      left join public.transcripts t on t.meeting_id=m.id and t.segment_index=s.n-1
      where t.id is null or t.text is distinct from s.v->>'text'
        or t.speaker is distinct from s.v->>'speaker'
        or t.start_time is distinct from (s.v->>'start_time')::float8
        or t.end_time is distinct from (s.v->>'end_time')::float8) then continue; end if;
    delete from public.transcripts where meeting_id=m.id;
    insert into public.transcripts(meeting_id,speaker,text,segment_index,start_time,end_time)
    select m.id,v->>'speaker',v->>'text',(n-1)::int,(v->>'start_time')::float8,(v->>'end_time')::float8
    from jsonb_array_elements(m.transcript_segments) with ordinality s(v,n);
    rebuilt:=rebuilt+1;
  end loop;
  raise notice 'Backfill: % meetings rebuilt, % skipped',rebuilt,skipped;
end $$;
commit;
