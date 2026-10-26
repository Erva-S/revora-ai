import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const id = '00000000-0000-4000-8000-000000000001';
const bot = '00000000-0000-4000-8000-000000000002';
const lease = '00000000-0000-4000-8000-000000000003';
const owner = '00000000-0000-4000-8000-000000000004';

for (const context of [false,true]) test(`atomic pipeline migration (${context ? 'with' : 'without'} optional context columns)`, async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon,authenticated,service_role;
      create table meetings(id uuid primary key,user_id uuid,bot_id text unique,title text,meeting_url text,platform text,
        status text default 'pending',transcript text,transcript_segments jsonb,transcription_provider text,
        transcript_metrics jsonb,processing_stage text,error_message text,duration_secs int,
        ended_at timestamptz,started_at timestamptz,raw_payload jsonb);
      create table transcripts(id uuid primary key default gen_random_uuid(),meeting_id uuid references meetings(id),
        speaker text not null,text text not null,timestamp timestamptz default now());
      grant select,insert,update,delete on meetings,transcripts to service_role;
      grant select on meetings to authenticated;`);
    if (context) await db.exec('alter table transcripts add column segment_index int,add column start_time float8,add column end_time float8;');
    await db.query('insert into meetings(id,bot_id,user_id,transcript,raw_payload) values($1,$2,$3,$4,$5)',
      [id,bot,owner,'Older longer transcript', {event:'bot.completed',data:{bot_id:bot,transcription:{secret_raw:'private source'},status:{code:'completed'}}}]);
    const provenance = await readFile(new URL('../migrations/20261005010000_transcript_provenance.sql',import.meta.url),'utf8');
    const migration = await readFile(new URL('../migrations/20261008000000_meeting_pipeline_integrity.sql',import.meta.url),'utf8');
    await db.exec(provenance); await db.query('update meetings set raw_transcription=$1,raw_diarization=$2',[{text:'raw words'},'raw timeline']);
    await db.exec(migration); await db.exec(migration);
    const asRole = (role,query,params=[]) => db.transaction(async tx => { await tx.exec(`set local role ${role}`); return tx.query(query,params); });
    const claim = (token=lease,reprocess=false,targetBot=bot) => asRole('service_role','select claim_meeting_transcript($1,$2,$3,$4) state',[id,targetBot,token,reprocess]);
    const turns = [{speaker:'Speaker 1',text:'Hello there',start_time:0,end_time:1},{speaker:'Speaker 2',text:'Yes',start_time:0.5,end_time:2,contested:true}];
    const persist = (value=turns,targetBot=bot) => asRole('service_role','select persist_meeting_transcript($1,$2,$3,$4,$5)',[id,targetBot,lease,value,{transcription_provider:'elevenlabs',transcript_metrics:{sourceWordCount:3,finalWordCount:3}}]);
    await t.test('raw data is archived once, service-only, and absent from browser select(*)',async()=>{
      const row = (await asRole('authenticated','select * from meetings')).rows[0];
      assert.equal(row.transcript,'Older longer transcript'); assert.equal(row.raw_transcription,null); assert.equal(row.raw_diarization,null);
      assert.ok(!JSON.stringify(row.raw_payload).includes('private source'));
      assert.equal((await asRole('service_role','select count(*)::int n from meeting_transcript_sources')).rows[0].n,1);
      await assert.rejects(asRole('authenticated','select * from meeting_transcript_sources'),{code:'42501'});
      await assert.rejects(asRole('anon','select claim_meeting_transcript($1,$2,$3,false)',[id,bot,lease]),{code:'42501'});
    });
    await t.test('lease excludes concurrent completion; wrong bot cannot claim or persist',async()=>{
      assert.equal((await claim()).rows[0].state,'claimed');
      assert.equal((await claim(owner)).rows[0].state,'processing');
      await assert.rejects(claim(owner,false,'another-bot'),/mismatch/);
      await assert.rejects(persist(turns,'another-bot'),/mismatch/);
    });
    await t.test('text, segments and ordered rows commit together; shorter corrected text replaces older data',async()=>{
      await persist();
      const meeting = (await db.query('select * from meetings')).rows[0];
      assert.deepEqual(meeting.transcript_segments,turns); assert.equal(meeting.transcript,'Speaker 1: Hello there\nSpeaker 2: Yes');
      const rows = (await db.query('select * from transcripts order by turn_index')).rows;
      assert.deepEqual(rows.map(r=>[r.turn_index,r.speaker,r.text,Number(r.start_seconds),Number(r.end_seconds)]),[[0,'Speaker 1','Hello there',0,1],[1,'Speaker 2','Yes',0.5,2]]);
      if(context) assert.deepEqual(rows.map(r=>r.segment_index),[0,1]);
    });
    await t.test('failed child insertion rolls back every transcript representation',async()=>{
      await assert.rejects(persist([{speaker:null,text:'broken'}]),{code:'23502'});
      assert.equal((await db.query('select transcript from meetings')).rows[0].transcript,'Speaker 1: Hello there\nSpeaker 2: Yes');
      assert.equal((await db.query('select count(*)::int n from transcripts')).rows[0].n,2);
    });
    await t.test('reprocess is idempotent and empty final result clears old rows',async()=>{
      await persist(); assert.equal((await db.query('select count(*)::int n from transcripts')).rows[0].n,2);
      await persist([]); assert.equal((await db.query('select transcript from meetings')).rows[0].transcript,'');
      assert.equal((await db.query('select count(*)::int n from transcripts')).rows[0].n,0);
      await db.exec("update meetings set transcript_processing_token=null,processing_stage='completed'");
      assert.equal((await claim()).rows[0].state,'completed'); assert.equal((await claim(lease,true)).rows[0].state,'claimed');
    });
    await t.test('bot-id upsert attaches ownership without erasing earlier webhook content',async()=>{
      await db.query('update meetings set user_id=null,transcript=$1,status=$2',["Speaker 1: preserved",'summarized']);
      await db.query(`insert into meetings(id,bot_id,user_id,title,meeting_url,platform) values(gen_random_uuid(),$1,$2,'Assigned','https://meet.test','google_meet')
        on conflict(bot_id) do update set user_id=excluded.user_id,title=excluded.title,meeting_url=excluded.meeting_url,platform=excluded.platform`,[bot,owner]);
      const rows = (await db.query('select * from meetings')).rows;
      assert.equal(rows.length,1); assert.equal(rows[0].user_id,owner); assert.equal(rows[0].transcript,'Speaker 1: preserved'); assert.equal(rows[0].status,'summarized');
    });
  } finally { await db.close(); }
});
