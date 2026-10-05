import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { corsHeaders, json } from '../_shared/context-http.ts';
import { ContextError, requireDb } from '../_shared/context-utils.ts';
import { fetchVideo, RecordingError, verifyDownloadGrant } from '../_shared/meeting-recording.ts';
import type { DownloadGrant } from '../_shared/meeting-recording.ts';

const mediaHeaders = { ...corsHeaders, 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': `${corsHeaders['Access-Control-Allow-Headers']}, range`,
  'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length, Content-Range, Accept-Ranges',
  'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: mediaHeaders });
  if (!['GET', 'HEAD'].includes(req.method)) return json({ success: false, error: 'Method not allowed.' }, 405);
  let grant: DownloadGrant | undefined;
  try {
    // Native browser downloads cannot attach session headers. Authenticate the
    // two-minute, meeting/user/bot-scoped grant minted by the JWT/RLS endpoint.
    // Retain verified claims for notifying the app of expiry, never for access.
    grant = await verifyDownloadGrant(new URL(req.url).searchParams.get('ticket') || '', true);
    if (grant.exp <= Math.floor(Date.now() / 1000))
      throw new RecordingError('DOWNLOAD_ACCESS_EXPIRED', 'Download access has expired. Click Download Recording again.', 401);
    const range = req.headers.get('range');
    if (range && (!/^bytes=\d*-\d*$/.test(range) || range === 'bytes=-' ||
        range.slice(6).split('-').some((n) => n && !Number.isSafeInteger(Number(n)))))
      throw new ContextError('Only a single valid byte range is supported.', 416);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const lookup = async () => {
      const [meeting, profile] = await Promise.all([
        admin.from('meetings').select('id,user_id,bot_id,title').eq('id', grant!.meeting_id).maybeSingle(),
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
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) { media.cleanup(); controller.close(); } else controller.enqueue(next.value);
        } catch { media.cleanup(); console.error(`[Recording] download stream interrupted meeting=${meeting.id}`); controller.error(new Error('Recording download interrupted.')); }
      },
      async cancel(reason) { media.cleanup(); await reader.cancel(reason); },
    });
    return new Response(stream, { status: media.response.status, headers });
  } catch (error) {
    const message = error instanceof RecordingError ? error.message : error instanceof ContextError && error.status < 500
      ? error.message : 'The recording download failed. Please try again shortly.';
    const status = error instanceof ContextError ? error.status : 500;
    console.warn(`[Recording] download rejected code=${error instanceof RecordingError ? error.code : 'DOWNLOAD_ERROR'} http=${status}`);
    // Supabase's standard domain rewrites GET text/html to text/plain. Use a
    // static page on the signed frontend origin to report iframe errors instead.
    if (grant?.origin && req.method === 'GET') {
      const callback = new URL('/recording-download-status.html', grant.origin);
      callback.searchParams.set('request_id', grant.request_id);
      callback.searchParams.set('message', message);
      return new Response(null, { status: 302, headers: { ...mediaHeaders, Location: callback.href } });
    }
    const response = json({ success: false, error: message, code: error instanceof RecordingError ? error.code : 'DOWNLOAD_ERROR' }, status);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
});
