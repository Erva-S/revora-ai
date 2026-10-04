-- Revora context management v1. Additive; run against an inspected database.
-- This does not repair the pre-existing 0004/init-schema replay ordering issue.
begin;

-- With no live-schema export, fail closed on unrelated tables/functions instead
-- of treating CREATE IF NOT EXISTS as proof that their definitions match ours.
do $$
declare n text; r record; actual text;
begin
  foreach n in array array['clients','projects','briefings','transcript_chunks'] loop
    if to_regclass('public.' || n) is not null
       and obj_description(to_regclass('public.' || n), 'pg_class') is distinct from 'Revora context management v1' then
      raise exception 'Existing public.% needs schema reconciliation before this migration; no changes applied', n;
    end if;
  end loop;
  if to_regprocedure('public.is_admin(uuid)') is null or to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Apply and inspect the existing Revora schema/helpers first';
  end if;
  for r in select * from (values
    ('meetings','id','uuid'), ('meetings','user_id','uuid'),
    ('meetings','started_at','timestamp with time zone'), ('meetings','updated_at','timestamp with time zone'),
    ('meetings','transcript_segments','jsonb'), ('transcripts','id','uuid'),
    ('transcripts','meeting_id','uuid'), ('summaries','meeting_id','uuid'),
    ('action_items','id','uuid'), ('action_items','meeting_id','uuid'),
    ('action_items','due_day','text'), ('profiles','id','uuid')
  ) v(tbl,col,typ) loop
    select format_type(a.atttypid,a.atttypmod) into actual from pg_attribute a
      where a.attrelid=to_regclass('public.'||r.tbl) and a.attname=r.col and not a.attisdropped;
    if actual is distinct from r.typ then
      raise exception 'Expected public.%.% type %, found %. Reconcile schema first', r.tbl,r.col,r.typ,actual;
    end if;
  end loop;
  for r in select p.oid,p.proname from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and p.proname in
      ('match_transcript_chunks','context_persist_action_items','context_commit_chunks') loop
    if obj_description(r.oid,'pg_proc') is distinct from 'Revora context management v1' then
      raise exception 'Existing function public.% needs reconciliation', r.proname;
    end if;
  end loop;
  if exists (select 1 from pg_extension e join pg_namespace ns on ns.oid=e.extnamespace
    where e.extname='vector' and ns.nspname <> 'extensions') then
    raise exception 'vector is installed outside extensions; adapt the migration to its existing schema first';
  end if;
end $$;

create schema if not exists extensions;
create extension if not exists vector with schema extensions;
grant usage on schema extensions to authenticated,service_role;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(), name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);
comment on table public.clients is 'Revora context management v1';
create unique index if not exists clients_name_lower_key on public.clients(lower(name));

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null, description text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);
comment on table public.projects is 'Revora context management v1';
create unique index if not exists projects_client_name_key on public.projects(client_id,lower(name));

alter table public.meetings
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists context_status text check (context_status in ('pending','processing','ready','failed')),
  add column if not exists context_started_at timestamptz,
  add column if not exists context_indexed_at timestamptz,
  add column if not exists context_error text;
create index if not exists meetings_project_idx on public.meetings(project_id,created_at desc);

alter table public.transcripts
  add column if not exists segment_index integer,
  add column if not exists start_time double precision,
  add column if not exists end_time double precision;
create unique index if not exists transcripts_meeting_segment_key
  on public.transcripts(meeting_id,segment_index) where segment_index is not null;

alter table public.summaries
  add column if not exists key_topics jsonb not null default '[]'::jsonb,
  add column if not exists open_questions jsonb not null default '[]'::jsonb;

alter table public.action_items
  add column if not exists fingerprint text,
  add column if not exists assignee_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists source_segment_index integer,
  add column if not exists status_source text not null default 'ai' check (status_source in ('ai','manual')),
  add column if not exists completed_at timestamptz,
  add column if not exists carried_from uuid references public.action_items(id) on delete set null,
  add column if not exists updated_at timestamptz not null default timezone('utc',now());
create unique index if not exists action_items_meeting_fingerprint_key
  on public.action_items(meeting_id,fingerprint) where fingerprint is not null;

-- Validate same-named additive columns rather than silently accepting incompatible types.
do $$
declare r record; actual text;
begin
  for r in select * from (values
    ('meetings','project_id','uuid'), ('meetings','context_status','text'),
    ('meetings','context_started_at','timestamp with time zone'),
    ('meetings','context_indexed_at','timestamp with time zone'), ('meetings','context_error','text'),
    ('transcripts','segment_index','integer'), ('transcripts','start_time','double precision'),
    ('transcripts','end_time','double precision'), ('summaries','key_topics','jsonb'), ('summaries','open_questions','jsonb'),
    ('action_items','fingerprint','text'), ('action_items','status_source','text'),
    ('action_items','assignee_user_id','uuid'), ('action_items','source_segment_index','integer'),
    ('action_items','completed_at','timestamp with time zone'), ('action_items','carried_from','uuid'),
    ('action_items','updated_at','timestamp with time zone')
  ) v(tbl,col,typ) loop
    select format_type(a.atttypid,a.atttypmod) into actual from pg_attribute a
      where a.attrelid=to_regclass('public.'||r.tbl) and a.attname=r.col and not a.attisdropped;
    if actual is distinct from r.typ then raise exception 'Incompatible public.%.%: %',r.tbl,r.col,actual; end if;
  end loop;
end $$;

create table if not exists public.transcript_chunks (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  chunk_index integer not null, text text not null,
  speakers text[] not null default '{}',
  first_segment_index integer, last_segment_index integer,
  start_time double precision, end_time double precision,
  token_estimate integer not null, content_hash text not null,
  chunker_version smallint not null default 1,
  embedding extensions.vector(768), embedding_model text,
  created_at timestamptz not null default timezone('utc',now()),
  unique(meeting_id,chunk_index)
);
comment on table public.transcript_chunks is 'Revora context management v1';
create index if not exists transcript_chunks_embedding_hnsw
  on public.transcript_chunks using hnsw(embedding extensions.vector_cosine_ops);

create table if not exists public.briefings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  meeting_id uuid references public.meetings(id) on delete cascade,
  title text, agenda text, scheduled_for timestamptz,
  status text not null default 'generating' check(status in ('generating','ready','failed')),
  content jsonb, source_meeting_ids uuid[] not null default '{}', context_snapshot jsonb,
  input_hash text, model text, error_message text,
  requested_by uuid references auth.users(id) on delete set null,
  generated_at timestamptz,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);
comment on table public.briefings is 'Revora context management v1';
create index if not exists briefings_meeting_idx on public.briefings(meeting_id,created_at desc);
create index if not exists briefings_project_idx on public.briefings(project_id,created_at desc);
-- Concurrent Generate clicks share one row. Refresh reclaims that row with CAS.
create unique index if not exists briefings_scope_input_key on public.briefings
  (project_id,coalesce(meeting_id,'00000000-0000-0000-0000-000000000000'::uuid),input_hash)
  where input_hash is not null;

do $$
declare n text;
begin
  foreach n in array array['clients','projects','briefings','action_items'] loop
    if not exists (select 1 from pg_trigger where tgrelid=to_regclass('public.'||n)
      and tgname=n||'_context_updated_at') then
      execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
        n||'_context_updated_at',n);
    end if;
  end loop;
end $$;

alter table public.clients enable row level security;
alter table public.projects enable row level security;
alter table public.transcript_chunks enable row level security;
alter table public.briefings enable row level security;
-- Explicit revocation also handles Supabase's default anon table privileges.
revoke all on public.clients,public.projects,public.transcript_chunks,public.briefings from public,anon,authenticated;
grant select,insert,update,delete on public.clients,public.projects,public.transcript_chunks to authenticated,service_role;
grant select on public.briefings to authenticated;
revoke insert,update,delete on public.briefings from authenticated;
grant select,insert,update,delete on public.briefings to service_role;

-- No existing policy is dropped or replaced. PostgreSQL has no CREATE POLICY IF NOT EXISTS.
do $$
begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='clients' and policyname='context_clients_read') then
    create policy context_clients_read on public.clients for select to authenticated using (
      public.is_admin() or exists(select 1 from public.projects p join public.meetings m on m.project_id=p.id
        where p.client_id=clients.id and m.user_id=auth.uid()));
    create policy context_clients_admin on public.clients for all to authenticated
      using(public.is_admin()) with check(public.is_admin());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='projects' and policyname='context_projects_read') then
    create policy context_projects_read on public.projects for select to authenticated using (
      public.is_admin() or exists(select 1 from public.meetings m where m.project_id=projects.id and m.user_id=auth.uid()));
    create policy context_projects_admin on public.projects for all to authenticated
      using(public.is_admin()) with check(public.is_admin());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='transcript_chunks' and policyname='context_chunks_read') then
    create policy context_chunks_read on public.transcript_chunks for select to authenticated using (
      public.is_admin() or exists(select 1 from public.meetings m where m.id=transcript_chunks.meeting_id and m.user_id=auth.uid()));
    create policy context_chunks_admin on public.transcript_chunks for all to authenticated
      using(public.is_admin()) with check(public.is_admin());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='briefings' and policyname='context_briefings_read') then
    create policy context_briefings_read on public.briefings for select to authenticated using (
      (public.is_admin() or exists(select 1 from public.meetings m where m.id=briefings.meeting_id and m.user_id=auth.uid()))
      and not exists (select 1 from unnest(briefings.source_meeting_ids) source_id
        where not exists(select 1 from public.meetings src where src.id=source_id and src.project_id=briefings.project_id))
      -- Hide stale saved context after target/source ownership or project changes.
      and (briefings.meeting_id is null or exists (
        select 1 from public.meetings target where target.id=briefings.meeting_id
          and target.project_id=briefings.project_id
          and (briefings.context_snapshot->>'owner_id') is not distinct from target.user_id::text
          and not exists (select 1 from unnest(briefings.source_meeting_ids) source_id
            where not exists(select 1 from public.meetings src where src.id=source_id
              and src.project_id=briefings.project_id and src.user_id is not distinct from target.user_id))
      ))
    );
  end if;
end $$;

-- Exact, project-prefiltered scan: avoids HNSW post-filter under-fill on small
-- project/owner sets, independent of the installed pgvector iterative-scan version.
create or replace function public.match_transcript_chunks(
  p_project_id uuid, p_query extensions.vector(768), p_owner_id uuid default null,
  p_exclude_meeting_id uuid default null, p_limit int default 24
) returns table (
  id uuid, meeting_id uuid, meeting_title text, meeting_date timestamptz,
  chunk_index integer, text text, speakers text[], start_time double precision,
  end_time double precision, similarity double precision, embedding_model text
) language sql stable security invoker set search_path=public,extensions as $$
  with eligible as materialized (
    select c.*,m.title as mt,coalesce(m.started_at,m.created_at) as md
    from public.transcript_chunks c join public.meetings m on m.id=c.meeting_id
    where m.project_id=p_project_id and m.status in ('summarized','completed')
      and c.embedding is not null
      and (p_owner_id is null or m.user_id=p_owner_id)
      and (p_exclude_meeting_id is null or (m.id<>p_exclude_meeting_id and exists (
        -- Also enforces isolation for an admin-only target whose user_id is NULL.
        select 1 from public.meetings target where target.id=p_exclude_meeting_id
          and target.project_id=p_project_id and m.user_id is not distinct from target.user_id
      )))
  ) select e.id,e.meeting_id,e.mt,e.md,e.chunk_index,e.text,e.speakers,e.start_time,e.end_time,
    1-(e.embedding <=> p_query),e.embedding_model
  from eligible e order by e.embedding <=> p_query,e.id
  limit greatest(0,least(coalesce(p_limit,24),100));
$$;
comment on function public.match_transcript_chunks(uuid,extensions.vector,uuid,uuid,integer) is 'Revora context management v1';
revoke all on function public.match_transcript_chunks(uuid,extensions.vector,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.match_transcript_chunks(uuid,extensions.vector,uuid,uuid,integer) to service_role;

-- Lease-fenced atomic commit. A worker whose lease expired cannot overwrite a
-- newer worker, and a failed embedding request never destroys the old index.
create or replace function public.context_commit_chunks(p_meeting_id uuid,p_started_at timestamptz,p_chunks jsonb,p_count integer)
returns boolean language plpgsql security invoker set search_path=public,extensions as $$
begin
  perform 1 from public.meetings where id=p_meeting_id and context_status='processing'
    and context_started_at=p_started_at for update;
  if not found then return false; end if;
  if p_count<0 or p_count>400 or jsonb_typeof(p_chunks)<>'array' then raise exception 'Invalid chunk batch'; end if;
  insert into public.transcript_chunks(meeting_id,chunk_index,text,speakers,first_segment_index,last_segment_index,
    start_time,end_time,token_estimate,content_hash,chunker_version,embedding,embedding_model)
  select p_meeting_id,x.chunk_index,x.text,x.speakers,x.first_segment_index,x.last_segment_index,
    x.start_time,x.end_time,x.token_estimate,x.content_hash,x.chunker_version,x.embedding::extensions.vector(768),x.embedding_model
  from jsonb_to_recordset(p_chunks) as x(chunk_index int,text text,speakers text[],first_segment_index int,last_segment_index int,
    start_time float8,end_time float8,token_estimate int,content_hash text,chunker_version smallint,embedding text,embedding_model text)
  on conflict(meeting_id,chunk_index) do update set
    text=excluded.text,speakers=excluded.speakers,first_segment_index=excluded.first_segment_index,
    last_segment_index=excluded.last_segment_index,start_time=excluded.start_time,end_time=excluded.end_time,
    token_estimate=excluded.token_estimate,content_hash=excluded.content_hash,chunker_version=excluded.chunker_version,
    embedding=excluded.embedding,embedding_model=excluded.embedding_model
  where transcript_chunks.content_hash is distinct from excluded.content_hash or transcript_chunks.embedding is null;
  delete from public.transcript_chunks where meeting_id=p_meeting_id and chunk_index>=p_count;
  update public.meetings set context_status='ready',context_indexed_at=now(),context_error=null where id=p_meeting_id;
  return true;
end $$;
comment on function public.context_commit_chunks(uuid,timestamptz,jsonb,integer) is 'Revora context management v1';
revoke all on function public.context_commit_chunks(uuid,timestamptz,jsonb,integer) from public,anon,authenticated;
grant execute on function public.context_commit_chunks(uuid,timestamptz,jsonb,integer) to service_role;

-- The partial-index predicate and manual-write guard live in SQL so concurrent
-- human edits cannot be overwritten between a client-side SELECT and UPSERT.
create or replace function public.context_persist_action_items(p_meeting_id uuid,p_items jsonb,p_updates jsonb default '[]'::jsonb)
returns void language plpgsql security invoker set search_path=public,extensions as $$
declare item jsonb; legacy_id uuid; upd jsonb; changed public.action_items%rowtype;
begin
  perform 1 from public.meetings where id=p_meeting_id for update;
  if not found then raise exception 'Meeting not found'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    -- Adopt one legacy row's identity before upserting; manual rows win.
    if not exists(select 1 from public.action_items where meeting_id=p_meeting_id and fingerprint=item->>'fingerprint') then
      select id into legacy_id from public.action_items a where a.meeting_id=p_meeting_id and a.fingerprint is null
        and lower(regexp_replace(btrim(a.task),'\s+',' ','g'))=item->>'normalized_task'
        and lower(regexp_replace(btrim(coalesce(a.assignee,'')),'\s+',' ','g'))=item->>'normalized_assignee'
        order by (a.status_source='manual') desc,a.created_at,a.id limit 1 for update;
      if found then update public.action_items set fingerprint=item->>'fingerprint' where id=legacy_id; end if;
    end if;
    insert into public.action_items(meeting_id,task,assignee,due_day,due_date,status,fingerprint,assignee_user_id,status_source,completed_at)
    values(p_meeting_id,item->>'task',item->>'assignee',item->>'due_day',(item->>'due_date')::date,
      item->>'status',item->>'fingerprint',(item->>'assignee_user_id')::uuid,'ai',
      case when item->>'status'='completed' then now() else null end)
    on conflict(meeting_id,fingerprint) where fingerprint is not null do update set
      task=excluded.task,assignee=excluded.assignee,due_day=excluded.due_day,due_date=excluded.due_date,
      status=excluded.status,assignee_user_id=excluded.assignee_user_id,
      completed_at=case when excluded.status='completed' then coalesce(action_items.completed_at,excluded.completed_at) else null end
    where action_items.status_source='ai';
  end loop;
  delete from public.action_items a where a.meeting_id=p_meeting_id and a.status_source='ai'
    and not exists(select 1 from jsonb_array_elements(p_items) i where i->>'fingerprint'=a.fingerprint);
  -- Carryover is bounded/validated by the webhook, and scope is enforced again here.
  for upd in select value from jsonb_array_elements(p_updates) loop
    if upd->>'status' not in ('pending','in_progress','completed') or coalesce(upd->>'evidence','')='' then continue; end if;
    update public.action_items a set status=upd->>'status',status_source='ai',
      completed_at=case when upd->>'status'='completed' then coalesce(a.completed_at,now()) else null end
    from public.meetings source,public.meetings target
    where a.id=(upd->>'task_id')::uuid and a.status_source='ai'
      and a.status in ('pending','in_progress') and a.meeting_id=source.id and target.id=p_meeting_id
      and source.id<>target.id and target.project_id is not null and source.project_id=target.project_id
      and source.user_id is not distinct from target.user_id
      and source.status in ('summarized','completed')
    returning a.* into changed;
    if found then
      -- Keep the existing source meeting's display mirror consistent with carryover.
      update public.meetings set action_items=(select coalesce(jsonb_agg(
        case when el->>'task'=changed.task and (el->>'assignee') is not distinct from changed.assignee
          then jsonb_set(el,'{status}',to_jsonb(changed.status)) else el end order by ord),'[]'::jsonb)
        from jsonb_array_elements(action_items) with ordinality e(el,ord)) where id=changed.meeting_id;
    end if;
  end loop;
end $$;
comment on function public.context_persist_action_items(uuid,jsonb,jsonb) is 'Revora context management v1';
revoke all on function public.context_persist_action_items(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.context_persist_action_items(uuid,jsonb,jsonb) to service_role;

commit;
