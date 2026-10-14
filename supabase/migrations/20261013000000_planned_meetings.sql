-- Revora planned meetings v1. Additive and idempotent.
-- Apply after 20261008000000_meeting_pipeline_integrity.sql.
begin;

-- Fail closed when the target table exists with an unrelated definition, and
-- when the context-management schema this migration extends is not present.
do $$
declare
  r record;
  actual text;
begin
  if to_regclass('public.planned_meetings') is not null
     and obj_description(to_regclass('public.planned_meetings'), 'pg_class') is distinct from 'Revora planned meetings v1' then
    raise exception 'Existing public.planned_meetings needs schema reconciliation before this migration; no changes applied';
  end if;

  for r in select * from (values
    ('projects', 'id', 'uuid'),
    ('projects', 'client_id', 'uuid'),
    ('projects', 'name', 'text'),
    ('meetings', 'id', 'uuid'),
    ('meetings', 'user_id', 'uuid'),
    ('meetings', 'project_id', 'uuid'),
    ('meetings', 'title', 'text'),
    ('meetings', 'status', 'text'),
    ('briefings', 'id', 'uuid'),
    ('briefings', 'project_id', 'uuid'),
    ('briefings', 'meeting_id', 'uuid'),
    ('briefings', 'status', 'text'),
    ('briefings', 'input_hash', 'text'),
    ('briefings', 'context_snapshot', 'jsonb'),
    ('briefings', 'source_meeting_ids', 'uuid[]'),
    ('briefings', 'requested_by', 'uuid'),
    ('profiles', 'id', 'uuid'),
    ('profiles', 'role', 'text')
  ) v(tbl, col, typ) loop
    if to_regclass('public.' || r.tbl) is null then
      raise exception 'Expected public.% before planned-meetings migration', r.tbl;
    end if;
    select format_type(a.atttypid, a.atttypmod)
      into actual
      from pg_attribute a
     where a.attrelid = to_regclass('public.' || r.tbl)
       and a.attname = r.col
       and not a.attisdropped;
    if actual is distinct from r.typ then
      raise exception 'Expected public.%.% type %, found %. Reconcile schema first', r.tbl, r.col, r.typ, actual;
    end if;
  end loop;

  if to_regprocedure('public.is_admin(uuid)') is null
     or to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Expected public.is_admin(uuid) and public.set_updated_at() before planned-meetings migration';
  end if;
end $$;

create table if not exists public.planned_meetings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  title text not null,
  agenda text,
  scheduled_for timestamptz not null,
  meeting_url text,
  status text not null default 'planned'
    check (status in ('planned', 'linked', 'cancelled')),
  linked_meeting_id uuid references public.meetings(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint planned_meetings_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint planned_meetings_agenda_length check (agenda is null or char_length(agenda) <= 12000)
);

comment on table public.planned_meetings is 'Revora planned meetings v1';

-- A marked table is reusable only when it has the final contract. No existing
-- marked table is silently renamed, dropped, or rewritten.
do $$
declare
  r record;
  actual text;
begin
  for r in select * from (values
    ('id', 'uuid'),
    ('project_id', 'uuid'),
    ('user_id', 'uuid'),
    ('title', 'text'),
    ('agenda', 'text'),
    ('scheduled_for', 'timestamp with time zone'),
    ('meeting_url', 'text'),
    ('status', 'text'),
    ('linked_meeting_id', 'uuid'),
    ('created_by', 'uuid'),
    ('created_at', 'timestamp with time zone'),
    ('updated_at', 'timestamp with time zone')
  ) v(col, typ) loop
    select format_type(a.atttypid, a.atttypmod)
      into actual
      from pg_attribute a
     where a.attrelid = 'public.planned_meetings'::regclass
       and a.attname = r.col
       and not a.attisdropped;
    if actual is distinct from r.typ then
      raise exception 'Expected public.planned_meetings.% type %, found %. Reconcile schema first', r.col, r.typ, actual;
    end if;
  end loop;
end $$;

do $$
declare
  status_definition text;
begin
  select pg_get_constraintdef(oid)
    into status_definition
    from pg_constraint
   where conrelid = 'public.planned_meetings'::regclass
     and conname = 'planned_meetings_status_check';
  if status_definition is null
     or status_definition not like '%planned%'
     or status_definition not like '%linked%'
     or status_definition not like '%cancelled%'
     or status_definition like '%scheduled%'
     or status_definition like '%completed%' then
    raise exception 'Existing public.planned_meetings has an incompatible status constraint; reconcile schema first';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.planned_meetings'::regclass
       and conname = 'planned_meetings_status_check'
  ) then
    alter table public.planned_meetings add constraint planned_meetings_status_check
      check (status in ('planned', 'linked', 'cancelled'));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.planned_meetings'::regclass
       and conname = 'planned_meetings_title_length'
  ) then
    alter table public.planned_meetings add constraint planned_meetings_title_length
      check (char_length(btrim(title)) between 1 and 200);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.planned_meetings'::regclass
       and conname = 'planned_meetings_agenda_length'
  ) then
    alter table public.planned_meetings add constraint planned_meetings_agenda_length
      check (agenda is null or char_length(agenda) <= 12000);
  end if;
end $$;

alter table public.briefings
  add column if not exists planned_meeting_id uuid
  references public.planned_meetings(id) on delete cascade;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.briefings'::regclass
       and conname = 'briefings_one_target_check'
  ) then
    alter table public.briefings add constraint briefings_one_target_check
      check (num_nonnulls(meeting_id, planned_meeting_id) <= 1);
  end if;
end $$;

create index if not exists planned_meetings_project_scheduled_idx
  on public.planned_meetings(project_id, scheduled_for desc);
create index if not exists planned_meetings_user_scheduled_idx
  on public.planned_meetings(user_id, scheduled_for);
create unique index if not exists planned_meetings_linked_meeting_key
  on public.planned_meetings(linked_meeting_id)
  where linked_meeting_id is not null;
create index if not exists briefings_planned_meeting_idx
  on public.briefings(planned_meeting_id, created_at desc);

drop trigger if exists planned_meetings_set_updated_at on public.planned_meetings;
create trigger planned_meetings_set_updated_at
  before update on public.planned_meetings
  for each row execute function public.set_updated_at();

alter table public.planned_meetings enable row level security;
alter table public.briefings enable row level security;

revoke all on public.planned_meetings from public, anon, authenticated;
grant select, insert, update, delete on public.planned_meetings to authenticated, service_role;
grant select on public.briefings to authenticated;
revoke insert, update, delete on public.briefings from authenticated;
grant select, insert, update, delete on public.briefings to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'planned_meetings'
       and policyname = 'planned_meetings_read'
  ) then
    create policy planned_meetings_read on public.planned_meetings
      for select to authenticated
      using (public.is_admin() or user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'planned_meetings'
       and policyname = 'planned_meetings_admin_insert'
  ) then
    create policy planned_meetings_admin_insert on public.planned_meetings
      for insert to authenticated
      with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'planned_meetings'
       and policyname = 'planned_meetings_admin_update'
  ) then
    create policy planned_meetings_admin_update on public.planned_meetings
      for update to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'planned_meetings'
       and policyname = 'planned_meetings_admin_delete'
  ) then
    create policy planned_meetings_admin_delete on public.planned_meetings
      for delete to authenticated
      using (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'briefings'
       and policyname = 'context_planned_briefings_read'
  ) then
    create policy context_planned_briefings_read on public.briefings
      for select to authenticated
      using (
        briefings.planned_meeting_id is not null
        and exists (
          select 1
            from public.planned_meetings p
           where p.id = briefings.planned_meeting_id
             and (public.is_admin() or p.user_id = auth.uid())
             and p.project_id = briefings.project_id
             and (briefings.context_snapshot->>'owner_id') is not distinct from p.user_id::text
             and not exists (
               select 1
                 from unnest(coalesce(briefings.source_meeting_ids, '{}'::uuid[])) source_id
                where not exists (
                  select 1
                    from public.meetings source_meeting
                   where source_meeting.id = source_id
                     and source_meeting.project_id = p.project_id
                     and source_meeting.user_id is not distinct from p.user_id
                )
             )
        )
      );
  end if;
end $$;

-- Planned retrieval never delegates NULL-owner semantics to the legacy
-- match_transcript_chunks function, where NULL means all owners. The planned
-- row and its explicit owner are both part of this service-role-only scope.
create or replace function public.match_planned_meeting_chunks(
  p_planned_id uuid,
  p_project_id uuid,
  p_owner_id uuid,
  p_query extensions.vector(768),
  p_limit integer default 24
) returns table (
  id uuid,
  meeting_id uuid,
  meeting_title text,
  meeting_date timestamptz,
  chunk_index integer,
  text text,
  speakers text[],
  start_time double precision,
  end_time double precision,
  similarity double precision,
  embedding_model text
) language sql stable security invoker
  set search_path = public, extensions
as $$
  with planned as materialized (
    select id, project_id, user_id
      from public.planned_meetings
     where id = p_planned_id
       and project_id = p_project_id
       and user_id is not distinct from p_owner_id
       and status <> 'cancelled'
  ), eligible as materialized (
    select c.*, m.title as meeting_title_value,
           coalesce(m.started_at, m.created_at) as meeting_date_value
      from public.transcript_chunks c
      join public.meetings m on m.id = c.meeting_id
      cross join planned p
     where m.project_id = p.project_id
       and m.user_id is not distinct from p.user_id
       and m.status in ('summarized', 'completed')
       and c.embedding is not null
  )
  select e.id, e.meeting_id, e.meeting_title_value, e.meeting_date_value,
         e.chunk_index, e.text, e.speakers, e.start_time, e.end_time,
         1 - (e.embedding <=> p_query), e.embedding_model
    from eligible e
   order by e.embedding <=> p_query, e.id
   limit greatest(0, least(coalesce(p_limit, 24), 100));
$$;

comment on function public.match_planned_meeting_chunks(uuid, uuid, uuid, extensions.vector, integer)
  is 'Revora planned meetings v1';
revoke all on function public.match_planned_meeting_chunks(uuid, uuid, uuid, extensions.vector, integer)
  from public, anon, authenticated;
grant execute on function public.match_planned_meeting_chunks(uuid, uuid, uuid, extensions.vector, integer)
  to service_role;

-- Compare-and-set link used after a bot has been dispatched and its meetings
-- row has been persisted. A second deployment cannot claim the same plan.
create or replace function public.link_planned_meeting(
  p_planned_id uuid,
  p_meeting_id uuid
) returns boolean language plpgsql security invoker
  set search_path = public
as $$
begin
  update public.planned_meetings p
     set status = 'linked',
         linked_meeting_id = p_meeting_id
   where p.id = p_planned_id
     and p.status = 'planned'
     and p.linked_meeting_id is null
     and exists (
       select 1
         from public.meetings m
        where m.id = p_meeting_id
          and m.project_id = p.project_id
          and m.user_id is not distinct from p.user_id
     );
  return found;
end;
$$;

comment on function public.link_planned_meeting(uuid, uuid)
  is 'Revora planned meetings v1';
revoke all on function public.link_planned_meeting(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.link_planned_meeting(uuid, uuid)
  to service_role;

commit;
