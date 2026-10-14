-- Revora project documents v1.
--
-- Markdown is stored in Postgres rather than in an Edge Function's local
-- filesystem. Edge invocations are replaceable and may run concurrently, so
-- writes go through the service-role-only CAS RPC below and every successful
-- change leaves a revision behind.
begin;

create table if not exists public.project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null,
  content text not null,
  version integer not null default 1,
  content_hash text not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  constraint project_documents_kind_check check (kind in ('decisions', 'context')),
  constraint project_documents_content_length_check check (char_length(content) between 1 and 100000),
  constraint project_documents_version_check check (version between 1 and 2147483647),
  constraint project_documents_hash_check check (content_hash ~* '^[0-9a-f]{64}$'),
  constraint project_documents_project_kind_key unique (project_id, kind),
  -- This composite key lets revisions prove that their project/kind scope is
  -- the same scope as the document they reference.
  constraint project_documents_scope_key unique (id, project_id, kind)
);

comment on table public.project_documents is 'Revora project documents v1: canonical Markdown, one row per project and kind';

create table if not exists public.project_document_revisions (
  id uuid primary key default gen_random_uuid(),
  project_document_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null,
  content text not null,
  version integer not null,
  content_hash text not null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  superseded_at timestamptz,
  constraint project_document_revisions_kind_check check (kind in ('decisions', 'context')),
  constraint project_document_revisions_content_length_check check (char_length(content) between 1 and 100000),
  constraint project_document_revisions_version_check check (version between 1 and 2147483647),
  constraint project_document_revisions_hash_check check (content_hash ~* '^[0-9a-f]{64}$'),
  constraint project_document_revisions_version_key unique (project_document_id, version),
  constraint project_document_revisions_scope_fk
    foreign key (project_document_id, project_id, kind)
    references public.project_documents(id, project_id, kind)
    on delete cascade
);

comment on table public.project_document_revisions is 'Revora project documents v1: immutable Markdown history; the current row is superseded on the next CAS write';

create index if not exists project_documents_project_updated_idx
  on public.project_documents(project_id, updated_at desc);
create index if not exists project_document_revisions_document_version_idx
  on public.project_document_revisions(project_document_id, version desc);
create index if not exists project_document_revisions_project_kind_idx
  on public.project_document_revisions(project_id, kind, created_at desc);

drop trigger if exists project_documents_set_updated_at on public.project_documents;
create trigger project_documents_set_updated_at
  before update on public.project_documents
  for each row execute function public.set_updated_at();

-- Do not inherit the historical anon table grants. Direct authenticated writes
-- are restricted by policy below; the service role is the only writer used by
-- the durable document pipeline and can write both tables.
revoke all on public.project_documents, public.project_document_revisions from public, anon, authenticated;
grant select, update on public.project_documents to authenticated;
grant select on public.project_document_revisions to authenticated;
grant all on public.project_documents, public.project_document_revisions to service_role;

alter table public.project_documents enable row level security;
alter table public.project_document_revisions enable row level security;

drop policy if exists project_documents_read on public.project_documents;
create policy project_documents_read on public.project_documents
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
        from public.meetings m
       where m.project_id = project_documents.project_id
         and m.user_id = auth.uid()
    )
  );

-- Human edits are deliberately an admin operation. Automated writes use the
-- service-role-only RPC so an authenticated client cannot bypass version/CAS
-- checks with a plain PostgREST update.
drop policy if exists project_documents_admin_update on public.project_documents;
create policy project_documents_admin_update on public.project_documents
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists project_document_revisions_read on public.project_document_revisions;
create policy project_document_revisions_read on public.project_document_revisions
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
        from public.meetings m
       where m.project_id = project_document_revisions.project_id
         and m.user_id = auth.uid()
    )
  );

-- The function locks the project first and the document second. That makes
-- first-write races deterministic, while the document version check fences a
-- serverless invocation that read an older Markdown snapshot. Each call is
-- one database transaction: the current row and its revision cannot diverge.
create or replace function public.update_project_document(
  p_project_id uuid,
  p_kind text,
  p_content text,
  p_content_hash text,
  p_expected_version integer default null,
  p_updated_by uuid default null
) returns table (
  id uuid,
  project_id uuid,
  kind text,
  content text,
  version integer,
  content_hash text,
  updated_by uuid,
  updated_at timestamptz,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_document public.project_documents%rowtype;
  next_version integer;
begin
  if p_project_id is null then
    raise exception using errcode = '22023', message = 'Project ID is required';
  end if;
  if p_kind is null or p_kind not in ('decisions', 'context') then
    raise exception using errcode = '22023', message = 'Project document kind is invalid';
  end if;
  if p_content is null or char_length(btrim(p_content)) = 0 or char_length(p_content) > 100000 then
    raise exception using errcode = '22023', message = 'Project document content length is invalid';
  end if;
  if p_content_hash is null or p_content_hash !~* '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Project document content hash is invalid';
  end if;

  -- Locking the parent also serializes two first writers for the same project;
  -- the unique project/kind key remains the final database-level guard.
  perform 1 from public.projects where id = p_project_id for share;
  if not found then
    raise exception using errcode = '23503', message = 'Project not found';
  end if;

  select * into current_document
    from public.project_documents
   where project_id = p_project_id and kind = p_kind
   for update;

  if found then
    if p_expected_version is distinct from current_document.version then
      raise exception using errcode = '40001', message = 'Project document version conflict',
        detail = format('Expected version %s, current version %s', coalesce(p_expected_version::text, 'null'), current_document.version);
    end if;

    next_version := current_document.version + 1;
    update public.project_documents
       set content = p_content,
           version = next_version,
           content_hash = lower(p_content_hash),
           updated_by = p_updated_by
     where id = current_document.id;

    update public.project_document_revisions
       set superseded_at = coalesce(superseded_at, timezone('utc', now()))
     where project_document_id = current_document.id
       and superseded_at is null;
  else
    if p_expected_version is not null and p_expected_version <> 0 then
      raise exception using errcode = '40001', message = 'Project document version conflict',
        detail = format('Expected version %s for a new document', p_expected_version);
    end if;

    next_version := 1;
    insert into public.project_documents(project_id, kind, content, version, content_hash, updated_by)
    values (p_project_id, p_kind, p_content, next_version, lower(p_content_hash), p_updated_by)
    returning * into current_document;
  end if;

  insert into public.project_document_revisions(
    project_document_id, project_id, kind, content, version, content_hash, updated_by
  ) values (
    current_document.id, current_document.project_id, current_document.kind,
    current_document.content, current_document.version, current_document.content_hash,
    current_document.updated_by
  );

  return query
    select d.id, d.project_id, d.kind, d.content, d.version, d.content_hash,
           d.updated_by, d.updated_at, d.created_at
      from public.project_documents d
     where d.id = current_document.id;
end;
$$;

comment on function public.update_project_document(uuid, text, text, text, integer, uuid)
  is 'Revora project documents v1: service-role-only atomic Markdown CAS update with revision history';

revoke all on function public.update_project_document(uuid, text, text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.update_project_document(uuid, text, text, text, integer, uuid) to service_role;

commit;
