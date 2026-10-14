// Isolated PostgreSQL 17 + pgvector via PGlite; never connects to Supabase.
// See CONTEXT_MANAGEMENT.md for dependency setup and execution commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const { vector } = await import(process.env.PGLITE_VECTOR_MODULE || '@electric-sql/pglite/vector');
const sql = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const embedding = JSON.stringify([1, ...Array(767).fill(0)]);
const setup = async () => {
  const db = new PGlite({ extensions: { vector } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
  `);
  return db;
};
const asRole = (db, role, user, query, params = []) => db.transaction(async (tx) => {
  await tx.exec(`set local role ${role}`);
  await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user || '']);
  return tx.query(query, params);
});

test('pre-existing lexical migration replay fails at 0004 (documented, not repaired)', async () => {
  const db = await setup();
  try {
    await db.exec(await sql('migrations/0002_meetings.sql'));
    await db.exec(await sql('migrations/0003_meetings_meeting_assistant.sql'));
    await assert.rejects(db.exec(await sql('migrations/0004_transcript_segments_and_due_day.sql')), { code: '42P01' });
  } finally { await db.close(); }
});

test('planned migration refuses an unrelated existing table', async () => {
  const db = await setup();
  try {
    for (const file of ['0002_meetings.sql','0003_meetings_meeting_assistant.sql','20260608000000_init_schema.sql',
      '0004_transcript_segments_and_due_day.sql','0005_transcription_provider_metrics.sql','20260902000000_admin_bot_authorization.sql'])
      await db.exec(await sql(`migrations/${file}`));
    await db.exec(await sql('migrations/20261003000000_context_management.sql'));
    await db.exec("create table public.planned_meetings(id integer); comment on table public.planned_meetings is 'Unrelated application table'");
    await assert.rejects(db.exec(await sql('migrations/20261013000000_planned_meetings.sql')),
      /Existing public\.planned_meetings needs schema reconciliation/);
  } finally { await db.close(); }
});

test('additive context migration, retrieval, persistent tasks and RLS', async (t) => {
  const db = await setup();
  try {
    // This test fixture reconciles ONLY its empty local schema's known ordering
    // defect. Existing repository migrations are read verbatim, never rewritten.
    for (const file of ['0002_meetings.sql','0003_meetings_meeting_assistant.sql','20260608000000_init_schema.sql',
      '0004_transcript_segments_and_due_day.sql','0005_transcription_provider_metrics.sql','20260902000000_admin_bot_authorization.sql'])
      await db.exec(await sql(`migrations/${file}`));
    console.log((await db.query('select version()')).rows[0].version);
    await db.query(`insert into auth.users(id,email) values($1,'admin@revora.ai'),($2,'alice@example.test'),($3,'bob@example.test')`, [id(1),id(2),id(3)]);
    await db.query(`insert into public.meetings(id,bot_id,user_id,status,title,transcript_segments) values
      ($1,'target',$2,'summarized','Target','[]'),
      ($3,'history',$2,'summarized','History','[{"speaker":"Alice","text":"First turn with useful project history.","start_time":0,"end_time":5},{"speaker":"Bob","text":"Second turn with a concrete decision.","start_time":6,"end_time":12}]')`,[id(10),id(2),id(11)]);
    await db.query(`insert into transcripts(meeting_id,speaker,text) values($1,'Alice','First turn with useful project history.'),($1,'Bob','Second turn with a concrete decision.')`,[id(11)]);
    await db.query(`insert into summaries(meeting_id,executive_summary) values($1,'summary one'),($1,'summary two')`,[id(11)]);
    await db.query(`insert into action_items(id,meeting_id,task,assignee) values($1,$2,'Ship release','Alice')`,[id(40),id(11)]);
    const counts = async () => (await db.query(`select
      (select count(*) from meetings) as meetings,(select count(*) from transcripts) as transcripts,
      (select count(*) from summaries) as summaries,(select count(*) from action_items) as tasks`)).rows;
    const before = await counts();
    const migration = await sql('migrations/20261003000000_context_management.sql');
    await t.test('migration applies twice without deleting or duplicating existing rows', async () => {
      await db.exec(migration); await db.exec(migration);
      const plannedMigration = await sql('migrations/20261013000000_planned_meetings.sql');
      await db.exec(plannedMigration); await db.exec(plannedMigration);
      assert.deepEqual(await counts(), before);
      assert.equal((await db.query("select count(*)::int n from pg_class where relname in ('clients','projects','briefings','transcript_chunks','planned_meetings') and relrowsecurity")).rows[0].n,5);
      const plannedColumns = (await db.query(`select column_name,is_nullable from information_schema.columns
        where table_schema='public' and table_name='planned_meetings' order by ordinal_position`)).rows;
      assert.deepEqual(plannedColumns.map((column)=>column.column_name).sort(),
        ['id','project_id','user_id','title','agenda','scheduled_for','meeting_url','status','linked_meeting_id','created_by','created_at','updated_at'].sort());
      assert.equal(plannedColumns.find((column)=>column.column_name==='user_id').is_nullable,'YES');
      assert.equal(plannedColumns.find((column)=>column.column_name==='agenda').is_nullable,'YES');
      const cacheIndex = (await db.query(`select indexname,indexdef from pg_indexes
        where schemaname='public' and tablename='briefings' and indexname='briefings_scope_input_key'`)).rows;
       assert.equal(cacheIndex.length,1);
       assert.doesNotMatch(cacheIndex[0].indexdef,/planned_meeting_id/);
    });
    await db.query(`insert into clients(id,name) values($1,'Client A'),($2,'Client B')`,[id(100),id(101)]);
    await db.query(`insert into projects(id,client_id,name) values($1,$2,'Project A'),($3,$4,'Project B')`,[id(110),id(100),id(111),id(101)]);
    await db.query(`update meetings set project_id=$1`,[id(110)]);
    await db.query(`insert into meetings(id,bot_id,user_id,status,title,project_id) values
      ($1,'bob',$2,'summarized','Bob private',$3),($4,'other',$5,'summarized','Other client',$6),
      ($7,'null-target',null,'completed','Unassigned target',$3),($8,'null-history',null,'summarized','Unassigned history',$3),
      ($9,'mismatch',$5,'completed','Mismatch',$3)`,[id(12),id(3),id(110),id(13),id(2),id(111),id(14),id(15),id(16)]);
    await db.query(`insert into planned_meetings(id,project_id,user_id,title,agenda,scheduled_for,meeting_url,status,linked_meeting_id,created_by) values
      ($1,$3,$2,'Alice plan',null,'2026-10-20T10:00:00Z','https://meet.google.com/alice-plan','planned',null,$2),
      ($4,$3,null,'Admin plan','Admin agenda','2026-10-21T10:00:00Z','https://meet.google.com/admin-plan','planned',null,$5)`,
      [id(210),id(2),id(110),id(211),id(1)]);
    const plannedRow = (await db.query('select project_id,user_id,title,agenda,meeting_url,status,linked_meeting_id,created_by,created_at,updated_at from planned_meetings where id=$1',[id(210)])).rows[0];
    assert.deepEqual(plannedRow,{project_id:id(110),user_id:id(2),title:'Alice plan',agenda:null,
      meeting_url:'https://meet.google.com/alice-plan',status:'planned',linked_meeting_id:null,created_by:id(2),
      created_at:plannedRow.created_at,updated_at:plannedRow.updated_at});
    assert.ok(plannedRow.created_at); assert.ok(plannedRow.updated_at);
    await assert.rejects(db.query(`insert into planned_meetings(project_id,title,scheduled_for,meeting_url,status,created_by)
      values($1,'Invalid status','2026-10-22T10:00:00Z','https://meet.google.com/invalid','scheduled',$2)`,[id(110),id(1)]),{code:'23514'});
    for (const meeting of [id(10),id(11),id(12),id(13),id(15)]) {
      await db.query(`insert into transcript_chunks(meeting_id,chunk_index,text,token_estimate,content_hash,embedding,embedding_model)
        select $1,g,'A substantive meeting excerpt for scoped retrieval.',15,'hash-'||g,$2::extensions.vector,'gemini-embedding-001'
        from generate_series(0,29) g`,[meeting,embedding]);
    }
    await db.query(`insert into briefings(id,project_id,meeting_id,planned_meeting_id,status,content,source_meeting_ids,context_snapshot,input_hash) values
      ($1,$2,$3,null,'ready','{}',array[$4::uuid],jsonb_build_object('owner_id',$5::text),'same-input'),
      ($6,$2,$7,null,'ready','{}',array[$7::uuid],jsonb_build_object('owner_id',$8::text),'bob-input'),
      ($9,$2,null,null,'ready','{}','{}','{}','project-input'),
      ($10,$2,null,$11,'ready','{}',array[$4::uuid],jsonb_build_object('owner_id',$5::text),'planned-input'),
       ($12,$2,null,$13,'ready','{}',array[$14::uuid],jsonb_build_object('owner_id',null),'null-owner-planned-input')`,
       [id(200),id(110),id(10),id(11),id(2),id(201),id(12),id(3),id(202),id(203),id(210),id(204),id(211),id(15)]);

    await t.test('owner/admin/new-table RLS, no anon access, no authenticated RPC or briefing writes', async () => {
      for (const table of ['clients','projects','transcript_chunks','briefings']) {
        await assert.rejects(asRole(db,'anon',null,`select * from ${table}`),{code:'42501'});
        const rows = await asRole(db,'authenticated',id(2),`select * from ${table}`);
        assert.ok(rows.rows.length > 0);
        await assert.rejects(asRole(db,'authenticated',id(2),`truncate ${table}`),{code:'42501'});
      }
       await assert.rejects(asRole(db,'anon',null,'select * from planned_meetings'),{code:'42501'});
       await assert.rejects(asRole(db,'authenticated',id(2),'truncate planned_meetings'),{code:'42501'});
       await assert.rejects(asRole(db,'authenticated',id(2),"insert into planned_meetings(project_id,title,scheduled_for) values($1,'Nope',now())",[id(110)]),{code:'42501'});
       assert.equal((await asRole(db,'authenticated',id(2),"update planned_meetings set title='Nope' where id=$1 returning id",[id(210)])).rows.length,0);
       assert.equal((await asRole(db,'authenticated',id(2),"delete from planned_meetings where id=$1 returning id",[id(210)])).rows.length,0);
      const chunks = (await asRole(db,'authenticated',id(2),'select distinct meeting_id from transcript_chunks')).rows;
      assert.deepEqual(chunks.map((c)=>c.meeting_id).sort(),[id(10),id(11),id(13)]);
      assert.deepEqual((await asRole(db,'authenticated',id(2),'select id from planned_meetings')).rows,[{id:id(210)}]);
      assert.deepEqual((await asRole(db,'authenticated',id(1),'select id from planned_meetings order by id')).rows,[{id:id(210)},{id:id(211)}]);
      assert.deepEqual((await asRole(db,'authenticated',id(3),'select id from planned_meetings')).rows,[]);
      assert.deepEqual((await asRole(db,'authenticated',id(2),'select id from briefings order by id')).rows,[{id:id(200)},{id:id(203)}]);
      assert.deepEqual((await asRole(db,'authenticated',id(3),'select id from briefings')).rows,[{id:id(201)}]);
      assert.equal((await asRole(db,'authenticated',id(1),'select id from briefings')).rows.length,5);
      assert.equal((await asRole(db,'authenticated',id(2),'select id from briefings where id=$1',[id(204)])).rows.length,0);
      assert.equal((await asRole(db,'authenticated',id(3),'select id from meetings where id=$1',[id(10)])).rows.length,0);
      await assert.rejects(asRole(db,'authenticated',id(2),"insert into clients(name) values('Forbidden')"),{code:'42501'});
      await assert.rejects(asRole(db,'authenticated',id(1),"insert into briefings(project_id) values($1)",[id(110)]),{code:'42501'});
      await assert.rejects(asRole(db,'authenticated',id(2),`select * from match_transcript_chunks($1,$2::extensions.vector)`,[id(110),embedding]),{code:'42501'});
      await asRole(db,'authenticated',id(1),"insert into clients(name) values('Admin created')");
    });

    await t.test('exact filtered retrieval fills 24 rows; isolates project, owner and null-owner target', async () => {
      const run = (owner,exclude) => asRole(db,'service_role',null,
        'select * from match_transcript_chunks($1,$2::extensions.vector,$3,$4,24)',[id(110),embedding,owner,exclude]);
      const result = await run(id(2),id(10));
      assert.equal(result.rows.length,24);
      assert.ok(result.rows.every((r)=>r.meeting_id===id(11)));
      assert.ok((await run(null,id(14))).rows.every((r)=>r.meeting_id===id(15)));
      assert.ok((await run(null,null)).rows.every((r)=>r.meeting_id!==id(13)));
    });

    await t.test('planned retrieval keeps explicit NULL-owner scope and CAS linking', async () => {
      const plannedChunks = (owner,planned) => asRole(db,'service_role',null,
        'select * from match_planned_meeting_chunks($1,$2,$3,$4::extensions.vector,24)',
        [planned,id(110),owner,embedding]);
      const nullOwner = await plannedChunks(null,id(211));
      assert.equal(nullOwner.rows.length,24);
      assert.ok(nullOwner.rows.every((r)=>r.meeting_id===id(15)));
      const owned = await plannedChunks(id(2),id(210));
      assert.equal(owned.rows.length,24);
      assert.ok(owned.rows.every((r)=>[id(10),id(11)].includes(r.meeting_id)));
      await assert.rejects(asRole(db,'authenticated',id(2),
        'select * from match_planned_meeting_chunks($1,$2,$3,$4::extensions.vector,24)',
        [id(210),id(110),id(2),embedding]),{code:'42501'});
      await assert.rejects(asRole(db,'authenticated',id(2),
        'select link_planned_meeting($1,$2)',[id(210),id(17)]),{code:'42501'});
       await db.query(`insert into planned_meetings(id,project_id,user_id,title,agenda,scheduled_for,meeting_url,status,created_by)
         values($1,$2,$3,'Admin plan',null,'2026-10-22T10:00:00Z','https://meet.google.com/admin-plan','planned',$3)`,[id(213),id(110),id(1)]);
       await db.query(`insert into meetings(id,bot_id,user_id,status,title,project_id) values($1,'admin-planned-bot',$2,'pending','Admin plan',$3)`,[id(18),id(1),id(110)]);
       assert.deepEqual((await asRole(db,'service_role',null,
         'select link_planned_meeting($1,$2) linked',[id(213),id(18)])).rows,[{linked:true}]);
       assert.deepEqual((await db.query('select linked_meeting_id,status from planned_meetings where id=$1',[id(213)])).rows,
         [{linked_meeting_id:id(18),status:'linked'}]);

      await db.query(`insert into meetings(id,bot_id,user_id,status,title,project_id) values($1,'planned-bot',$2,'pending','Alice plan',$3)`,[id(17),id(2),id(110)]);
      assert.deepEqual((await asRole(db,'service_role',null,
        'select link_planned_meeting($1,$2) linked',[id(210),id(17)])).rows,[{linked:true}]);
      assert.deepEqual((await db.query('select linked_meeting_id,status from planned_meetings where id=$1',[id(210)])).rows,
        [{linked_meeting_id:id(17),status:'linked'}]);
      assert.deepEqual((await asRole(db,'service_role',null,
        'select link_planned_meeting($1,$2) linked',[id(210),id(17)])).rows,[{linked:false}]);

       await db.query(`insert into planned_meetings(id,project_id,user_id,title,agenda,scheduled_for,meeting_url,status,created_by)
         values($1,$2,$3,'CAS plan',null,'2026-10-23T10:00:00Z','https://meet.google.com/cas-plan','planned',$3)`,[id(212),id(110),id(2)]);
       await db.query(`insert into meetings(id,bot_id,user_id,status,title,project_id) values($1,'cas-bot',$2,'pending','CAS plan',$3)`,[id(19),id(2),id(111)]);
       assert.deepEqual((await asRole(db,'service_role',null,
         'select link_planned_meeting($1,$2) linked',[id(212),id(19)])).rows,[{linked:false}]);
       await db.query('update meetings set project_id=$1 where id=$2',[id(110),id(19)]);
       await db.query('update planned_meetings set status=$1 where id=$2',['cancelled',id(212)]);
       assert.deepEqual((await asRole(db,'service_role',null,
         'select link_planned_meeting($1,$2) linked',[id(212),id(19)])).rows,[{linked:false}]);
    });

    await t.test('saved briefings become unreadable after source/target scope changes', async () => {
      await db.query('update meetings set user_id=$1 where id=$2',[id(3),id(11)]);
      assert.equal((await asRole(db,'authenticated',id(2),'select id from briefings where id=$1',[id(200)])).rows.length,0);
      await db.query('update meetings set user_id=$1 where id=$2',[id(2),id(11)]);
      await db.query('update meetings set project_id=$1 where id=$2',[id(111),id(10)]);
      assert.equal((await asRole(db,'authenticated',id(2),'select id from briefings where id=$1',[id(200)])).rows.length,0);
      await db.query('update meetings set project_id=$1 where id=$2',[id(110),id(10)]);
    });

    await t.test('briefing cache uniqueness includes target; refresh CAS rejects stale claims', async () => {
      await assert.rejects(db.query(`insert into briefings(project_id,meeting_id,input_hash) values($1,$2,'same-input')`,[id(110),id(10)]),{code:'23505'});
      await db.query(`insert into briefings(id,project_id,planned_meeting_id,input_hash) values($1,$2,$3,'same-planned-input')`,[id(205),id(110),id(211)]);
      await assert.rejects(db.query(`insert into briefings(id,project_id,planned_meeting_id,input_hash) values($1,$2,$3,'same-planned-input')`,[id(206),id(110),id(211)]),{code:'23505'});
      const old = (await db.query('select updated_at::text from briefings where id=$1',[id(200)])).rows[0].updated_at;
      assert.equal((await db.query("update briefings set status='generating' where id=$1 and updated_at=$2 returning id",[id(200),old])).rows.length,1);
      assert.equal((await db.query("update briefings set status='generating' where id=$1 and updated_at=$2 returning id",[id(200),old])).rows.length,0);
    });

    await t.test('partial-index task upsert retains legacy identity and manual edits; empty analysis cleans only AI rows', async () => {
      const task = {task:'Ship release',assignee:'Alice',due_day:null,due_date:null,status:'pending',fingerprint:'fp-release',
        normalized_task:'ship release',normalized_assignee:'alice',assignee_user_id:id(2)};
      const persist = (items,updates=[]) => asRole(db,'service_role',null,
        'select context_persist_action_items($1,$2::jsonb,$3::jsonb)',[id(11),JSON.stringify(items),JSON.stringify(updates)]);
      await persist([task]); await persist([task]);
      assert.deepEqual((await db.query('select id from action_items where meeting_id=$1',[id(11)])).rows,[{id:id(40)}]);
      await db.query("update action_items set task='Manually edited release',status='completed',status_source='manual' where id=$1",[id(40)]);
      await persist([{...task,status:'pending'}]);
      let saved=(await db.query('select * from action_items where id=$1',[id(40)])).rows[0];
      assert.equal(saved.task,'Manually edited release'); assert.equal(saved.status,'completed');
      await persist([task,{...task,task:'Temporary AI task',fingerprint:'fp-temp',normalized_task:'temporary ai task'}]);
      await persist([]);
      saved=(await db.query('select * from action_items where meeting_id=$1',[id(11)])).rows;
      assert.equal(saved.length,1); assert.equal(saved[0].status_source,'manual');
    });

    await t.test('carryover respects manual status and owner/project boundaries; source mirror updated', async () => {
      for (const [taskId,meetingId] of [[41,11],[42,12],[43,13]]) {
        await db.query(`insert into action_items(id,meeting_id,task,status) values($1,$2,'Follow up','pending')`,[id(taskId),id(meetingId)]);
        await db.query(`update meetings set action_items='[{"task":"Follow up","assignee":null,"status":"pending"}]' where id=$1`,[id(meetingId)]);
      }
      await asRole(db,'service_role',null,'select context_persist_action_items($1,$2::jsonb,$3::jsonb)',[id(10),'[]',JSON.stringify(
        [40,41,42,43].map((n)=>({task_id:id(n),status:'completed',evidence:'We have finished the follow up.'})))]);
      const tasks=(await db.query('select id,status,completed_at from action_items where id=any($1::uuid[]) order by id',[[id(41),id(42),id(43)]])).rows;
      assert.equal(tasks[0].status,'completed'); assert.ok(tasks[0].completed_at);
      assert.equal(tasks[1].status,'pending'); assert.equal(tasks[2].status,'pending');
      assert.equal((await db.query('select action_items from meetings where id=$1',[id(11)])).rows[0].action_items[0].status,'completed');
    });

    await t.test('index lease fencing, content-hash no-op and leftover cleanup preserve meeting status', async () => {
      const lease='2026-10-03T12:00:00Z';
      await db.query("update meetings set context_status='processing',context_started_at=$1 where id=$2",[lease,id(11)]);
      const commit=(started,chunks,count)=>asRole(db,'service_role',null,'select context_commit_chunks($1,$2,$3::jsonb,$4) ok',[id(11),started,JSON.stringify(chunks),count]);
      assert.equal((await commit('2026-10-03T11:59:00Z',[],0)).rows[0].ok,false);
      assert.equal((await db.query('select count(*)::int n from transcript_chunks where meeting_id=$1',[id(11)])).rows[0].n,30);
      const beforeId=(await db.query('select id from transcript_chunks where meeting_id=$1 and chunk_index=0',[id(11)])).rows[0].id;
      assert.equal((await commit(lease,[],1)).rows[0].ok,true);
      assert.equal((await db.query('select id from transcript_chunks where meeting_id=$1',[id(11)])).rows[0].id,beforeId);
      assert.equal((await db.query('select status,context_status from meetings where id=$1',[id(11)])).rows[0].status,'summarized');
    });

    await t.test('separate transcript backfill rebuilds only matching counts and reruns as no-op', async () => {
      await db.query("insert into transcripts(meeting_id,text) values($1,'Mismatched legacy row')",[id(16)]);
      const backfill=await sql('context_transcript_backfill.sql');
      await db.exec(backfill);
      const rows=()=>db.query('select id,segment_index,start_time,end_time from transcripts where meeting_id=$1 order by segment_index',[id(11)]);
      const first=(await rows()).rows;
      assert.deepEqual(first.map((r)=>r.segment_index),[0,1]);
      assert.deepEqual(first.map((r)=>r.start_time),[0,6]);
      await db.exec(backfill);
      assert.deepEqual((await rows()).rows,first);
      assert.equal((await db.query('select segment_index from transcripts where meeting_id=$1',[id(16)])).rows[0].segment_index,null);
      assert.equal((await db.query('select count(*)::int n from summaries where meeting_id=$1',[id(11)])).rows[0].n,2);
    });
  } finally { await db.close(); }
});
