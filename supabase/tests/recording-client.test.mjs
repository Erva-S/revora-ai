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

test('native download errors require matching frontend origin, frame and request ID; cleanup removes listeners', () => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const frames = [], failures = []; let listener; let cleanup;
  const fakeWindow = { location: { origin: 'https://app.test' },
    addEventListener: (_name, callback) => { listener = callback; },
    removeEventListener: (_name, callback) => { if (listener === callback) listener = undefined; } };
  globalThis.window = fakeWindow;
  globalThis.document = {
    createElement: () => ({ contentWindow: {}, removed: false, remove() { this.removed = true; } }),
    body: { appendChild: (frame) => frames.push(frame) },
  };
  try {
    cleanup = startRecordingDownload({ url: 'https://backend.test/download?ticket=scoped-grant', request_id: 'request' }, (error) => failures.push(error));
    const frame = frames[0]; assert.equal(frame.hidden, true); assert.match(frame.src, /download\?ticket=/);
    const event = { origin: 'https://app.test', source: frame.contentWindow,
      data: { type: 'revora-recording-download-error', request_id: 'request', error: 'File unavailable' } };
    listener({ ...event, origin: 'https://attacker.test' });
    listener({ ...event, source: {} });
    listener({ ...event, data: { ...event.data, request_id: 'other' } });
    assert.equal(failures.length, 0);
    listener(event); assert.deepEqual(failures, ['File unavailable']);
    assert.equal(frame.removed, true); assert.equal(listener, undefined);
  } finally {
    cleanup?.();
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
});
