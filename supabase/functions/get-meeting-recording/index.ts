import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { authenticate, corsHeaders, errorResponse, json, readBody } from '../_shared/context-http.ts';
import { ContextError, requireDb, UUID } from '../_shared/context-utils.ts';
import { meetingBaasRequest, recordingUrl } from '../_shared/meetingbaas.ts';

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed.' }, 405);
  try {
    const auth = await authenticate(req);
    const body = await readBody(req);
    if (!UUID.test(String(body.meeting_id || ''))) throw new ContextError('meeting_id must be a UUID.', 400);
    const lookup = () => auth.user!.from('meetings').select('id,bot_id,recording_url').eq('id', body.meeting_id).maybeSingle();
    // The user's RLS, never a service-role lookup, grants recording access.
    const meeting = await lookup();
    requireDb(meeting.error, 'Meeting lookup');
    if (!meeting.data) throw new ContextError('Meeting not found or access denied.', 404);
    let url = recordingUrl({ video: meeting.data.recording_url });
    if (meeting.data.bot_id) {
      if (!UUID.test(meeting.data.bot_id)) throw new ContextError('Recording has no valid MeetingBaaS bot ID.', 400);
      const details = await meetingBaasRequest(`/bots/${meeting.data.bot_id}`);
      if (details?.artifacts_deleted || details?.data_deleted) throw new ContextError('Recording has expired under the MeetingBaaS retention policy.', 410);
      url = recordingUrl(details || {});
    }
    if (!url) throw new ContextError('Recording is not available from MeetingBaaS yet, or has been removed.', 404);
    const current = await lookup();
    if (current.error || !current.data || current.data.bot_id !== meeting.data.bot_id)
      throw new ContextError('Meeting access changed. Reload the meeting and try again.', 403);
    const response = json({ success: true, url });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) { return errorResponse(error); }
});
