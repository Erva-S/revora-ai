import assert from 'node:assert/strict';
import { handler } from './capture-server.ts';
import '../functions/meetingbaas-webhook/index.ts';
import { fingerprintTask } from '../functions/_shared/context-utils.ts';

const meetingId='00000000-0000-4000-8000-000000000010';
const userId='00000000-0000-4000-8000-000000000002';
const makeRequest=()=>new Request('https://context-tests.invalid/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-mb-secret':'test-secret'},
  body:JSON.stringify({event:'bot.completed',data:{bot_id:'test-bot',created_at:'2026-10-01',duration_seconds:60,
    participants:[{id:1,name:'Alice'}],transcription:[{speaker:'Alice',text:'I will ship the release tomorrow. We still need a decision about support.',start:0,end:15}]}})});

async function environment(run: ()=>Promise<void>) {
  const names=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','MEETINGBAAS_WEBHOOK_SECRET','GEMINI_API_KEY','ENABLE_TASK_CARRYOVER'];
  const previous=names.map(n=>Deno.env.get(n));
  const original=globalThis.fetch;
  const runtime=(globalThis as any).EdgeRuntime;
  names.forEach((n,i)=>Deno.env.set(n,['https://context-tests.invalid','test-service','test-secret','test-gemini','false'][i]));
  try { await run(); } finally {
    globalThis.fetch=original; (globalThis as any).EdgeRuntime=runtime;
    names.forEach((n,i)=>previous[i]===undefined ? Deno.env.delete(n) : Deno.env.set(n,previous[i]!));
  }
}

Deno.test('real webhook duplicate guards skip summarized and completed-with-content deliveries',()=>environment(async()=>{
  for (const meeting of [{status:'summarized',summary:null,transcript:null},{status:'completed',summary:null,transcript:'Already captured'}]) {
    let requests=0;
    globalThis.fetch=async(url,init)=>{
      requests++; assert.ok(String(url).includes('/rest/v1/meetings'));
      assert.equal(init?.method,'GET');
      return Response.json([{id:meetingId,...meeting}]);
    };
    const response=await handler(makeRequest());
    assert.equal(response.status,200); assert.equal((await response.json()).duplicate,true);
    assert.equal(requests,1); // no transcript, summary, task, chunk or Gemini writes
  }
}));

for (const migrated of [true,false]) Deno.test(`real webhook completion ${migrated ? 'with context schema and failed index dispatch' : 'before context migration'} preserves meeting pipeline`,()=>environment(async()=>{
  const meeting: any={id:meetingId,bot_id:'test-bot',user_id:userId,status:'pending',summary:null,transcript:null};
  let transcriptRows: any[]=[]; let summaryRows: any[]=[]; let taskRows: any[]=[]; let rpcRows: any[]=[];
  const background: Promise<unknown>[]=[];
  (globalThis as any).EdgeRuntime={waitUntil:(promise: Promise<unknown>)=>background.push(promise)};
  const analysis={executive_summary:'Alice committed to a release; support remains unresolved.',key_topics:['Release'],key_decisions:['Ship the release'],
    open_questions:['Who handles support?'],sentiment:'positive',action_items:[{task:'Ship the release',assignee:'Alice',due_day:'tomorrow',due_date:'2026-10-02',status:'pending'}]};
  const missing=()=>Response.json({code:'PGRST204',message:'Could not find optional column in the schema cache'},{status:400});
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input)); const method=init?.method || 'GET';
    const body=init?.body ? JSON.parse(String(init.body)) : null;
    if (url.hostname==='generativelanguage.googleapis.com') {
      assert.ok(body.contents[0].parts[0].text.includes('open_questions'));
      return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(analysis)}]}}]});
    }
    if (url.pathname.endsWith('/index-meeting-context')) return Response.json({error:'Simulated index outage'},{status:503});
    if (url.pathname.endsWith('/meetings')) {
      if (method==='GET') return Response.json([meeting]);
      if (!migrated && body.context_status) return missing();
      Object.assign(meeting,body); return Response.json([meeting]);
    }
    if (url.pathname.endsWith('/profiles')) return Response.json([{id:userId,full_name:'Alice',email:'alice@example.test'}]);
    if (url.pathname.endsWith('/transcripts')) {
      if (method==='DELETE') { transcriptRows=[]; return new Response(null,{status:204}); }
      if (!migrated && body[0]?.segment_index!==undefined) return missing();
      transcriptRows=body; return new Response(null,{status:201});
    }
    if (url.pathname.endsWith('/summaries')) {
      if (method==='DELETE') { summaryRows=[]; return new Response(null,{status:204}); }
      if (!migrated && body.key_topics) return missing();
      summaryRows=[body]; return new Response(null,{status:201});
    }
    if (url.pathname.endsWith('/rpc/context_persist_action_items')) {
      if (!migrated) return Response.json({code:'PGRST202',message:'Missing function'},{status:404});
      rpcRows=body.p_items; return new Response(null,{status:204});
    }
    if (url.pathname.endsWith('/action_items')) {
      if (method==='GET') return missing();
      if (method==='DELETE') { taskRows=[]; return new Response(null,{status:204}); }
      taskRows=body; return new Response(null,{status:201});
    }
    throw new Error(`Unexpected transport: ${method} ${url.pathname}`);
  };
  const response=await handler(makeRequest());
  const result=await response.json();
  await Promise.all(background);
  assert.equal(response.status,200); assert.equal(result.status,'summarized');
  assert.equal(meeting.status,'summarized'); assert.equal(meeting.summary,analysis.executive_summary);
  assert.deepEqual(meeting.action_items,analysis.action_items); assert.ok(meeting.transcript.startsWith('Alice: I will ship'));
  assert.equal(transcriptRows.length,1); assert.equal(summaryRows.length,1);
  if (migrated) {
    assert.equal(transcriptRows[0].segment_index,0); assert.equal(transcriptRows[0].start_time,0); assert.equal(transcriptRows[0].end_time,15);
    assert.deepEqual(summaryRows[0].key_topics,['Release']); assert.deepEqual(summaryRows[0].open_questions,['Who handles support?']);
    assert.equal(rpcRows[0].fingerprint,await fingerprintTask('Ship the release','Alice'));
    assert.equal(rpcRows[0].assignee_user_id,userId); assert.equal(meeting.context_status,'failed');
  } else {
    assert.equal(transcriptRows[0].segment_index,undefined); assert.equal(summaryRows[0].key_topics,undefined);
    assert.equal(taskRows.length,1); assert.equal(taskRows[0].task,'Ship the release');
  }
}));
