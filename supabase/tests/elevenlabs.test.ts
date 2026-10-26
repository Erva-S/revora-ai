import assert from 'node:assert/strict';
import { elevenLabsTranscription, submitElevenLabsTranscription, verifyElevenLabsRequest } from '../functions/_shared/elevenlabs.ts';
import { assembleTranscript, handleMeetingBaasWebhook } from '../functions/_shared/meeting-pipeline.ts';
import { handleElevenLabsWebhook } from '../functions/elevenlabs-webhook/index.ts';
import { handleProcessElevenLabsTranscription } from '../functions/process-elevenlabs-transcription/index.ts';
import { pipelineRpc } from './pipeline-fakes.ts';

const meetingId='00000000-0000-4000-8000-000000000001';
const botId='00000000-0000-4000-8000-000000000002';
const jobId='00000000-0000-4000-8000-000000000003';
const result={text:'Hello Bob. Yes tomorrow.',language_code:'en',words:[
  {text:'Hello',type:'word',speaker_id:'speaker_0',start:0,end:0.3,logprob:-0.1},
  {text:' ',type:'spacing'}, {text:'Bob.',type:'word',speaker_id:'speaker_0',start:0.4,end:0.7},
  {text:' ',type:'spacing'}, {text:'Yes',type:'word',speaker_id:'speaker_1',start:1,end:1.3},
  {text:' ',type:'spacing'}, {text:'tomorrow.',type:'word',speaker_id:'speaker_1',start:1.4,end:1.8},
]};

async function environment(run:()=>Promise<void>) {
  const values:Record<string,string|undefined>={SUPABASE_URL:'https://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'test-service',SUPABASE_ANON_KEY:'test-anon',
    MEETINGBAAS_WEBHOOK_SECRET:'test-meeting-secret',MEETINGBAAS_WEBHOOK_SIGNING_SECRET:undefined,SPEECH_TO_TEXT_PROVIDER:'elevenlabs',
    ELEVENLABS_API_KEY:'test-eleven-key',ELEVENLABS_WEBHOOK_ID:'test-webhook-id',ELEVENLABS_WEBHOOK_SECRET:'test-signing-secret',
    ELEVENLABS_MODEL_ID:'scribe_v2',GEMINI_API_KEY:undefined,ENABLE_TASK_CARRYOVER:'false'};
  const old=Object.fromEntries(Object.keys(values).map(k=>[k,Deno.env.get(k)]));
  const fetch=globalThis.fetch;const runtime=(globalThis as any).EdgeRuntime;
  try {
    for(const [k,v]of Object.entries(values)) {
      if(v===undefined)Deno.env.delete(k);else Deno.env.set(k,v);
    }
    delete (globalThis as any).EdgeRuntime;await run();
  } finally {
    globalThis.fetch=fetch;(globalThis as any).EdgeRuntime=runtime;
    for(const [k,v]of Object.entries(old)) {
      if(v===undefined)Deno.env.delete(k);else Deno.env.set(k,v);
    }
  }
}

async function signed(body:unknown, timestamp=String(Math.floor(Date.now()/1000))) {
  const raw=JSON.stringify(body);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('test-signing-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${raw}`));
  const hex=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  return new Request('https://local.test/elevenlabs',{method:'POST',headers:{'elevenlabs-signature':`t=${timestamp},v0=${hex}`},body:raw});
}
const completed=(id:string)=>({type:'speech_to_text_transcription',data:{request_id:'request-1',webhook_metadata:{job_id:id},transcription:result}});
const baasRequest=()=>new Request('https://local.test/meetingbaas',{method:'POST',headers:{'x-mb-secret':'test-meeting-secret'},body:JSON.stringify({event:'bot.completed',data:{
  bot_id:botId,audio:'https://artifacts.test/audio.flac',mp4:'https://artifacts.test/video.mp4',duration_seconds:60,
  joined_at:'2026-10-05T10:00:00Z',exited_at:'2026-10-05T10:01:00Z',
  participants:[{id:0,name:'Alice'},{id:1,name:'Bob'}],
  diarization:'https://artifacts.test/diarization.jsonl',
  extra:{revora:{bot_name:'Test Assistant',transcription_provider:'elevenlabs',transcription_model:'scribe_v2'}}}})});

function fixture() {
  const state:any={meeting:{id:meetingId,bot_id:botId,status:'pending',transcription_provider:'elevenlabs',updated_at:'2026-10-05T10:00:00Z'},
    job:null,submissions:0,transcripts:[],sources:[],failTranscript:false};
  const clone=(value:any)=>JSON.parse(JSON.stringify(value));
  const matches=(row:any,url:URL)=>{
    for(const key of ['id','meeting_id','updated_at','status','result']) {
      const filter=url.searchParams.get(key);if(!filter)continue;
      if(filter.startsWith('eq.')&&String(row[key])!==filter.slice(3))return false;
      if(filter.startsWith('neq.')&&String(row[key])===filter.slice(4))return false;
      if(filter.startsWith('in.(')&&!filter.slice(4,-1).split(',').includes(row[key]))return false;
      if(filter==='is.null'&&row[key]!=null)return false;
    }
    return true;
  };
  const transport:typeof fetch=async(input,init)=>{
    const url=new URL(String(input));const method=init?.method||'GET';
    if(url.hostname==='api.elevenlabs.io'){
      state.submissions++;const form=init!.body as FormData;
      assert.equal(form.get('source_url'),'https://artifacts.test/audio.flac');
      assert.equal(form.get('model_id'),'scribe_v2');assert.equal(form.get('webhook'),'true');
      assert.equal(form.get('diarize'),'true');assert.equal(form.get('webhook_id'),'test-webhook-id');
      assert.equal(new Headers(init?.headers).get('xi-api-key'),'test-eleven-key');
      assert.equal(JSON.parse(String(form.get('webhook_metadata'))).job_id,state.job.id);
      if(state.ambiguous)throw new TypeError('Lost response with private URL/token');
      if(state.earlyCallback)assert.equal((await handleElevenLabsWebhook(await signed(completed(state.job.id)))).status,200);
      return Response.json({request_id:'request-1'},{status:202});
    }
    if(url.hostname==='artifacts.test')return new Response([
      {speaker:'Alice',start_time:0,end_time:0.9},{speaker:'Bob',start_time:1,end_time:2},
    ].map(s=>JSON.stringify(s)).join('\n'));
    if(url.pathname.includes('/auth/v1/user'))return Response.json({id:meetingId,aud:'authenticated',created_at:'2026-01-01',app_metadata:{},user_metadata:{}});
    if(url.pathname.endsWith('/profiles'))return Response.json({role:state.role||'user'});
    const body=init?.body?JSON.parse(String(init.body)):null;
    if(url.pathname.endsWith('/rpc/persist_meeting_transcript') && state.failTranscript)
      return Response.json({code:'OUTAGE'},{status:503});
    const rpc=pipelineRpc(url.pathname,body,state.meeting,(rows)=>{state.transcripts=rows;});if(rpc)return rpc;
    if(url.hostname==='generativelanguage.googleapis.com')return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({executive_summary:'A short discussion.',action_items:[]})}]}}]});
    if(url.pathname.endsWith('/summaries')||url.pathname.endsWith('/rpc/context_persist_action_items'))return new Response(null,{status:204});
    if(url.pathname.endsWith('/meeting_transcript_sources')) {
      if(!state.sources.some((s:any)=>s.content_hash===body.content_hash))state.sources.push(body);
      return new Response(null,{status:201});
    }
    if(url.pathname.endsWith('/meeting_transcription_jobs')){
      if(method==='GET')return Response.json(state.job&&matches(state.job,url)?[clone(state.job)]:[]);
      if(method==='POST'){
        if(state.job)return Response.json({code:'23505'},{status:409});
        state.job={...body,provider:'elevenlabs',result:null,request_id:null,created_at:new Date().toISOString()};
        return Response.json([clone(state.job)],{status:201});
      }
      if(!state.job||!matches(state.job,url))return Response.json([]);
      Object.assign(state.job,body);return Response.json([clone(state.job)]);
    }
    if(url.pathname.endsWith('/meetings')){
      if(method==='GET')return Response.json([clone(state.meeting)]);
      if(!matches(state.meeting,url))return Response.json([]);
      Object.assign(state.meeting,body);return Response.json([clone(state.meeting)]);
    }
    if(url.pathname.endsWith('/transcripts')){
      if(state.failTranscript)throw new Error('Simulated persistence outage');
      if(method==='DELETE'){state.transcripts=[];return new Response(null,{status:204});}
      state.transcripts=body;return new Response(null,{status:201});
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  };
  return {state,transport};
}

Deno.test('ElevenLabs signatures verify raw bytes, reject tampering, replay and future timestamps',()=>environment(async()=>{
  const req=await signed(completed(jobId));const raw=await req.clone().text();
  assert.equal(await verifyElevenLabsRequest(req,raw),true);
  assert.equal(await verifyElevenLabsRequest(req,raw+' '),false);
  for(const ts of ['1',String(Math.floor(Date.now()/1000)+3600)]){
    const invalid=await signed(completed(jobId),ts);assert.equal(await verifyElevenLabsRequest(invalid,await invalid.clone().text()),false);
  }
  globalThis.fetch=async()=>{throw new Error('No database calls for an invalid signature');};
  assert.equal((await handleElevenLabsWebhook(new Request('https://local.test',{method:'POST',body:raw}))).status,401);
}));

Deno.test('Scribe clusters preserve separate speakers without treating acoustic IDs as roster IDs',()=>environment(async()=>{
  const converted=elevenLabsTranscription(result);
  const assembled=await assembleTranscript({transcription:converted,participants:[{id:0,name:'Alice'},{id:1,name:'Bob'}]});
  assert.deepEqual(assembled.turns.map(t=>[t.speaker,t.text]),[['Speaker 1','Hello Bob.'],['Speaker 2','Yes tomorrow.']]);
  assert.ok(assembled.turns.every(t=>t.speaker_source==='unknown'));
  assert.equal(assembled.turns[1].words?.[0].start,1);
  assert.equal(assembled.provider,'elevenlabs');
  const chinese=await assembleTranscript({transcription:elevenLabsTranscription({text:'你好世界',language_code:'zho',words:[
    {type:'word',text:'你好',speaker_id:'speaker_0',start:0,end:1},{type:'word',text:'世界',speaker_id:'speaker_0',start:1,end:2}]})});
  assert.equal(chinese.turns[0].text,'你好世界');assert.equal(chinese.turns[0].words?.length,2);
  assert.throws(()=>elevenLabsTranscription({text:'Broken result'}),/Invalid/);
}));

Deno.test('recording callback queues once; signed async result preserves stable clusters, video, timestamps and model',()=>environment(async()=>{
  Deno.env.set('GEMINI_API_KEY','test-gemini');
  const {state,transport}=fixture();globalThis.fetch=transport;
  assert.equal((await handleMeetingBaasWebhook(baasRequest())).status,200);
  assert.equal(state.job.status,'queued');assert.equal(state.meeting.processing_stage,'transcript_processing');
  assert.equal(state.meeting.recording_url,'https://artifacts.test/video.mp4');assert.equal(state.meeting.transcript,undefined);
  assert.equal((await handleMeetingBaasWebhook(baasRequest())).status,200);assert.equal(state.submissions,1);
  const background:Promise<unknown>[]=[];
  (globalThis as any).EdgeRuntime={waitUntil:(p:Promise<unknown>)=>background.push(p)};
  const response=await handleElevenLabsWebhook(await signed(completed(state.job.id)));
  assert.equal(response.status,200);assert.equal(background.length,1);assert.deepEqual(state.job.result,result);
  await Promise.all(background);
  assert.equal(state.job.status,'completed');assert.equal(state.meeting.transcription_provider,'elevenlabs');
  assert.equal(state.meeting.transcript_metrics.model,'scribe_v2');assert.equal(state.meeting.ended_at,'2026-10-05T10:01:00.000Z');
  assert.equal(state.meeting.transcript,'Speaker 1: Hello Bob.\nSpeaker 2: Yes tomorrow.');assert.equal(state.transcripts.length,2);
  assert.equal(state.meeting.raw_transcription,null);
  assert.equal(state.sources[0].payload.webhook_payload.event,'bot.completed');
  assert.deepEqual(state.sources[0].payload.provider_transcription,result);
  assert.equal(state.meeting.transcript_source_metadata.normalization_version,3);
  assert.equal((await handleElevenLabsWebhook(await signed(completed(state.job.id)))).status,200);assert.equal(state.submissions,1);
}));

Deno.test('fast result cannot be overwritten by the later submission acknowledgement',()=>environment(async()=>{
  Deno.env.set('GEMINI_API_KEY','test-gemini');
  const {state,transport}=fixture();state.earlyCallback=true;globalThis.fetch=transport;
  assert.equal((await handleMeetingBaasWebhook(baasRequest())).status,200);
  assert.equal(state.job.status,'completed');assert.equal(state.meeting.transcript,'Speaker 1: Hello Bob.\nSpeaker 2: Yes tomorrow.');
}));

Deno.test('ambiguous submission is not charged twice and a signed callback can still recover it',()=>environment(async()=>{
  Deno.env.set('GEMINI_API_KEY','test-gemini');
  const {state,transport}=fixture();state.ambiguous=true;globalThis.fetch=transport;
  assert.equal((await handleMeetingBaasWebhook(baasRequest())).status,503);assert.equal(state.job.status,'submission_unknown');
  assert.equal((await handleMeetingBaasWebhook(baasRequest())).status,503);assert.equal(state.submissions,1);
  assert.equal((await handleElevenLabsWebhook(await signed(completed(state.job.id)))).status,200);
  assert.equal(state.job.status,'completed');assert.equal(state.submissions,1);
  state.meeting.transcript='Old mixed transcript with unnecessarily repeated fragment that must be replaced by normalized turns.';
  assert.equal((await handleProcessElevenLabsTranscription(new Request('https://local.test/process',{method:'POST',
    headers:{Authorization:'Bearer test-service'},body:JSON.stringify({meeting_id:meetingId,reprocess:true})}))).status,200);
  assert.equal(state.meeting.transcript,'Speaker 1: Hello Bob.\nSpeaker 2: Yes tomorrow.');
  assert.equal(state.submissions,1);assert.equal(state.sources.length,1);
}));

Deno.test('saved result can recover after processing failure; recovery endpoint is admin/service-only',()=>environment(async()=>{
  Deno.env.set('GEMINI_API_KEY','test-gemini');
  const {state,transport}=fixture();globalThis.fetch=transport;
  await handleMeetingBaasWebhook(baasRequest());state.failTranscript=true;
  const background:Promise<unknown>[]=[];(globalThis as any).EdgeRuntime={waitUntil:(p:Promise<unknown>)=>background.push(p)};
  assert.equal((await handleElevenLabsWebhook(await signed(completed(state.job.id)))).status,200);await Promise.all(background);
  assert.equal(state.job.status,'ready');assert.deepEqual(state.job.result,result);
  const request=(token:string)=>new Request('https://local.test/process',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({meeting_id:meetingId})});
  assert.equal((await handleProcessElevenLabsTranscription(request('test-user'))).status,403);
  state.failTranscript=false;
  assert.equal((await handleProcessElevenLabsTranscription(request('test-service'))).status,200);
  assert.equal(state.job.status,'completed');assert.equal(state.submissions,1);
}));

Deno.test('request mismatches and malformed results do not overwrite a queued job',()=>environment(async()=>{
  const {state,transport}=fixture();globalThis.fetch=transport;await handleMeetingBaasWebhook(baasRequest());
  const mismatch=completed(state.job.id);mismatch.data.request_id='other-request';
  assert.equal((await handleElevenLabsWebhook(await signed(mismatch))).status,409);
  const invalid:any=completed(state.job.id);invalid.data.transcription={text:'Missing words'};
  assert.equal((await handleElevenLabsWebhook(await signed(invalid))).status,400);
  assert.equal(state.job.status,'queued');assert.equal(state.job.result,null);
}));

Deno.test('submission errors do not surface provider bodies or credentials',()=>environment(async()=>{
  globalThis.fetch=async()=>Response.json({detail:'private secret and signed URL'},{status:401});
  await assert.rejects(submitElevenLabsTranscription('https://artifact.test/audio.flac',jobId,'scribe_v2'),/HTTP 401/);
  globalThis.fetch=async()=>{throw new Error('private secret');};
  await assert.rejects(submitElevenLabsTranscription('https://artifact.test/audio.flac',jobId,'scribe_v2'),/unconfirmed/);
}));
