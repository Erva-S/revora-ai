import assert from 'node:assert/strict';
import { handler } from './capture-server.ts';
import '../functions/download-meeting-recording/index.ts';
import { signDownloadGrant } from '../functions/_shared/meeting-recording.ts';

const id = '00000000-0000-4000-8000-000000000001';
const botId = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
async function environment(run: () => Promise<void>) {
  const values = { SUPABASE_URL: 'https://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    MEETINGBAAS_API_KEY: 'test-provider', MEETINGBAAS_API_BASE_URL: 'https://provider.test' };
  const previous = Object.fromEntries(Object.keys(values).map((k) => [k, Deno.env.get(k)]));
  const original = globalThis.fetch;
  try { for (const [k, v] of Object.entries(values)) Deno.env.set(k, v); await run(); }
  finally { globalThis.fetch = original; for (const [k, v] of Object.entries(previous)) { if (v === undefined) Deno.env.delete(k); else Deno.env.set(k, v); } }
}
const token = (override = {}) => signDownloadGrant({ meeting_id: id, bot_id: botId, user_id: id,
  exp: Math.floor(Date.now() / 1000) + 120, request_id: other, origin: null, ...override });
const request = (ticket: string, headers = {}, method = 'GET') => new Request(`https://supabase.test/function?ticket=${ticket}`, { method, headers });
function fixture() {
  const state: any = { meeting: { id, user_id: id, bot_id: botId }, role: 'user', reads: 0, providerCalls: 0, ranges: [],
    video: Uint8Array.from([0, 0, 0, 32, 102, 116, 121, 112, 105, 115, 111, 109]) };
  globalThis.fetch = async (input, init) => {
    const url = String(input), headers = new Headers(init?.headers);
    if (url.includes('/rest/v1/')) {
      assert.equal(headers.get('authorization'), 'Bearer test-service');
      if (url.includes('/profiles')) return Response.json(state.role ? [{ role: state.role }] : []);
      if (init?.method === 'PATCH') return new Response(null, { status: 204 });
      state.reads++; return Response.json(state.revoked && state.reads > 1 ? [] : [state.meeting]);
    }
    if (url.includes('/v2/bots/')) { state.providerCalls++; return Response.json({ data: { bot_id: botId, status: 'completed', video: 'https://storage.test/video.mp4' }, success: true }); }
    assert.equal(url, 'https://storage.test/video.mp4'); assert.equal(headers.get('x-meeting-baas-api-key'), null);
    state.ranges.push(headers.get('range'));
    return state.response?.() || new Response(state.video, { headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(state.video.length), 'Accept-Ranges': 'bytes' } });
  };
  return state;
}

Deno.test('native download returns actual unmodified video bytes with attachment headers, not JSON or redirects', () => environment(async () => {
  const state = fixture(); const response = await handler(request(await token()));
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.match(response.headers.get('content-disposition')!, /attachment; filename="meeting-recording-.*\.mp4"/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), state.video); assert.equal(state.reads, 2);
  assert.equal(state.providerCalls, 1); assert.deepEqual(state.ranges, [null]);
}));

Deno.test('download preserves Range/206 and total file size for native resumable requests', () => environment(async () => {
  const state = fixture(); state.response = () => new Response(state.video.slice(2, 5), { status: 206,
    headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 2-4/12', 'Content-Length': '3' } });
  const response = await handler(request(await token(), { Range: 'bytes=2-4' }));
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 2-4/12');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), state.video.slice(2, 5));
  assert.deepEqual(state.ranges, ['bytes=2-4']);
}));

Deno.test('proxy HEAD uses signed GET probe and reports full file size without a response body', () => environment(async () => {
  const state = fixture(); state.response = () => new Response(state.video.slice(0, 1), { status: 206,
    headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-0/12', 'Content-Length': '1' } });
  const response = await handler(request(await token(), {}, 'HEAD'));
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-length'), '12');
  assert.equal(await response.text(), ''); assert.deepEqual(state.ranges, ['bytes=0-0']);
}));

Deno.test('unsigned, tampered and expired grants are rejected before DB/provider access', () => environment(async () => {
  globalThis.fetch = async () => { throw new Error('Invalid grants must not contact a service'); };
  const signed = await token();
  for (const invalid of ['', `${signed.slice(0, 10)}x${signed.slice(11)}`, await token({ exp: 1 })])
    assert.equal((await handler(request(invalid))).status, 401);
}));

Deno.test('ownership change, bot substitution and revoked account deny the download', () => environment(async () => {
  for (const change of ['owner', 'bot', 'profile']) {
    const state = fixture();
    if (change === 'owner') state.meeting.user_id = other;
    if (change === 'bot') state.meeting.bot_id = other;
    if (change === 'profile') state.role = null;
    assert.equal((await handler(request(await token()))).status, 403); assert.equal(state.providerCalls, 0);
  }
  const state = fixture(); state.revoked = true;
  assert.equal((await handler(request(await token()))).status, 403);
}));

Deno.test('verified admin grants work for legacy ownerless rows and downgraded admins lose access', () => environment(async () => {
  const state = fixture(); state.meeting.user_id = null; state.role = 'admin';
  const response = await handler(request(await token())); assert.equal(response.status, 200); await response.body?.cancel();
  state.role = 'user'; assert.equal((await handler(request(await token()))).status, 403);
}));

Deno.test('malformed multi-ranges are rejected; upstream unsatisfiable ranges return 416 safely', () => environment(async () => {
  const state = fixture();
  assert.equal((await handler(request(await token(), { Range: 'bytes=0-1,4-5' }))).status, 416);
  assert.equal(state.providerCalls, 0);
  state.response = () => new Response('storage XML should not leak', { status: 416, headers: { 'Content-Range': 'bytes */12' } });
  const response = await handler(request(await token(), { Range: 'bytes=99-100' }));
  assert.equal(response.status, 416); assert.equal(response.headers.get('content-range'), 'bytes */12'); assert.equal(await response.text(), '');
}));

Deno.test('pre-stream download failures notify only the ticket-bound frontend origin/request', () => environment(async () => {
  const state = fixture(); state.meeting.user_id = other;
  const response = await handler(request(await token({ origin: 'https://app.test' })));
  assert.equal(response.status, 302);
  const callback = new URL(response.headers.get('location')!);
  assert.equal(callback.origin, 'https://app.test'); assert.equal(callback.pathname, '/recording-download-status.html');
  assert.equal(callback.searchParams.get('request_id'), other);
  assert.ok(callback.searchParams.get('message')!.includes('access denied')); assert.ok(!callback.href.includes('test-service'));
  const expired = await handler(request(await token({ origin: 'https://app.test', exp: 1 })));
  assert.equal(expired.status, 302); assert.ok(new URL(expired.headers.get('location')!).searchParams.get('message')!.includes('Download access has expired'));
}));

Deno.test('large downloads are backpressure streamed and cancellation reaches storage', () => environment(async () => {
  const state = fixture(); let pulled = 0, cancelled = false;
  state.response = () => new Response(new ReadableStream({
    pull(controller) { if (++pulled > 1000) controller.close(); else controller.enqueue(new Uint8Array(65536)); },
    cancel() { cancelled = true; },
  }), { headers: { 'Content-Type': 'video/mp4' } });
  const response = await handler(request(await token()));
  assert.equal(response.status, 200); assert.ok(pulled < 10, 'do not eagerly buffer the whole recording');
  await response.body!.cancel(); assert.equal(cancelled, true);
}));
