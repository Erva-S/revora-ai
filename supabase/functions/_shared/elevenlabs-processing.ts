import { ContextError, requireDb } from './context-utils.ts';
import { elevenLabsTranscription } from './elevenlabs.ts';
import { handleCompletion } from './meeting-pipeline.ts';
import { pipelineLog } from './pipeline-log.ts';

/** Consume a durable result with a five-minute lease; no extra STT API call. */
export async function processElevenLabsJob(admin: any, jobId: string, reprocess = false): Promise<string> {
  const lookup = await admin.from('meeting_transcription_jobs').select('*').eq('id', jobId).maybeSingle();
  requireDb(lookup.error, 'Transcription job lookup');
  const job = lookup.data;
  if (!job) throw new ContextError('Transcription job not found.', 404);
  if (job.status === 'completed' && !reprocess) return 'completed';
  if (!job.result) throw new ContextError('ElevenLabs has not delivered the transcription result yet.', 409);
   if (job.status === 'processing' && Date.parse(job.updated_at) > Date.now() - 600000) return 'processing';
  const claimed = await admin.from('meeting_transcription_jobs').update({ status: 'processing', error_message: null,
    updated_at: new Date().toISOString() }).eq('id', jobId).eq('updated_at', job.updated_at)
    .in('status', reprocess ? ['ready', 'processing', 'completed'] : ['ready', 'processing']).select().maybeSingle();
  requireDb(claimed.error, 'Transcription job claim');
  if (!claimed.data) return 'processing';
  try {
    const target = await admin.from('meetings').select('id,bot_id,status,summary,ended_at').eq('id', job.meeting_id).maybeSingle();
    requireDb(target.error, 'Meeting lookup');
    if (!target.data || target.data.bot_id !== job.input_payload.bot_id)
      throw new ContextError('Transcription job no longer matches its meeting.');
    if (target.data.status !== 'summarized' || reprocess) {
      const data = { ...job.input_payload, transcription: elevenLabsTranscription(job.result),
        raw_transcription: job.result, raw_diarization: job.input_payload.diarization,
        raw_meetingbaas_payload: job.input_payload.raw_meetingbaas_payload ?? { event: 'bot.completed', data: job.input_payload },
        transcription_provider: 'elevenlabs', transcription_model: job.model };
      const response = await handleCompletion(admin, { event: 'elevenlabs.completed', data }, data,
        target.data.bot_id, target.data.id, target.data.ended_at, reprocess);
      if (response.status === 202) throw new ContextError('Meeting transcript is already processing.', 503);
      if (!response.ok) throw new ContextError('Transcription completion failed.');
    }
    const saved = await admin.from('meeting_transcription_jobs').update({ status: 'completed', error_message: null,
      updated_at: new Date().toISOString() }).eq('id', jobId).eq('status', 'processing');
    requireDb(saved.error, 'Transcription job completion');
    return 'completed';
  } catch (error) {
    const message = 'Transcription result is saved, but processing failed; retry process-elevenlabs-transcription.';
    const jobState = await admin.from('meeting_transcription_jobs').update({ status: 'ready', error_message: message,
      updated_at: new Date().toISOString() }).eq('id', jobId).eq('status', 'processing');
    const meetingState = await admin.from('meetings').update({ processing_stage: 'processing_failed', error_message: message })
      .eq('id', job.meeting_id).neq('status', 'summarized');
    pipelineLog('stt_processing_failed', job.meeting_id, job.input_payload.bot_id, {
      http_status: 503, job_id: jobId, state_saved: !jobState.error && !meetingState.error });
    throw error;
  }
}
