import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { authenticate, corsHeaders, errorResponse, json, readBody } from '../_shared/context-http.ts';
import { ContextError, requireDb, UUID } from '../_shared/context-utils.ts';
import { fetchVideo, RecordingError, saveRecording, signDownloadGrant } from '../_shared/meeting-recording.ts';

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed.' }, 405);
  try {
    const auth = await authenticate(req);
    const body = await readBody(req);
    if (!UUID.test(String(body.meeting_id || ''))) throw new ContextError('meeting_id must be a UUID.', 400);
    if (body.action && !['watch', 'download'].includes(body.action)) throw new ContextError('Unknown recording action.', 400);
    const lookup = () => auth.user!.from('meetings').select('id,user_id,bot_id,title,recording_metadata').eq('id', body.meeting_id).maybeSingle();
    const meeting = await lookup();
    requireDb(meeting.error, 'Meeting lookup');
    // Explicit ownership also protects projects still running old permissive RLS.
    const allowed = (row: any) => row && (auth.isAdmin || row.user_id === auth.userId);
    if (!meeting.data || !allowed(meeting.data)) throw new RecordingError('MEETING_ACCESS_DENIED', 'Meeting not found or access denied.', 403, 'auth_error');
    const artifact = await fetchVideo(auth.admin, meeting.data, 'bytes=0-31', req.signal, body.action !== 'download');
    await artifact.response.body?.cancel(); artifact.cleanup();
    if (artifact.response.status === 416) {
      await saveRecording(auth.admin, meeting.data.id, meeting.data.bot_id, { recording_status: 'processing',
        recording_metadata: { ...artifact.metadata, error_message: 'No playable recording bytes are available yet.' } });
      throw new RecordingError('RECORDING_PROCESSING', 'No playable recording bytes are available yet. Please try again shortly.', 202, 'processing');
    }
    const current = await lookup();
    if (current.error || !current.data || !allowed(current.data) || current.data.bot_id !== meeting.data.bot_id)
      throw new ContextError('Meeting access changed. Reload the meeting and try again.', 403);
    let url = artifact.url;
    if (body.action === 'download') {
      const grant = await signDownloadGrant({ meeting_id: meeting.data.id, bot_id: meeting.data.bot_id,
        user_id: auth.userId!,
        exp: Math.floor(Date.now() / 1000) + 120 });
      url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/download-meeting-recording?ticket=${encodeURIComponent(grant)}`;
    }
    const response = json({ success: true, status: 'ready', url,
      ...(body.action === 'download' ? { fallback_url: artifact.url } : {}),
      filename: `meeting-recording-${meeting.data.id}.mp4`, metadata: artifact.metadata });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    if (error instanceof RecordingError) {
      console.warn(`[Recording] ${error.code}: ${error.message}`);
      const response = json({ success: false, status: error.recordingStatus, code: error.code,
        error: error.message, ...(error.status === 202 ? { retry_after: 15 } : {}) }, error.status);
      response.headers.set('Cache-Control', 'private, no-store');
      if (error.status === 202) response.headers.set('Retry-After', '15');
      return response;
    }
    let response;
    if (error instanceof ContextError && error.status >= 500) {
      console.error(`[Recording] ${error.message}`);
      response = json({ success: false, code: 'RECORDING_SERVICE_UNAVAILABLE',
        error: 'The recording service is temporarily unavailable. Please try again shortly.' }, error.status);
    } else response = errorResponse(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
});
