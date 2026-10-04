import assert from 'node:assert/strict';
import { chunkTranscript, MAX_CHARS, transcriptTurns } from '../functions/_shared/chunker.ts';
import { briefingPrompt, buildBriefingContext, packRelationalContext, rankChunks, validateBriefing } from '../functions/_shared/briefing-context.ts';
import { estimateTokens, fingerprintTask } from '../functions/_shared/context-utils.ts';
import { embedTexts, generateJson } from '../functions/_shared/gemini.ts';
import { validateTaskUpdates } from '../functions/_shared/context-tasks.ts';
import { indexMeeting } from '../functions/_shared/indexer.ts';
import { authenticate } from '../functions/_shared/context-http.ts';
import { MemoryDb } from './context-fakes.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const synthetic = () => Array.from({ length: 1080 }, (_, i) => ({ speaker: i % 2 ? 'Alice' : 'Bob',
  text: `Turn ${i}: We reviewed the project delivery, assigned the next implementation milestone, and discussed outstanding risks with the release team. `.repeat(2),
  start_time: i * 10, end_time: i * 10 + 9 }));

Deno.test('three-hour transcript: bounded chunks, timing, overlap, all turns covered, deterministic rerun', () => {
  const turns=transcriptTurns(synthetic(),null);
  const chunks=chunkTranscript(turns);
  assert.ok(chunks.length>100 && chunks.length<=400);
  assert.ok(chunks.every((c)=>c.text.length>=40 && c.text.length<=MAX_CHARS && c.token_estimate<=500));
  for (const [i,turn] of turns.entries()) assert.ok(chunks.some((c)=>c.first_segment_index<=i && c.last_segment_index>=i && c.text.includes(turn.text)));
  assert.equal(chunks[0].start_time,0); assert.equal(chunks.at(-1)!.end_time,10799);
  assert.ok(chunks.slice(1).every((c,i)=>c.first_segment_index===chunks[i].last_segment_index));
  assert.deepEqual(chunkTranscript(turns),chunks);
  console.log(`3-hour synthetic transcript: ${turns.length} turns, ${chunks.length} chunks, max ${Math.max(...chunks.map(c=>c.token_estimate))} estimated tokens.`);
});

Deno.test('oversized turns/sentences retain content, fallback lines have no invented times, caps fail explicitly', () => {
  const text='First sentence.Second sentence! '+ 'word '.repeat(1800) + 'finalword.';
  const chunks=chunkTranscript(transcriptTurns([{speaker:'A',text,start_time:1,end_time:99}],null));
  assert.ok(chunks.every((c)=>c.text.length<=MAX_CHARS && c.first_segment_index===0));
  assert.ok(chunks.some(c=>c.text.includes('First sentence.')));
  assert.ok(chunks.some(c=>c.text.includes('Second sentence!')));
  assert.ok(chunks.some(c=>c.text.includes('finalword.')));
  assert.ok(transcriptTurns(null,'Alice: hello\nplain line').every(t=>t.start_time===null));
  assert.equal(chunkTranscript(transcriptTurns(null,'Hi')).length,0);
  assert.throws(()=>chunkTranscript(transcriptTurns(Array.from({length:401},()=>({speaker:'A',text:'x'.repeat(1900)})),null)),/400-chunk/);
});

Deno.test('budget priority, empty/one/many history and hallucinated reference rejection', () => {
  const target={project:'P',client:'C',title:'Next sync',agenda:'Release',scheduled_for:null};
  const empty=packRelationalContext(target,[],[],7000);
  assert.deepEqual(empty.recent_meetings,[]);
  const meetings=Array.from({length:30},(_,i)=>({id:id(i+10),title:`Meeting ${i}`,created_at:'2026-10-01',updated_at:'2026-10-01',
    summaries:[{id:id(i+50),created_at:'2026-10-01',executive_summary:'A real summary. '.repeat(100),key_decisions:['Ship on the agreed date.'],open_questions:['Which owner?']}]}));
  const tasks=Array.from({length:40},(_,i)=>({id:id(i+100),meeting_id:id(10),task:'Complete the committed work. '.repeat(10),assignee:'Alice',due_date:null,status:'pending'}));
  const context=packRelationalContext(target,tasks,meetings,2000);
  assert.ok(estimateTokens(briefingPrompt(context))<=2000);
  assert.ok(context.open_tasks.length>0 && context.open_tasks.length<30);
  assert.equal(context.recent_meetings.length,0);
  const one=packRelationalContext(target,tasks.slice(0,1),meetings.slice(0,1),7000);
  assert.equal(one.recent_meetings.length,1);
  const many=packRelationalContext(target,[],meetings,7000);
  assert.equal(many.recent_meetings.length,3); assert.equal(many.older_meetings.length,10);
  const valid=validateBriefing({headline:`History ${id(999)}`,since_last_meeting:[{text:'Real discussion',meeting_ids:[id(10),id(999)]},null],
    open_tasks:[{task_id:id(100),assignee:'Invented person',due:'2099-01-01',status:'completed'},{task_id:id(999)}]},one);
  assert.deepEqual(valid.since_last_meeting[0].meeting_ids,[id(10)]);
  assert.equal(valid.open_tasks.length,1); assert.equal(valid.open_tasks[0].assignee,'Alice'); assert.equal(valid.open_tasks[0].status,'pending');
  assert.ok(!valid.headline.includes(id(999)));
});

Deno.test('recency reranking caps eight excerpts and two per meeting', () => {
  const chunks=Array.from({length:24},(_,i)=>({id:id(i),meeting_id:id(100+Math.floor(i/4)),similarity:0.8,meeting_date:'2026-10-01'}));
  const ranked=rankChunks(chunks,Date.parse('2026-10-03'));
  assert.equal(ranked.length,8);
  for (const chunk of ranked) assert.ok(ranked.filter(c=>c.meeting_id===chunk.meeting_id).length<=2);
});

Deno.test('task fingerprints normalize whitespace/case; carryover rejects unknown IDs and invented evidence', async () => {
  assert.equal(await fingerprintTask('  Ship   Release ','ALICE'),await fingerprintTask('ship release','Alice'));
  const tasks=[{id:id(1),task:'Ship release',assignee:'Alice',due_date:null,status:'pending'}];
  const transcript='Alice: We finished the release yesterday and verified all checks.';
  const updates=validateTaskUpdates([
    {task_id:id(1),status:'completed',evidence:'We finished the release yesterday'},
    {task_id:id(2),status:'completed',evidence:'We finished the release yesterday'},
    {task_id:id(1),status:'completed',evidence:'It was completed in a different meeting'},
  ],tasks,transcript);
  assert.equal(updates.length,1); assert.equal(updates[0].task_id,id(1));
});

Deno.test('Gemini batching <=100, bounded concurrency, normalization, retries and model fallback', async () => {
  const original=globalThis.fetch;
  const previous=Deno.env.get('GEMINI_API_KEY');
  Deno.env.set('GEMINI_API_KEY','test-only-placeholder');
  let requests=0; let active=0; let maxActive=0;
  const batchSizes: number[]=[];
  try {
    globalThis.fetch=async (_url,init) => {
      const request=++requests; active++; maxActive=Math.max(maxActive,active);
      const body=JSON.parse(String(init?.body));
      batchSizes.push(body.requests.length);
      await new Promise(r=>setTimeout(r,1)); active--;
      if (request===1) return new Response('',{status:429});
      return Response.json({embeddings:body.requests.map(()=>({values:[2,...Array(767).fill(0)]}))});
    };
    const embeddings=await embedTexts(Array.from({length:250},()=> 'test document'),'RETRIEVAL_DOCUMENT');
    assert.equal(embeddings.length,250); assert.ok(batchSizes.every(n=>n<=100)); assert.ok(maxActive<=2);
    assert.equal(requests,4);
    assert.equal(embeddings[0][0],1);
    let textCalls=0;
    globalThis.fetch=async () => ++textCalls===1 ? new Response('',{status:404}) : Response.json({candidates:[{content:{parts:[{text:'{"headline":"grounded"}'}]}}]});
    const generated=await generateJson('test context');
    assert.equal((generated.value as any).headline,'grounded'); assert.equal(textCalls,2);
    globalThis.fetch=async()=>new Response('',{status:400});
    await assert.rejects(embedTexts(['test'],'RETRIEVAL_QUERY'),/HTTP 400/);
  } finally {
    globalThis.fetch=original;
    if (previous===undefined) Deno.env.delete('GEMINI_API_KEY'); else Deno.env.set('GEMINI_API_KEY',previous);
  }
});

Deno.test('index orchestration: 3-hour embedding batches, rerun no-op, duplicate lease, failure isolation', async () => {
  const original=globalThis.fetch;
  Deno.env.set('GEMINI_API_KEY','test-only-placeholder');
  const db=new MemoryDb({ meetings:[{id:id(1),title:'Three hour sync',status:'summarized',summary:'Saved summary',
    action_items:[{task:'Keep me'}],started_at:null,created_at:'2026-10-01',updated_at:'2026-10-01',
    transcript_segments:synthetic(),context_status:'pending',context_started_at:null}],transcript_chunks:[] });
  let calls=0;
  try {
    globalThis.fetch=async(_url,init)=>{
      calls++; const body=JSON.parse(String(init?.body)); assert.ok(body.requests.length<=100);
      assert.ok(body.requests.every((r: any)=>r.taskType==='RETRIEVAL_DOCUMENT' && r.content.parts[0].text.startsWith('Meeting:')));
      return Response.json({embeddings:body.requests.map(()=>({values:[1,...Array(767).fill(0)]}))});
    };
    const first=await indexMeeting(db,id(1)); assert.equal(first.status,'ready'); assert.equal(calls,3);
    const writes=db.writes;
    const again=await indexMeeting(db,id(1)); assert.equal(again.noop,true); assert.equal(calls,3); assert.equal(db.writes,writes);
    db.tables.meetings[0].context_status='processing'; db.tables.meetings[0].context_started_at=new Date().toISOString();
    assert.equal((await indexMeeting(db,id(1))).duplicate,true);
    db.tables.meetings[0].context_started_at='2026-01-01'; // stale lease can be reclaimed
    db.tables.meetings[0].transcript_segments[0].text+=' Changed content.';
    globalThis.fetch=async()=>new Response('',{status:400});
    const failed=await indexMeeting(db,id(1)); assert.equal(failed.success,false);
    const meeting=db.tables.meetings[0];
    assert.equal(meeting.context_status,'failed'); assert.equal(meeting.status,'summarized'); assert.equal(meeting.summary,'Saved summary');
    assert.equal(db.tables.transcript_chunks.length,216); assert.deepEqual(meeting.action_items,[{task:'Keep me'}]);
  } finally { globalThis.fetch=original; Deno.env.delete('GEMINI_API_KEY'); }
});

Deno.test('briefing relational isolation, embedding outage fallback, input hash invalidation', async () => {
  const original=globalThis.fetch;
  Deno.env.set('GEMINI_API_KEY','test-only-placeholder');
  const meetings=[
    {id:id(10),project_id:id(100),user_id:id(2)}, {id:id(11),project_id:id(100),user_id:id(2)},
    {id:id(12),project_id:id(100),user_id:id(3)}, {id:id(13),project_id:id(101),user_id:id(2)},
  ].map(m=>({...m,status:'summarized',title:`Meeting ${m.id}`,summary:'Real meeting summary',started_at:null,created_at:'2026-10-01',updated_at:'2026-10-01',summaries:[]}));
  const task={id:id(200),meeting_id:id(11),task:'Ship release',assignee:'Alice',status:'pending',due_date:null,updated_at:'2026-10-01',meetings:meetings[1]};
  const db=new MemoryDb({projects:[{id:id(100),name:'P',clients:{name:'C'}}],meetings,action_items:[task],transcript_chunks:[]});
  const scope={projectId:id(100),meetingId:id(10),ownerId:id(2),title:'Sync',agenda:'Release',scheduledFor:null};
  try {
    globalThis.fetch=async()=>{throw new Error('No external calls expected without indexed history');};
    const first=await buildBriefingContext(db,scope);
    assert.deepEqual(first.sourceIds,[id(11)]);
    assert.equal((await buildBriefingContext(db,scope)).inputHash,first.inputHash);
    assert.notEqual((await buildBriefingContext(db,{...scope,agenda:'New agenda'})).inputHash,first.inputHash);
    task.status='in_progress';
    assert.notEqual((await buildBriefingContext(db,scope)).inputHash,first.inputHash);
    db.tables.transcript_chunks=[{id:id(300),meeting_id:id(11),embedding:'vector',meetings:meetings[1]}];
    globalThis.fetch=async()=>new Response('',{status:400});
    const fallback=await buildBriefingContext(db,scope);
    assert.equal(fallback.vectorFallback,true); assert.deepEqual(fallback.sourceIds,[id(11)]);
    const project=await buildBriefingContext(db,{...scope,meetingId:null,ownerId:null});
    assert.deepEqual(project.sourceIds,[id(10),id(11),id(12)]);
  } finally { globalThis.fetch=original; Deno.env.delete('GEMINI_API_KEY'); }
});

Deno.test('auth: exact service secret, user verification, role lookup and user-scoped client', async () => {
  const original=globalThis.fetch;
  const names=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY'];
  const previous=names.map(n=>Deno.env.get(n));
  Deno.env.set(names[0],'https://context-tests.invalid'); Deno.env.set(names[1],'test-service-secret'); Deno.env.set(names[2],'test-anon-key');
  const request=(token: string)=>new Request('https://context-tests.invalid/function',{headers:{Authorization:`Bearer ${token}`}});
  try {
    const service=await authenticate(request('test-service-secret'),true); assert.equal(service.isService,true);
    globalThis.fetch=async()=>Response.json({message:'Invalid session'},{status:401});
    await assert.rejects(authenticate(request('forged-admin-jwt'),true),/Invalid user session/);
    globalThis.fetch=async(url,init)=>{
      if (String(url).includes('/auth/v1/user')) return Response.json({id:id(2),aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01'});
      if (String(url).includes('/profiles')) return Response.json({role:'user'});
      assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer real-user-token');
      return Response.json([]);
    };
    const user=await authenticate(request('real-user-token'),true);
    assert.equal(user.isAdmin,false); assert.equal(user.isService,false); assert.equal(user.userId,id(2));
    const target=await user.user!.from('meetings').select('*').eq('id',id(10)).maybeSingle(); assert.equal(target.data,null);
  } finally { globalThis.fetch=original; names.forEach((n,i)=>previous[i]===undefined ? Deno.env.delete(n) : Deno.env.set(n,previous[i]!)); }
});
