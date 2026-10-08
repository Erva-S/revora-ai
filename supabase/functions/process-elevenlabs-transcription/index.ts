import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { authenticate, corsHeaders, errorResponse, json, readBody } from '../_shared/context-http.ts';
import { ContextError, requireDb, UUID } from '../_shared/context-utils.ts';
import { processElevenLabsJob } from '../_shared/elevenlabs-processing.ts';
import { handleCompletion } from '../_shared/meeting-pipeline.ts';

// Admin/service recovery for a saved result interrupted by an Edge worker exit.
export async function handleProcessElevenLabsTranscription(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    const auth = await authenticate(req, true);
    if (!auth.isAdmin && !auth.isService) throw new ContextError('Admin access required.', 403);
    const body = await readBody(req);
    if (!UUID.test(String(body.meeting_id || ''))) throw new ContextError('meeting_id must be a UUID.', 400);
    const job = await auth.admin.from('meeting_transcription_jobs').select('id').eq('meeting_id', body.meeting_id).maybeSingle();
    requireDb(job.error, 'Transcription job lookup');
    if (!job.data && body.reprocess === true) {
      // The existing admin recovery endpoint also handles archived MeetingBaaS
      // batch sources. No provider call is made, and signed artifact URLs are unused.
      const meeting = await auth.admin.from('meetings').select('id,bot_id,ended_at').eq('id', body.meeting_id).maybeSingle();
      requireDb(meeting.error, 'Meeting lookup');
      if (!meeting.data) throw new ContextError('Meeting not found.', 404);
      let query = auth.admin.from('meeting_transcript_sources').select('payload,provider').eq('meeting_id', meeting.data.id);
      if (body.source_id) {
        if (!UUID.test(String(body.source_id))) throw new ContextError('source_id must be a UUID.', 400);
        query = query.eq('id', body.source_id);
      }
      const source = await query.order('received_at', { ascending: false }).limit(1).maybeSingle();
      requireDb(source.error, 'Archived transcript lookup');
      const payload = source.data?.payload;
      if (!payload?.standardized_transcription || typeof payload.standardized_transcription === 'string')
        throw new ContextError('No archived transcription JSON is available for this meeting.', 409);
      const original = payload.webhook_payload ?? {};
      const sourceBotId = original.data?.bot_id ?? original.bot_id;
      if (sourceBotId && sourceBotId !== meeting.data.bot_id) throw new ContextError('Archived source bot ID mismatch.', 409);
      const data = { ...(original.data ?? original), bot_id: meeting.data.bot_id,
        transcription: payload.standardized_transcription, raw_transcription: payload.provider_transcription,
        diarization: payload.diarization_artifact, raw_diarization: payload.diarization_artifact,
        transcription_provider: source.data?.provider, raw_meetingbaas_payload: original };
      return await handleCompletion(auth.admin, original, data, meeting.data.bot_id, meeting.data.id, meeting.data.ended_at, true);
    }
    if (!job.data) throw new ContextError('Transcription job not found; use reprocess:true for archived sources.', 404);
    const status = await processElevenLabsJob(auth.admin, job.data.id, body.reprocess === true);
    return json({ success: true, status });
  } catch (error) { return errorResponse(error); }
}

serve(handleProcessElevenLabsTranscription);
