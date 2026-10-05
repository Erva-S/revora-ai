import assert from 'node:assert/strict';
import { handler } from './capture-server.ts';
import '../functions/get-meeting-recording/index.ts';

const id = '00000000-0000-4000-8000-000000000001';
const botId = '00000000-0000-4000-8000-000000000002';
const request = () => new Request('https://context-tests.invalid/function', { method:'POST',
  headers:{Authorization:'Bearer test-user-token'},body:JSON.stringify({meeting_id:id}) });

async function environment(run: () => Promise<void>) {
  const values = {SUPABASE_URL:'https://context-tests.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-service',SUPABASE_ANON_KEY:'test-anon',
    MEETINGBAAS_API_KEY:'test-meetingbaas-key',MEETINGBAAS_API_BASE_URL:'https://provider.example.test'};
  const previous = Object.fromEntries(Object.keys(values).map((k)=>[k,Deno.env.get(k)]));
  const fetch = globalThis.fetch;
  try { for(const [k,v] of Object.entries(values))Deno.env.set(k,v);await run(); }
  finally { globalThis.fetch=fetch;for(const [k,v] of Object.entries(previous))v===undefined?Deno.env.delete(k):Deno.env.set(k,v); }
}

const authorizedFetch = (meetingResponse: () => unknown, providerResponse: () => Response) => async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if(url.includes('/auth/v1/user'))return Response.json({id,aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01'});
  if(url.includes('/profiles'))return Response.json({role:'user'});
  if(url.includes('/rest/v1/meetings')){
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer test-user-token');
    return Response.json(meetingResponse());
  }
  assert.equal(url,`https://provider.example.test/v2/bots/${botId}`);
  return providerResponse();
};

Deno.test('recording refresh checks user RLS and returns fresh video without downloading/re-encoding media', () => environment(async () => {
  let providerCalls=0;
  globalThis.fetch=authorizedFetch(()=>[{id,bot_id:botId,recording_url:'https://artifact.test/expired'}],()=>{
    providerCalls++;return Response.json({success:true,data:{video:'https://artifact.test/fresh.mp4',audio:'https://artifact.test/audio.flac'}});
  });
  const response=await handler(request());
  assert.equal(response.status,200);
  assert.equal((await response.json()).url,'https://artifact.test/fresh.mp4');
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(providerCalls,1);
}));

Deno.test('another user cannot refresh an inaccessible recording', () => environment(async () => {
  globalThis.fetch=authorizedFetch(()=>[],()=>{throw new Error('Provider must not be contacted');});
  assert.equal((await handler(request())).status,404);
}));

Deno.test('provider retention deletion returns 410 instead of pretending expired media was recovered', () => environment(async () => {
  globalThis.fetch=authorizedFetch(()=>[{id,bot_id:botId}],()=>Response.json({success:true,data:{artifacts_deleted:true,video:null}}));
  assert.equal((await handler(request())).status,410);
}));

Deno.test('reassignment during URL refresh denies access before returning the artifact', () => environment(async () => {
  let reads=0;
  globalThis.fetch=authorizedFetch(()=>++reads===1?[{id,bot_id:botId}]:[],()=>Response.json({success:true,data:{video:'https://artifact.test/video.mp4'}}));
  assert.equal((await handler(request())).status,403);
}));
