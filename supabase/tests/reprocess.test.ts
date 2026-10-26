import assert from 'node:assert/strict';
import { handleProcessElevenLabsTranscription } from '../functions/process-elevenlabs-transcription/index.ts';
import { pipelineRpc } from './pipeline-fakes.ts';
const id='00000000-0000-4000-8000-000000000001';
const bot='00000000-0000-4000-8000-000000000002';

Deno.test('admin/service reprocessing uses archived JSON twice, with no STT/artifact API calls or duplicated rows',async()=>{
  const values={SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'test-anon',SUPABASE_SERVICE_ROLE_KEY:'test-service',GEMINI_API_KEY:'test-gemini',ENABLE_TASK_CARRYOVER:'false'};
  const old=Object.fromEntries(Object.keys(values).map(k=>[k,Deno.env.get(k)]));const original=globalThis.fetch;
  const meeting:any={id,bot_id:bot,status:'summarized',transcript:'Old mixed text',ended_at:'2026-10-05T10:00:00Z'};
  const transcription={bot_id:bot,provider:'gladia',result:{utterances:[{speaker:'Alice',text:'I will test it.',start:0,end:2}]}};
  const archive={provider:'gladia',payload:{webhook_payload:{event:'bot.completed',data:{bot_id:bot,speakers:['Alice'],transcription:'https://expired.test/transcript.json'}},
    standardized_transcription:transcription,provider_transcription:{raw:'original'},diarization_artifact:null}};
  let rows:any[]=[],summaries:any[]=[],analyses=0;
  try{
    for(const [key,value]of Object.entries(values))Deno.env.set(key,value);
    globalThis.fetch=async(input,init)=>{
      const url=new URL(String(input)),body=init?.body?JSON.parse(String(init.body)):null;
      assert.ok(['db.test','generativelanguage.googleapis.com'].includes(url.hostname),'reprocessing must never fetch provider artifacts or STT');
      const rpc=pipelineRpc(url.pathname,body,meeting,value=>{rows=value;});if(rpc)return rpc;
      if(url.hostname==='generativelanguage.googleapis.com'){
        analyses++;assert.ok(body.contents[0].parts[0].text.includes(meeting.transcript));
        return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({executive_summary:'Alice will test.',key_decisions:['Test'],action_items:[],corrections:[{text:'Rewritten'}]})}]}}]});
      }
      if(url.pathname.endsWith('/meeting_transcription_jobs'))return Response.json([]);
      if(url.pathname.endsWith('/meeting_transcript_sources'))return init?.method==='POST'?new Response(null,{status:201}):Response.json([archive]);
      if(url.pathname.endsWith('/meetings')){if(init?.method==='PATCH')Object.assign(meeting,body);return Response.json([meeting]);}
      if(url.pathname.endsWith('/summaries')){summaries=init?.method==='DELETE'?[]:[body];return new Response(null,{status:204});}
      if(url.pathname.endsWith('/rpc/context_persist_action_items'))return new Response(null,{status:204});
      throw new Error('Unexpected test transport');
    };
    const request=()=>new Request('https://local.test/reprocess',{method:'POST',headers:{Authorization:'Bearer test-service'},body:JSON.stringify({meeting_id:id,reprocess:true})});
    for(let i=0;i<2;i++)assert.equal((await handleProcessElevenLabsTranscription(request())).status,200);
    assert.equal(analyses,2);assert.equal(meeting.transcript,'Alice: I will test it.');
    assert.equal(rows.length,1);assert.equal(rows[0].turn_index,0);assert.equal(rows[0].meeting_id,id);assert.equal(summaries.length,1);
    assert.equal(meeting.raw_transcription,null);
  }finally{
    globalThis.fetch=original;
    for(const [key,value]of Object.entries(old)){if(value===undefined)Deno.env.delete(key);else Deno.env.set(key,value);}
  }
});
