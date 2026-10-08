import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { corsHeaders, json } from '../_shared/context-http.ts';
import { ContextError, requireDb } from '../_shared/context-utils.ts';
import { fetchVideo, RecordingError, saveRecording, verifyDownloadGrant } from '../_shared/meeting-recording.ts';
import type { DownloadGrant } from '../_shared/meeting-recording.ts';
import { pipelineLog } from '../_shared/pipeline-log.ts';

const mediaHeaders = { ...corsHeaders, 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': `${corsHeaders['Access-Control-Allow-Headers']}, range`,
  'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length, Content-Range, Accept-Ranges, X-Recording-Code, X-Recording-Status, Retry-After',
  'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };

serve(async (req: Request): Promise<Response> => {
  const started = Date.now();
  if (req.method === 'OPTIONS') return new Response('ok', { headers: mediaHeaders });
  if (!['GET', 'HEAD'].includes(req.method)) return json({ success: false, error: 'Method not allowed.' }, 405);
  let grant: DownloadGrant | undefined;
  try {
    // Native browser downloads cannot attach session headers. Authenticate the
    // two-minute, meeting/user/bot-scoped grant minted by the JWT/RLS endpoint.
    grant = await verifyDownloadGrant(new URL(req.url).searchParams.get('ticket') || '');
    const range = req.headers.get('range');
    if (range && (!/^bytes=\d*-\d*$/.test(range) || range === 'bytes=-' ||
        range.slice(6).split('-').some((n) => n && !Number.isSafeInteger(Number(n))) ||
        (range.startsWith('bytes=-') && Number(range.slice(7)) === 0) ||
        (/^bytes=\d+-\d+$/.test(range) && Number(range.split('-')[1]) < Number(range.slice(6).split('-')[0]))))
      throw new ContextError('Only a single valid byte range is supported.', 416);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const lookup = async () => {
      const [meeting, profile] = await Promise.all([
        admin.from('meetings').select('id,user_id,bot_id,title,recording_metadata').eq('id', grant!.meeting_id).maybeSingle(),
        admin.from('profiles').select('role').eq('id', grant!.user_id).maybeSingle(),
      ]);
      requireDb(meeting.error, 'Recording permission lookup'); requireDb(profile.error, 'Recording role lookup');
      if (!profile.data || !meeting.data || meeting.data.bot_id !== grant!.bot_id ||
          (profile.data.role !== 'admin' && meeting.data.user_id !== grant!.user_id))
        throw new RecordingError('DOWNLOAD_ACCESS_DENIED', 'Meeting not found or recording access denied.', 403);
      return meeting.data;
    };
    const meeting = await lookup();
    const media = await fetchVideo(admin, meeting, req.method === 'HEAD' ? 'bytes=0-0' : range || undefined, req.signal);
    try { await lookup(); } catch (error) { await media.response.body?.cancel(); media.cleanup(); throw error; }
    const headers = new Headers({ ...mediaHeaders, 'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="meeting-recording-${meeting.id}.mp4"`,
      'X-Content-Type-Options': 'nosniff' });
    for (const name of ['content-length', 'content-range', 'accept-ranges']) {
      const value = media.response.headers.get(name); if (value) headers.set(name, value);
    }
    if (media.response.status === 416) { media.cleanup(); return new Response(null, { status: 416, headers }); }
    if (req.method === 'HEAD') {
      await media.response.body?.cancel(); media.cleanup(); headers.delete('content-range');
      if (media.metadata.size_bytes !== undefined) headers.set('content-length', String(media.metadata.size_bytes));
      return new Response(null, { status: 200, headers });
    }
    // Backpressure-aware byte streaming: no transcoding or whole-video buffer.
    const reader = media.response.body!.getReader();
    let bytes = 0;
    let cancelled = false;
    const expected = media.response.headers.get('content-length');
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            if (expected !== null && bytes !== Number(expected)) throw new Error('Incomplete recording stream.');
            media.cleanup(); pipelineLog('recording_stream', meeting.id, meeting.bot_id, {
              duration_ms: Date.now()-started, bytes, http_status: media.response.status }); controller.close();
          } else { bytes += next.value.byteLength; controller.enqueue(next.value); }
        } catch {
          media.cleanup(); if (cancelled) return;
          pipelineLog('recording_stream_failed', meeting.id, meeting.bot_id, {
            duration_ms: Date.now()-started, bytes, http_status: 502 });
          try { await saveRecording(admin, meeting.id, meeting.bot_id, { recording_status: 'failed',
            recording_metadata: { ...media.metadata, error_message: 'Recording download interrupted; refresh access and retry.' } }); }
          catch { pipelineLog('recording_failure_state_save_failed', meeting.id, meeting.bot_id, { http_status: 503 }); }
          controller.error(new Error('Recording download interrupted.'));
        }
      },
      async cancel(reason) { cancelled = true; media.cleanup(); await reader.cancel(reason); },
    });
    return new Response(stream, { status: media.response.status, headers });
  } catch (error) {
    const message = error instanceof RecordingError ? error.message : error instanceof ContextError && error.status < 500
      ? error.message : 'The recording download failed. Please try again shortly.';
    const status = error instanceof ContextError ? error.status : 500;
    console.warn(`[Recording] download rejected code=${error instanceof RecordingError ? error.code : 'DOWNLOAD_ERROR'} http=${status}`);
    pipelineLog('recording_stream_rejected', grant?.meeting_id ?? null, grant?.bot_id ?? null, { duration_ms: Date.now()-started, http_status: status });
    const response = json({ success: false, error: message, status: error instanceof RecordingError ? error.recordingStatus : 'failed',
      code: error instanceof RecordingError ? error.code : 'DOWNLOAD_ERROR' }, status);
    for (const [name,value] of Object.entries(mediaHeaders)) response.headers.set(name,value);
    response.headers.set('X-Recording-Code', error instanceof RecordingError ? error.code : 'DOWNLOAD_ERROR');
    response.headers.set('X-Recording-Status', error instanceof RecordingError ? error.recordingStatus : 'failed');
    if (status === 202) response.headers.set('Retry-After','15');
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
});
