import assert from 'node:assert/strict';
import { handler } from './capture-server.ts';
import '../functions/get-meeting-recording/index.ts';
import { verifyDownloadGrant } from '../functions/_shared/meeting-recording.ts';

const id = '00000000-0000-4000-8000-000000000001';
const botId = '00000000-0000-4000-8000-000000000002';
const request = (action = 'watch', token = 'test-user-token') => new Request('https://context-tests.invalid/function', { method: 'POST',
  headers: { Authorization: `Bearer ${token}`, Origin: 'https://app.test' }, body: JSON.stringify({ meeting_id: id, action }) });

async function environment(run: () => Promise<void>) {
  const values = { SUPABASE_URL: 'https://context-tests.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-service', SUPABASE_ANON_KEY: 'test-anon',
    MEETINGBAAS_API_KEY: 'test-meetingbaas-key', MEETINGBAAS_API_BASE_URL: 'https://provider.example.test' };
  const previous = Object.fromEntries(Object.keys(values).map((k) => [k, Deno.env.get(k)]));
  const original = globalThis.fetch;
  try { for (const [k, v] of Object.entries(values)) Deno.env.set(k, v); await run(); }
  finally { globalThis.fetch = original; for (const [k, v] of Object.entries(previous)) { if (v === undefined) Deno.env.delete(k); else Deno.env.set(k, v); } }
}

function fixture() {
  const state: any = { meeting: { id, user_id: id, bot_id: botId, recording_url: 'https://artifact.test/expired.mp4' },
    details: { bot_id: botId, status: 'completed', video: 'https://artifact.test/fresh.mp4', audio: 'https://artifact.test/audio.flac', duration_seconds: 222 },
    providerCalls: 0, artifactCalls: 0, reads: 0, patches: [], role: 'user' };
  globalThis.fetch = async (input, init) => {
    const url = String(input), headers = new Headers(init?.headers);
    if (url.includes('/auth/v1/user')) return state.invalidAuth ? Response.json({ message: 'Invalid session' }, { status: 401 })
      : Response.json({ id, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' });
    if (url.includes('/profiles')) return Response.json({ role: state.role });
    if (url.includes('/rest/v1/meetings')) {
      if (init?.method === 'PATCH') { assert.equal(headers.get('authorization'), 'Bearer test-service'); state.patches.push(JSON.parse(String(init.body))); return Response.json([state.meeting]); }
      assert.equal(headers.get('authorization'), 'Bearer test-user-token'); state.reads++;
      return Response.json(state.reassigned && state.reads > 1 ? [] : state.meeting ? [state.meeting] : []);
    }
    if (url.includes('/v2/bots/')) { state.providerCalls++; assert.equal(headers.get('x-meeting-baas-api-key'), 'test-meetingbaas-key'); return state.providerResponse?.() || Response.json({ success: true, data: state.details }); }
    assert.equal(url, state.details.video ?? state.details.audio); assert.equal(init?.method, undefined);
    assert.equal(headers.get('range'), 'bytes=0-31'); assert.equal(headers.get('x-meeting-baas-api-key'), null);
    state.artifactCalls++;
    return state.artifactResponse?.() || new Response(new Uint8Array(32), { status: 206,
      headers: { 'Content-Type': state.details.video ? 'video/mp4' : 'audio/flac', 'Content-Range': 'bytes 0-31/20143597' } });
  };
  return state;
}

Deno.test('watch refreshes expired cache, checks GET range (not HEAD), persists video metadata and rechecks RLS', () => environment(async () => {
  const state = fixture(); const response = await handler(request()); const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.url, state.details.video); assert.equal(data.status, 'ready');
  assert.equal(data.metadata.size_bytes, 20143597); assert.equal(data.metadata.duration_seconds, 222);
  assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(state.reads, 2);
  assert.equal(state.providerCalls, 1); assert.equal(state.artifactCalls, 1);
  assert.ok(state.patches.every((p: any) => p.recording_status === 'ready'));
}));

Deno.test('download creates a two-minute user/meeting/bot-scoped URL, not a watch link or session JWT', () => environment(async () => {
  fixture(); const response = await handler(request('download')); const data = await response.json();
  assert.equal(response.status, 200); const url = new URL(data.url);
  assert.equal(url.pathname, '/functions/v1/download-meeting-recording');
  const grant = await verifyDownloadGrant(url.searchParams.get('ticket')!);
  assert.equal(grant.user_id, id); assert.equal(grant.bot_id, botId); assert.equal(grant.meeting_id, id);
  assert.deepEqual(Object.keys(grant).sort(), ['bot_id','exp','meeting_id','user_id']);
  assert.ok(grant.exp - Date.now() / 1000 <= 120); assert.ok(!data.url.includes('test-user-token'));
}));

Deno.test('inaccessible, ownerless and other-owner meetings are denied before provider contact', () => environment(async () => {
  for (const owner of [undefined, null, botId]) {
    const state = fixture(); state.meeting.user_id = owner;
    assert.equal((await handler(request())).status, 403); assert.equal(state.providerCalls, 0);
  }
  const state = fixture(); state.meeting = null;
  assert.equal((await handler(request())).status, 403); assert.equal(state.providerCalls, 0);
}));

Deno.test('verified admins can access legacy ownerless meetings', () => environment(async () => {
  const state = fixture(); state.meeting.user_id = null; state.role = 'admin';
  assert.equal((await handler(request())).status, 200);
}));

Deno.test('reassignment during refresh denies access before returning the artifact', () => environment(async () => {
  const state = fixture(); state.reassigned = true;
  assert.equal((await handler(request())).status, 403);
}));

Deno.test('processing has a retryable state instead of claiming departure made video available', () => environment(async () => {
  const state = fixture(); state.details = { status: 'call_ended', video: null, audio: null };
  const response = await handler(request()); const data = await response.json();
  assert.equal(response.status, 202); assert.equal(data.status, 'processing'); assert.equal(data.code, 'RECORDING_PROCESSING');
  assert.equal(response.headers.get('retry-after'), '15'); assert.equal(state.artifactCalls, 0);
  state.details={status:'call_ended',video:'https://artifact.test/fresh.mp4'};
  assert.equal((await handler(request())).status,202);assert.equal(state.artifactCalls,0);
  state.details = { status: 'completed', video: 'https://artifact.test/fresh.mp4' };
  assert.equal((await handler(request())).status, 200);
}));

Deno.test('missing video, audio-only, retention deletion and missing bot identifiers are distinct', () => environment(async () => {
  for (const [details, code, http] of [
    [{ status: 'completed', video: null, audio: null }, 'RECORDING_UNAVAILABLE', 404],
    [{ status: 'completed', recording_mode: 'audio_only', audio: 'https://artifact.test/audio.flac' }, 'VIDEO_NOT_RECORDED', 409],
    [{ artifacts_deleted: true, video: null }, 'RECORDING_EXPIRED', 410],
  ] as const) {
    const state = fixture(); state.details = details;
    const response = await handler(request('download')); assert.equal(response.status, http); assert.equal((await response.json()).code, code);
  }
  const state = fixture(); state.meeting.bot_id = null;
  assert.equal((await handler(request())).status, 404); assert.equal(state.providerCalls, 0);
}));

Deno.test('storage 403 refreshes once; HTML/non-video content is rejected', () => environment(async () => {
  const state = fixture(); state.artifactResponse = () => state.artifactCalls === 1
    ? new Response('expired', { status: 403 }) : new Response('video', { headers: { 'Content-Type': 'video/mp4' } });
  assert.equal((await handler(request())).status, 200); assert.equal(state.providerCalls, 2);
  state.artifactResponse = () => new Response('<html>not a video</html>', { headers: { 'Content-Type': 'text/html' } });
  const response = await handler(request()); assert.equal(response.status, 502); assert.equal((await response.json()).code, 'INVALID_RECORDING_CONTENT');
  state.artifactResponse=()=>new Response(null,{status:416});
  const empty=await handler(request());assert.equal(empty.status,202);assert.equal((await empty.json()).status,'processing');
}));

Deno.test('provider errors/malformed metadata do not expose response bodies or private keys', () => environment(async () => {
  const state = fixture(); state.providerResponse = () => Response.json({ secret: 'private', code: 'DENIED' }, { status: 401 });
  const response = await handler(request()); const body = await response.text();
  assert.equal(response.status, 502); assert.ok(!body.includes('private')); assert.ok(!body.includes('test-meetingbaas-key'));
  state.providerResponse = () => Response.json({ success: true, data: {} });
  assert.equal((await handler(request())).status, 502);
}));

Deno.test('unauthenticated access is rejected without any provider request', () => environment(async () => {
  const state = fixture(); assert.equal((await handler(new Request('https://local.test', { method: 'POST', body: JSON.stringify({ meeting_id: id }) }))).status, 401);
  state.invalidAuth = true; assert.equal((await handler(request())).status, 401); assert.equal(state.providerCalls, 0);
}));

Deno.test('storage network failures are safe and retryable, not mislabeled missing recordings', () => environment(async () => {
  const state = fixture(); state.artifactResponse = () => { throw new TypeError('private signed URL'); };
  const response = await handler(request()); const body = await response.json();
  assert.equal(response.status, 502); assert.equal(body.code, 'RECORDING_NETWORK_ERROR'); assert.ok(!body.error.includes('private'));
}));

Deno.test('Watch opens fresh audio when video is absent; Download reports audio-only explicitly', () => environment(async () => {
  const state=fixture();state.details={bot_id:botId,status:'completed',recording_mode:'audio_only',audio:'https://artifact.test/audio.flac'};
  const watch=await handler(request()); const data=await watch.json();
  assert.equal(watch.status,200);assert.equal(data.url,state.details.audio);assert.equal(data.metadata.artifact,'audio');assert.equal(data.metadata.format,'flac');
  const download=await handler(request('download'));assert.equal(download.status,409);assert.equal((await download.json()).code,'VIDEO_NOT_RECORDED');
}));

Deno.test('fresh provider URL still denied is a provider access error; missing storage after refresh is expired', () => environment(async () => {
  for(const status of [403,404,410]){
    const state=fixture();state.artifactResponse=()=>new Response(null,{status});
    const response=await handler(request());const body=await response.json();
    assert.equal(response.status,status===403?502:410);
    assert.equal(body.code,status===403?'PROVIDER_ACCESS_DENIED':'RECORDING_EXPIRED');
    assert.equal(state.providerCalls,status===410?1:2);
  }
}));
