import assert from 'node:assert/strict';
import { handler } from './capture-server.ts';
import '../functions/meetingbaas-webhook/index.ts';
import { fingerprintTask } from '../functions/_shared/context-utils.ts';

const meetingId='00000000-0000-4000-8000-000000000010';
const userId='00000000-0000-4000-8000-000000000002';
const makeRequest=()=>new Request('https://context-tests.invalid/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-mb-secret':'test-secret'},
  body:JSON.stringify({event:'bot.completed',data:{bot_id:'test-bot',created_at:'2026-10-01',duration_seconds:60,
    mp4:'https://artifacts.example.test/meeting.mp4',audio:'https://artifacts.example.test/meeting.flac',
    transcription_provider:'gladia',joined_at:'2026-10-01T10:00:00Z',exited_at:'2026-10-01T10:01:00Z',
    participants:[{id:1,name:'Alice'},{id:2,name:'Bob'}],transcription:[{speaker:'Alice',text:'I will ship the release tomorrow. We still need a decision about support.',start:0,end:15}]}})});

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
      if (init?.method !== 'GET') {
        const patch=JSON.parse(String(init?.body));
        assert.deepEqual(Object.keys(patch).sort(),['recording_metadata','recording_status','recording_url']);
      }
      return Response.json([{id:meetingId,...meeting}]);
    };
    const response=await handler(makeRequest());
    assert.equal(response.status,200); assert.equal((await response.json()).duplicate,true);
    assert.equal(requests,2); // video metadata only; no transcript/summary/task/Gemini writes
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
      assert.ok(meeting.transcript?.startsWith('Alice: I will ship'), 'transcript saved before Gemini');
      assert.ok(body.contents[0].parts[0].text.includes('open_questions'));
      return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(analysis)}]}}]});
    }
    if (url.pathname.endsWith('/index-meeting-context')) return Response.json({error:'Simulated index outage'},{status:503});
    if (url.pathname.endsWith('/meeting_transcript_sources')) {
      assert.equal(body.payload.webhook_payload.event,'bot.completed');
      assert.deepEqual(body.payload.standardized_transcription,JSON.parse(await makeRequest().text()).data.transcription);
      return new Response(null,{status:201});
    }
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
  assert.equal(meeting.recording_url,'https://artifacts.example.test/meeting.mp4');
  assert.equal(meeting.recording_status,'ready');
  assert.equal(meeting.recording_metadata.format,'mp4');
  assert.equal(meeting.recording_metadata.duration_seconds,60);
  assert.equal(meeting.transcription_provider,'gladia');
  assert.equal(meeting.ended_at,'2026-10-01T10:01:00.000Z');
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

Deno.test('participant/organizer/reconnect/empty attendance notifications never trigger speculative leave', () => environment(async () => {
  const events = [
    { event:'participant.joined', data:{participants:['Alice','Bob']} },
    { event:'participant.left', data:{participants:['Bob'],participant:{name:'Alice'}} },
    { event:'participant.left', data:{participants:[],participant:{name:'Bob'}} },
    { event:'organizer.left', data:{participants:['Bob']} },
    { event:'participant.joined', data:{participants:['Bob']} },
  ];
  globalThis.fetch = async () => { throw new Error('Unsupported events must not call DB or leave APIs'); };
  for (const event of [...events,...events]) {
    const response = await handler(new Request('https://local.test', { method:'POST', headers:{'x-mb-secret':'test-secret'},
      body:JSON.stringify({...event,data:{...event.data,bot_id:'test-bot'}}) }));
    assert.equal(response.status,200);
    assert.equal((await response.json()).ignored,'unsupported event');
  }
}));

Deno.test('native call_ended is recorded once; duplicate and late recording events do not re-eject or regress', () => environment(async () => {
  const meeting: any = { id:meetingId,status:'recording',processing_stage:'meeting_in_progress',ended_at:null,
    raw_payload:null,updated_at:'2026-10-01T10:00:00Z' };
  let writes=0;
  globalThis.fetch=async(input,init)=>{
    assert.ok(String(input).includes('/rest/v1/meetings'), 'no provider leave calls on lifecycle events');
    if(init?.method==='GET')return Response.json([meeting]);
    writes++; Object.assign(meeting,JSON.parse(String(init?.body)));return Response.json([meeting]);
  };
  const status=async(code: string,date: string)=>handler(new Request('https://local.test',{method:'POST',headers:{'x-mb-secret':'test-secret'},
    body:JSON.stringify({event:'bot.status_change',data:{bot_id:'test-bot',participants:[],status:{code,created_at:date}}})}));
  assert.equal((await status('call_ended','2026-10-01T13:00:00Z')).status,200);
  assert.equal(meeting.processing_stage,'meeting_ended');
  assert.equal(meeting.recording_status,'processing');
  assert.equal(meeting.ended_at,'2026-10-01T13:00:00Z');
  await status('call_ended','2026-10-01T13:00:00Z');
  await status('in_call_recording','2026-10-01T12:59:00Z');
  assert.equal(writes,1);
  await status('transcribing','2026-10-01T13:00:01Z');
  assert.equal(meeting.processing_stage,'transcript_processing');
  assert.equal(writes,2);
}));

Deno.test('artifact download failure returns 503 and preserves the recording for a callback retry', () => environment(async () => {
  const meeting: any={id:meetingId,status:'recording',summary:null,transcript:null};
  globalThis.fetch=async(input,init)=>{
    if(String(input).includes('artifacts.example.test'))return new Response('',{status:403});
    assert.ok(String(input).includes('/rest/v1/meetings'));
    if(init?.method==='GET')return Response.json([meeting]);
    Object.assign(meeting,JSON.parse(String(init?.body)));return Response.json([meeting]);
  };
  const response=await handler(new Request('https://local.test',{method:'POST',headers:{'x-mb-secret':'test-secret'},
    body:JSON.stringify({event:'bot.completed',data:{bot_id:'test-bot',mp4:'https://artifacts.example.test/meeting.mp4',
      transcription:'https://artifacts.example.test/transcript.json'}})}));
  assert.equal(response.status,503);
  assert.equal(meeting.status,'recording');
  assert.equal(meeting.recording_url,'https://artifacts.example.test/meeting.mp4');
  assert.equal(meeting.recording_status,'ready');
  assert.equal(meeting.transcript,null);
}));

Deno.test('late video finalization updates a summarized meeting without rerunning transcription or summary', () => environment(async () => {
  const meeting: any = { id:meetingId,status:'summarized',summary:'Existing summary',transcript:'Existing transcript',recording_status:'processing' };
  globalThis.fetch = async (input, init) => {
    assert.ok(String(input).includes('/rest/v1/meetings'));
    if (init?.method !== 'GET') {
      const patch = JSON.parse(String(init?.body));
      assert.ok(!('transcript' in patch)); assert.ok(!('summary' in patch)); assert.ok(!('status' in patch));
      Object.assign(meeting,patch);
    }
    return Response.json([meeting]);
  };
  const response = await handler(makeRequest());
  assert.equal(response.status,200); assert.equal((await response.json()).duplicate,true);
  assert.equal(meeting.recording_status,'ready'); assert.equal(meeting.recording_url,'https://artifacts.example.test/meeting.mp4');
  assert.equal(meeting.transcript,'Existing transcript'); assert.equal(meeting.summary,'Existing summary');
  meeting.recording_status='expired'; meeting.recording_url=null;
  await handler(makeRequest());
  assert.equal(meeting.recording_status,'expired'); assert.equal(meeting.recording_url,null);
}));
