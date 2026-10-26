import assert from 'node:assert/strict';
import { botCaptureConfig, meetingBaasRequest, recordingUrl, transcriptionConfig } from '../functions/_shared/meetingbaas.ts';
import { verifyMeetingBaasRequest } from '../functions/_shared/meetingbaas-auth.ts';

async function environment(values: Record<string, string | undefined>, run: () => Promise<void> | void) {
  const previous = Object.fromEntries(Object.keys(values).map((k) => [k, Deno.env.get(k)]));
  const original = globalThis.fetch;
  try {
    for (const [key, value] of Object.entries(values)) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
    await run();
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of Object.entries(previous)) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
  }
}

Deno.test('Gladia platform key is retained; vocabulary and BYOK use the documented batch fields', () => environment({
  SPEECH_TO_TEXT_PROVIDER: 'gladia', SPEECH_TO_TEXT_API_KEY: undefined, GLADIA_CUSTOM_VOCABULARY: '["Revora","Kubernetes"]',
}, () => {
  assert.deepEqual(transcriptionConfig(), { provider: 'gladia', custom_params: { diarization: true,
    custom_vocabulary: true, custom_vocabulary_config: { vocabulary: ['Revora', 'Kubernetes'] } } });
  Deno.env.set('SPEECH_TO_TEXT_API_KEY', 'test-provider-key');
  assert.equal(transcriptionConfig().api_key, 'test-provider-key');
  Deno.env.set('SPEECH_TO_TEXT_PROVIDER', 'deepgram');
  assert.deepEqual(transcriptionConfig(), { provider: 'deepgram', api_key: 'test-provider-key' });
  Deno.env.set('SPEECH_TO_TEXT_PROVIDER', 'typo');
  assert.throws(transcriptionConfig, /Unsupported/);
}));

Deno.test('capture settings constrain fallbacks, prevent duplicate bots and ignore only configured other bots', () => environment({
  BOT_IGNORED_PARTICIPANT_NAMES: 'Revora,Revora (You),Other Bot,Other Bot', BOT_SILENCE_TIMEOUT: '1',
  BOT_WAITING_ROOM_TIMEOUT: '9999', BOT_NO_ONE_JOINED_TIMEOUT: 'NaN',
}, () => {
  assert.deepEqual(botCaptureConfig('Revora'), { recording_mode: 'speaker_view', allow_multiple_bots: false,
    ignored_participant_names: ['Other Bot'], timeout_config: { grace_period: 0, silence_timeout: 300,
      waiting_room_timeout: 1800, no_one_joined_timeout: 120 } });
}));

Deno.test('recording selection prefers video aliases over audio and rejects malformed URLs', () => {
  assert.equal(recordingUrl({ audio: 'https://artifact.test/audio.flac', mp4: 'https://artifact.test/video.mp4' }), 'https://artifact.test/video.mp4');
  assert.equal(recordingUrl({ video: '', audio: 'https://artifact.test/audio.flac' }), 'https://artifact.test/audio.flac');
  assert.equal(recordingUrl({ video: 'javascript:alert(1)' }), null);
});

const apiEnv = { MEETINGBAAS_API_KEY: 'test-api-key', MEETINGBAAS_API_BASE_URL: 'https://meetingbaas.example.test/v2' };
Deno.test('leave retries rate-limit, network and server failures without inventing endpoints', () => environment(apiEnv, async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://meetingbaas.example.test/v2/bots/test-bot/leave');
    assert.equal(init?.method, 'POST');
    calls++;
    if (calls === 1) throw new TypeError('network');
    if (calls === 2) return Response.json({}, { status: 429 });
    return Response.json({ success: true, data: { message: 'accepted' } });
  };
  assert.deepEqual(await meetingBaasRequest('/bots/test-bot/leave', 'POST'), { message: 'accepted' });
  assert.equal(calls, 3);
  globalThis.fetch = async () => Response.json({}, { status: 503 });
  await assert.rejects(meetingBaasRequest('/bots/test-bot/leave', 'POST', undefined, 1), /HTTP 503/);
}));

Deno.test('leave 404 is an error; 409 is idempotent only after provider-state confirmation', () => environment(apiEnv, async () => {
  globalThis.fetch = async () => Response.json({}, { status: 404 });
  await assert.rejects(meetingBaasRequest('/bots/test-bot/leave', 'POST'), /HTTP 404/);
  globalThis.fetch = async (_url, init) => init?.method === 'POST'
    ? Response.json({ code: 'FST_ERR_BOT_STATUS' }, { status: 409 }) : Response.json({ success: true, data: { status: 'completed' } });
  assert.equal((await meetingBaasRequest('/bots/test-bot/leave', 'POST')).already_left, true);
}));

Deno.test('create network ambiguity is never retried on another API version and secrets are not surfaced', () => environment(apiEnv, async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('private provider payload'); };
  await assert.rejects(meetingBaasRequest('/bots', 'POST', {}, 1), /check the bot status/);
  assert.equal(calls, 1);
  globalThis.fetch = async () => Response.json({ message: 'api_key=private', code: 'FST_ERR_VALIDATION' }, { status: 400 });
  try { await meetingBaasRequest('/bots', 'POST', {}, 1); assert.fail(); }
  catch (e) { assert.ok(!(e as Error).message.includes('private')); }
}));

Deno.test('Svix lifecycle signatures use the raw body and reject tampering/replay; callback secret still works', () => environment({
  MEETINGBAAS_WEBHOOK_SIGNING_SECRET: `whsec_${btoa('test-signing-key')}`, MEETINGBAAS_WEBHOOK_SECRET: 'test-callback-key',
}, async () => {
  const raw = '{ "event": "bot.status_change" }';
  const ts = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('test-signing-key'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`msg_test.${ts}.${raw}`)))));
  const req = new Request('https://local.test', { headers: { 'svix-id': 'msg_test', 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` } });
  assert.equal(await verifyMeetingBaasRequest(req, raw), true);
  assert.equal(await verifyMeetingBaasRequest(req, '{}'), false);
  req.headers.set('svix-timestamp', '1');
  assert.equal(await verifyMeetingBaasRequest(req, raw), false);
  assert.equal(await verifyMeetingBaasRequest(new Request('https://local.test', { headers: { 'x-mb-secret': 'test-callback-key' } }), raw), true);
  assert.equal(await verifyMeetingBaasRequest(new Request('https://local.test'), raw), false);
}));
