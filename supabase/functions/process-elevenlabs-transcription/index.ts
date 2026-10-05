import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { authenticate, corsHeaders, errorResponse, json, readBody } from '../_shared/context-http.ts';
import { ContextError, requireDb, UUID } from '../_shared/context-utils.ts';
import { processElevenLabsJob } from '../_shared/elevenlabs-processing.ts';

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
    if (!job.data) throw new ContextError('Transcription job not found.', 404);
    const status = await processElevenLabsJob(auth.admin, job.data.id, body.reprocess === true);
    return json({ success: true, status });
  } catch (error) { return errorResponse(error); }
}

serve(handleProcessElevenLabsTranscription);
