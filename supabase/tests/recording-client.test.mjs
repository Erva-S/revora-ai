import test from 'node:test';
import assert from 'node:assert/strict';
import { requestRecording, startRecordingDownload } from '../../src/lib/recordingAccess.js';

test('recording client distinguishes processing, missing deployment, API failure and ready video', async () => {
  const client = (result) => ({ functions: { invoke: async (name, options) => {
    assert.equal(name, 'get-meeting-recording'); assert.deepEqual(options.body, { meeting_id: 'meeting', action: 'download' }); return result;
  } } });
  const processing = await requestRecording(client({ data: { success: false, status: 'processing', error: 'Still processing' } }), 'meeting', 'download');
  assert.equal(processing.status, 'processing'); assert.equal(processing.error, 'Still processing');
  const missing = await requestRecording(client({ error: { context: Response.json({ code: 'NOT_FOUND' }) } }), 'meeting', 'download');
  assert.match(missing.error, /administrator/);
  const expiredSession = await requestRecording(client({ error: { context: Response.json({ message: 'Invalid JWT' }, { status: 401 }) } }), 'meeting', 'download');
  assert.match(expiredSession.error, /sign in again/);
  const failure = await requestRecording(client({ error: { context: Response.json({ code: 'RECORDING_UNAVAILABLE', error: 'No video artifact' }) } }), 'meeting', 'download');
  assert.equal(failure.error, 'No video artifact');
  const readyResult = { data: { success: true, status: 'ready', url: 'https://backend.test/file', request_id: 'request' } };
  const ready = await requestRecording(client(readyResult), 'meeting', 'download', async (url, options) => {
    assert.equal(url, 'https://backend.test/file'); assert.equal(options.method, 'HEAD'); return new Response(null, { headers: { 'Content-Type': 'video/mp4' } });
  });
  assert.equal(ready.success, true);
  const missingDownload = await requestRecording(client(readyResult), 'meeting', 'download', async () => new Response(null, { status: 404 }));
  assert.equal(missingDownload.success, false); assert.match(missingDownload.error, /administrator/);
  assert.equal((await requestRecording(client({ data: { success: true, url: 'javascript:bad' } }), 'meeting', 'download')).success, false);
});

test('native download starts without buffering a blob and cleanup removes the frame', () => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const frames = []; let cleanup;
  const fakeWindow = { location: { origin: 'https://app.test' },
  };
  globalThis.window = fakeWindow;
  globalThis.document = {
    createElement: () => ({ contentWindow: {}, removed: false, remove() { this.removed = true; } }),
    body: { appendChild: (frame) => frames.push(frame) },
  };
  try {
    cleanup = startRecordingDownload({ url: 'https://backend.test/download?ticket=scoped-grant' });
    const frame = frames[0]; assert.equal(frame.hidden, true); assert.match(frame.src, /download\?ticket=/);
    cleanup(); assert.equal(frame.removed, true);
  } finally {
    cleanup?.();
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
});

test('HTTP deployment/auth/expiry errors never become network errors; actual transport failure does', async () => {
  for(const [http,state]of [[404,'unavailable'],[401,'auth_error'],[403,'auth_error'],[410,'expired'],[202,'processing']]){
    const client={functions:{invoke:async()=>({error:{context:new Response(null,{status:http})}})}};
    const failure=await requestRecording(client,'meeting','watch');
    assert.equal(failure.status,state);assert.equal(failure.http_status,http);assert.ok(!failure.error.includes('connection'));
  }
  const failed=await requestRecording({functions:{invoke:async()=>{throw new TypeError('fetch failed');}}},'meeting','watch');
  assert.equal(failed.status,'network_error');
});
