-- Read-only live-schema inventory. Run separately from the migration and inspect
-- all result sets; no transcript text, credentials or profile emails are selected.
select version() as postgres_version;

select table_schema,table_name,ordinal_position,column_name,data_type,udt_schema,udt_name,is_nullable,column_default
from information_schema.columns where table_schema='public' and table_name in
  ('profiles','meetings','transcripts','summaries','action_items','clients','projects','organizations','briefings','transcript_chunks')
order by table_name,ordinal_position;

select conname,convalidated,pg_get_constraintdef(oid,true) as definition
from pg_constraint where conrelid=to_regclass('public.meetings') and contype='c' order by conname;

select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies order by schemaname,tablename,policyname;

select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p') order by c.relname;

select e.extname,e.extversion,n.nspname as extension_schema
from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by e.extname;
select name,default_version,installed_version,comment from pg_available_extensions where name='vector';

with wanted(name) as (values ('clients'),('projects'),('organizations'),('briefings'),('transcript_chunks'))
select w.name,n.nspname,c.relkind from wanted w
left join pg_class c on c.relname=w.name and c.relkind in ('r','p','v','m','f')
left join pg_namespace n on n.oid=c.relnamespace order by w.name,n.nspname;

select 'meetings' as table_name,count(*) as row_count from public.meetings
union all select 'transcripts',count(*) from public.transcripts
union all select 'summaries',count(*) from public.summaries
union all select 'action_items',count(*) from public.action_items;
select meeting_id,count(*) as summary_count,min(created_at) as oldest,max(created_at) as newest
from public.summaries group by meeting_id having count(*)>1 order by summary_count desc,meeting_id;
select status,count(*) as meeting_count,count(*) filter(where user_id is null) as unassigned_count
from public.meetings group by status order by status;

select tablename,indexname,indexdef from pg_indexes where schemaname='public' and tablename in
  ('meetings','transcripts','summaries','action_items','clients','projects','briefings','transcript_chunks')
order by tablename,indexname;
select p.oid::regprocedure::text as signature,p.prosecdef,p.proconfig,p.proacl,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('is_admin','set_updated_at','match_transcript_chunks','context_commit_chunks','context_persist_action_items');
select c.relname,t.tgname,pg_get_triggerdef(t.oid,true) from pg_trigger t
join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and n.nspname='public' and c.relname in ('meetings','action_items','clients','projects','briefings');
select table_name,grantee,privilege_type from information_schema.table_privileges
where table_schema='public' and table_name in
  ('meetings','transcripts','summaries','action_items','clients','projects','briefings','transcript_chunks')
  and grantee in ('PUBLIC','anon','authenticated','service_role') order by table_name,grantee,privilege_type;
select conrelid::regclass as referencing_table,conname,pg_get_constraintdef(oid,true)
from pg_constraint where contype='f' and confrelid=to_regclass('public.transcripts');
