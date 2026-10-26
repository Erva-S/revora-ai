import assert from 'node:assert/strict';
import { handler } from './capture-server.ts';
import '../functions/deploy-bot/index.ts';
import { handleMeetingBaasWebhook } from '../functions/_shared/meeting-pipeline.ts';
import { pipelineRpc } from './pipeline-fakes.ts';

const userId='00000000-0000-4000-8000-000000000001';
const botId='00000000-0000-4000-8000-000000000002';
const meetingId='00000000-0000-4000-8000-000000000003';
const projectId='00000000-0000-4000-8000-000000000004';
const plannedMeetingId='00000000-0000-4000-8000-000000000005';
const req=(method='POST')=>new Request(`https://local.test/deploy-bot?bot_id=${botId}`,{method,headers:{Authorization:'Bearer test-user'},
  ...(method==='POST'?{body:JSON.stringify({meetingUrl:'https://meet.google.com/abc-defg-hij',title:'Test meeting'})}:{})});
async function environment(run:()=>Promise<void>){
  const values: Record<string,string|undefined>={SUPABASE_URL:'https://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'test-service',
    MEETINGBAAS_API_KEY:'test-meeting-key',MEETINGBAAS_API_BASE_URL:'https://provider.test',BOT_NAME:'Test Assistant',
    MEETINGBAAS_WEBHOOK_SECRET:'test-callback',MEETINGBAAS_WEBHOOK_URL:undefined,SPEECH_TO_TEXT_PROVIDER:'gladia',
    SPEECH_TO_TEXT_API_KEY:'test-provider-secret',GLADIA_CUSTOM_VOCABULARY:undefined};
  const old=Object.fromEntries(Object.keys(values).map(k=>[k,Deno.env.get(k)])); const original=globalThis.fetch;
  try{for(const [k,v]of Object.entries(values))v===undefined?Deno.env.delete(k):Deno.env.set(k,v);await run();}
  finally{globalThis.fetch=original;for(const [k,v]of Object.entries(old))v===undefined?Deno.env.delete(k):Deno.env.set(k,v);}
}
function authResponse(url:string,role='admin'){
  if(url.includes('/auth/v1/user'))return Response.json({id:userId,aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01'});
  if(url.includes('/profiles'))return Response.json({role});
  return null;
}

Deno.test('real dispatch handler sends one valid v2 bot configuration and persists existing ownership',()=>environment(async()=>{
  let dispatches=0;let inserts=0;
  globalThis.fetch=async(input,init)=>{
    const url=String(input);const auth=authResponse(url);if(auth)return auth;
    const body=JSON.parse(String(init?.body));
    if(url==='https://provider.test/v2/bots'){
      dispatches++;
      assert.equal(body.recording_mode,'speaker_view');assert.equal(body.allow_multiple_bots,false);
      assert.equal(body.transcription_config.provider,'gladia');assert.equal(body.transcription_config.api_key,'test-provider-secret');
      assert.equal(body.transcription_config.custom_params.diarization,true);
      assert.equal(body.callback_config.secret,'test-callback');assert.equal(body.callback_config.url,'https://supabase.test/functions/v1/meetingbaas-webhook');
      assert.equal(body.speech_to_text,undefined);assert.equal(body.automatic_leave,undefined);
      return Response.json({success:true,data:{bot_id:botId}},{status:201});
    }
    assert.ok(url.includes('/rest/v1/meetings'));inserts++;
    assert.equal(body.user_id,userId);assert.equal(body.bot_id,botId);
    return Response.json({id:meetingId,bot_id:botId,status:'pending'},{status:201});
  };
  const response=await handler(req());assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.bot_name,'Test Assistant');assert.equal(result.meeting_id,meetingId);
  assert.ok(!JSON.stringify(result).includes('test-provider-secret'));assert.equal(dispatches,1);assert.equal(inserts,1);
 }));

Deno.test('planned deployment validates before dispatches, inherits fields, and reports non-fatal link failure',()=>environment(async()=>{
  const order:string[]=[]; let dispatched=false;
  const planned={id:plannedMeetingId,project_id:projectId,user_id:userId,title:'Planned title',agenda:'Planned agenda',
    scheduled_for:'2026-10-20T10:00:00Z',meeting_url:'https://meet.google.com/planned',status:'planned',linked_meeting_id:null};
  globalThis.fetch=async(input,init)=>{
    const url=String(input); const auth=authResponse(url); if(auth)return auth;
    if(url.includes('/planned_meetings')) {
      order.push('planned-read');
      assert.equal(new URL(url).searchParams.get('select'),
        'id,project_id,user_id,title,agenda,scheduled_for,meeting_url,status,linked_meeting_id');
      return Response.json(planned);
    }
    if(url.includes('/projects')) return Response.json({id:projectId});
    if(url==='https://provider.test/v2/bots') {
      order.push('provider'); dispatched=true;
      return Response.json({success:true,data:{bot_id:botId}},{status:201});
    }
    if(url.includes('/rpc/link_planned_meeting')) { order.push('planned-link'); return Response.json(false); }
    if(url.includes('/meetings') && init?.method==='POST') {
      order.push('meeting-insert'); const body=JSON.parse(String(init.body));
      assert.equal(body.project_id,projectId); assert.equal(body.user_id,userId); assert.equal(body.title,'Planned title');
      return Response.json({id:meetingId,bot_id:botId,status:'pending'},{status:201});
    }
    assert.ok(url.includes('/meetings'));
    return Response.json([]);
  };
  const response=await handler(new Request('https://local.test/deploy-bot',{method:'POST',headers:{Authorization:'Bearer test-user'},
    body:JSON.stringify({meeting_url:'https://meet.google.com/planned',planned_meeting_id:plannedMeetingId})}));
  assert.equal(response.status,200); const result=await response.json();
  assert.equal(result.success,true); assert.equal(result.planned_link,'failed'); assert.equal(result.assigned_to,userId); assert.equal(dispatched,true);
  assert.deepEqual(order,['planned-read','provider','meeting-insert','planned-link']);
}));

Deno.test('planned deployment rejects cancelled rows before provider dispatch',()=>environment(async()=>{
  let providerCalls=0;
  globalThis.fetch=async(input)=>{
    const url=String(input); const auth=authResponse(url); if(auth)return auth;
      if(url.includes('/planned_meetings')) {
        assert.equal(new URL(url).searchParams.get('select'),
         'id,project_id,user_id,title,agenda,scheduled_for,meeting_url,status,linked_meeting_id');
      return Response.json({id:plannedMeetingId,project_id:projectId,user_id:userId,title:'Cancelled',agenda:null,
        scheduled_for:'2026-10-20T10:00:00Z',meeting_url:'https://meet.google.com/cancelled',status:'cancelled',linked_meeting_id:null});
    }
    if(url.includes('/v2/bots')) providerCalls++;
    throw new Error(`unexpected call ${url}`);
  };
  const response=await handler(new Request('https://local.test/deploy-bot',{method:'POST',headers:{Authorization:'Bearer test-user'},
    body:JSON.stringify({meeting_url:'https://meet.google.com/cancelled',planned_meeting_id:plannedMeetingId})}));
  assert.equal(response.status,409); assert.equal(providerCalls,0);
}));

Deno.test('planned deployment rejects already-linked rows before provider dispatch',()=>environment(async()=>{
  let providerCalls=0;
  globalThis.fetch=async(input)=>{
    const url=String(input); const auth=authResponse(url); if(auth)return auth;
      if(url.includes('/planned_meetings')) {
        assert.equal(new URL(url).searchParams.get('select'),
         'id,project_id,user_id,title,agenda,scheduled_for,meeting_url,status,linked_meeting_id');
      return Response.json({id:plannedMeetingId,project_id:projectId,user_id:userId,
        title:'Already linked',agenda:null,scheduled_for:'2026-10-20T10:00:00Z',meeting_url:'https://meet.google.com/linked',
        status:'linked',linked_meeting_id:meetingId});
    }
    if(url.includes('/v2/bots')) providerCalls++;
    throw new Error(`unexpected call ${url}`);
  };
  const response=await handler(new Request('https://local.test/deploy-bot',{method:'POST',headers:{Authorization:'Bearer test-user'},
    body:JSON.stringify({meeting_url:'https://meet.google.com/linked',planned_meeting_id:plannedMeetingId})}));
  assert.equal(response.status,409); assert.equal(providerCalls,0);
}));

Deno.test('non-admins still cannot dispatch or eject a bot',()=>environment(async()=>{
  globalThis.fetch=async(input)=>{const result=authResponse(String(input),'user');assert.ok(result);return result;};
  assert.equal((await handler(req())).status,403);assert.equal((await handler(req('DELETE'))).status,403);
}));

Deno.test('ElevenLabs dispatch records without requesting unsupported MeetingBaaS batch STT',()=>environment(async()=>{
  const names=['ELEVENLABS_API_KEY','ELEVENLABS_WEBHOOK_ID','ELEVENLABS_WEBHOOK_SECRET','ELEVENLABS_MODEL_ID'];
  const old=names.map(k=>Deno.env.get(k));
  try {
    Deno.env.set('SPEECH_TO_TEXT_PROVIDER','elevenlabs');
    names.forEach((k,i)=>Deno.env.set(k,['test-eleven-key','test-webhook','test-signing-secret','scribe_v2'][i]));
    let dispatched=false;
    globalThis.fetch=async(input,init)=>{
      const url=String(input);const auth=authResponse(url);if(auth)return auth;
      const body=JSON.parse(String(init?.body));
      if(url==='https://provider.test/v2/bots'){
        dispatched=true;
        assert.equal(body.transcription_enabled,false);assert.equal(body.transcription_config,undefined);
        assert.equal(body.extra.revora.transcription_provider,'elevenlabs');assert.equal(body.extra.revora.transcription_model,'scribe_v2');
        assert.ok(!JSON.stringify(body).includes('test-eleven-key'));
        return Response.json({success:true,data:{bot_id:botId}},{status:201});
      }
      assert.equal(body.transcription_provider,'elevenlabs');
      return Response.json({id:meetingId,bot_id:botId,status:'pending'},{status:201});
    };
    assert.equal((await handler(req())).status,200);assert.equal(dispatched,true);
    Deno.env.delete('ELEVENLABS_API_KEY');
    dispatched=false;
    globalThis.fetch=async(input)=>{const auth=authResponse(String(input));assert.ok(auth,'no bot call when ElevenLabs is unconfigured');return auth;};
    const refused=await handler(req());assert.equal(refused.status,500);assert.match((await refused.json()).error,/ELEVENLABS_API_KEY/);
  } finally { names.forEach((k,i)=>old[i]===undefined?Deno.env.delete(k):Deno.env.set(k,old[i]!)); }
}));

Deno.test('accepted leave does not mark recording ended before provider handoff',()=>environment(async()=>{
  globalThis.fetch=async(input)=>{
    const url=String(input);const auth=authResponse(url);if(auth)return auth;
    assert.equal(url,`https://provider.test/v2/bots/${botId}/leave`);
    return Response.json({success:true,data:{message:'accepted'}});
  };
  const response=await handler(req('DELETE'));assert.equal(response.status,200);assert.equal((await response.json()).success,true);
}));

Deno.test('permanent leave failure is surfaced and never falsely reported successful',()=>environment(async()=>{
  globalThis.fetch=async(input)=>{
    const url=String(input);const auth=authResponse(url);if(auth)return auth;
    assert.equal(url,`https://provider.test/v2/bots/${botId}/leave`);
    return Response.json({error:'bad provider credentials'},{status:401});
  };
  const response=await handler(req('DELETE'));assert.equal(response.status,502);assert.equal((await response.json()).success,false);
}));

Deno.test('completion before dispatch persistence is retried, then attaches to exactly one owned bot-id upsert',()=>environment(async()=>{
  let meeting:any=null, dispatches=0, writes=0;
  const callback=()=>new Request('https://local.test/webhook',{method:'POST',headers:{'x-mb-secret':'test-callback'},
    body:JSON.stringify({event:'bot.completed',data:{bot_id:botId,transcription:[]}})});
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));const auth=authResponse(url.href);if(auth)return auth;
    if(url.hostname==='provider.test'){
      dispatches++;
      assert.equal((await handleMeetingBaasWebhook(callback())).status,503);
      assert.equal(meeting,null,'early callback must not insert an ownerless row');
      return Response.json({success:true,data:{bot_id:botId}},{status:201});
    }
    const body=init?.body?JSON.parse(String(init.body)):null;
    const rpc=meeting?pipelineRpc(url.pathname,body,meeting):null;if(rpc)return rpc;
    if(url.pathname.endsWith('/meeting_transcript_sources'))return new Response(null,{status:201});
    assert.ok(url.pathname.endsWith('/meetings'));
    if(init?.method==='POST'){
      writes++;assert.equal(url.searchParams.get('on_conflict'),'bot_id');
      assert.match(new Headers(init.headers).get('prefer')!,/resolution=merge-duplicates/);
      assert.ok(!('status'in body));assert.ok(!('transcript'in body));assert.ok(!('recording_url'in body));
      meeting={id:meetingId,status:'pending',...body};return Response.json(meeting,{status:201});
    }
    if(init?.method==='PATCH'){Object.assign(meeting,body);return Response.json([meeting]);}
    return Response.json(meeting?[meeting]:[]);
  };
  assert.equal((await handler(req())).status,200);assert.equal(meeting.user_id,userId);
  assert.equal((await handleMeetingBaasWebhook(callback())).status,200);
  assert.equal(meeting.bot_id,botId);assert.equal(meeting.user_id,userId);assert.equal(writes,1);assert.equal(dispatches,1);
  assert.equal((await handleMeetingBaasWebhook(callback())).status,200);assert.equal(writes,1);
}));

Deno.test('dispatched bot persistence failure is explicit and never returns success',()=>environment(async()=>{
  globalThis.fetch=async(input)=>{
    const url=String(input);const auth=authResponse(url);if(auth)return auth;
    if(url.includes('/v2/bots'))return Response.json({success:true,data:{bot_id:botId}},{status:201});
    return Response.json({code:'DATABASE_FAILURE'},{status:503});
  };
  const response=await handler(req());const data=await response.json();
  assert.equal(response.status,503);assert.equal(data.success,false);assert.equal(data.dispatched,true);assert.equal(data.bot_id,botId);
}));
