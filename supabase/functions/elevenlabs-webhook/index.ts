import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { json } from '../_shared/context-http.ts';
import { ContextError, requireDb, UUID } from '../_shared/context-utils.ts';
import { elevenLabsTranscription, verifyElevenLabsRequest } from '../_shared/elevenlabs.ts';
import { processElevenLabsJob } from '../_shared/elevenlabs-processing.ts';

export async function handleElevenLabsWebhook(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const raw = await req.text();
  if (!await verifyElevenLabsRequest(req, raw)) return json({ error: 'Invalid ElevenLabs signature.' }, 401);
  try {
    let body: any;
    try { body = JSON.parse(raw); } catch { throw new ContextError('Invalid JSON.', 400); }
    if (!['speech_to_text_transcription', 'speech_to_text.completed', 'speech_to_text.failed'].includes(body?.type))
      return json({ success: true, ignored: 'unsupported event' });
    const data = body.data;
    const jobId = data?.webhook_metadata?.job_id;
    if (!UUID.test(String(jobId || '')) || typeof data.request_id !== 'string' || !data.request_id)
      throw new ContextError('Missing transcription job metadata or request ID.', 400);
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new ContextError('Webhook database is not configured.', 503);
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const lookup = await admin.from('meeting_transcription_jobs').select('*').eq('id', jobId).maybeSingle();
    requireDb(lookup.error, 'Transcription job lookup');
    const job = lookup.data;
    if (!job) throw new ContextError('Transcription job is not available; retry delivery.', 503);
    if (job.request_id && job.request_id !== data.request_id) throw new ContextError('Transcription request ID mismatch.', 409);
    if (job.status === 'completed') return json({ success: true, duplicate: true });
    if (body.type === 'speech_to_text.failed' || data.status === 'failed') {
      // A late failure cannot overwrite a verified successful result.
      if (job.result) return json({ success: true, duplicate: true });
      const error_message = 'ElevenLabs transcription failed. Check the provider request for details.';
      const saved = await admin.from('meeting_transcription_jobs').update({ status: 'failed', request_id: data.request_id,
        error_message, updated_at: new Date().toISOString() }).eq('id', jobId).is('result', null);
      requireDb(saved.error, 'Transcription failure persistence');
      const meeting = await admin.from('meetings').update({ processing_stage: 'processing_failed', error_message })
        .eq('id', job.meeting_id).neq('status', 'summarized');
      requireDb(meeting.error, 'Meeting failure persistence');
      return json({ success: true });
    }
    if (!job.result) {
      // Validate before acknowledging; persist the raw result for safe retries.
      elevenLabsTranscription(data.transcription);
      const saved = await admin.from('meeting_transcription_jobs').update({ result: data.transcription,
        request_id: data.request_id, status: 'ready', error_message: null, updated_at: new Date().toISOString() })
        .eq('id', jobId).is('result', null);
      requireDb(saved.error, 'Transcription result persistence');
    }
    const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
    if (runtime?.waitUntil) {
      // Return promptly after durable receipt; Gemini runs outside delivery timeout.
      runtime.waitUntil(processElevenLabsJob(admin, jobId).catch(() => {
        console.warn('[ElevenLabs] Saved result processing failed; retry the processing endpoint.');
      }));
    } else {
      await processElevenLabsJob(admin, jobId);
    }
    return json({ success: true, job_id: jobId });
  } catch (error) {
    const message = error instanceof ContextError ? error.message : 'ElevenLabs webhook processing failed; retry delivery.';
    console.warn(`[ElevenLabs] ${message}`);
    return json({ success: false, error: message }, error instanceof ContextError ? error.status : 503);
  }
}

serve(handleElevenLabsWebhook);
