import { ContextError, requireDb, UUID } from './context-utils.ts';
import { recordingUrl, sanitizeKey } from './meetingbaas.ts';

export function elevenLabsConfig() {
  const apiKey = sanitizeKey(Deno.env.get('ELEVENLABS_API_KEY'));
  const webhookId = sanitizeKey(Deno.env.get('ELEVENLABS_WEBHOOK_ID'));
  const secret = sanitizeKey(Deno.env.get('ELEVENLABS_WEBHOOK_SECRET'));
  const model = sanitizeKey(Deno.env.get('ELEVENLABS_MODEL_ID')) || 'scribe_v2';
  if (!apiKey || /^your[-_]/i.test(apiKey)) throw new ContextError('ELEVENLABS_API_KEY is not configured.');
  if (!webhookId || /^your[-_]/i.test(webhookId)) throw new ContextError('ELEVENLABS_WEBHOOK_ID is not configured.');
  if (!secret || /^your[-_]/i.test(secret)) throw new ContextError('ELEVENLABS_WEBHOOK_SECRET is not configured.');
  if (!['scribe_v2', 'scribe_v1'].includes(model)) throw new ContextError('ELEVENLABS_MODEL_ID must be scribe_v2 or scribe_v1.');
  return { apiKey, webhookId, model };
}

// ElevenLabs SDK protocol: HMAC-SHA256(timestamp.rawBody), hex, v0 signature.
export async function verifyElevenLabsRequest(req: Request, rawBody: string): Promise<boolean> {
  const secret = sanitizeKey(Deno.env.get('ELEVENLABS_WEBHOOK_SECRET'));
  const fields = (req.headers.get('elevenlabs-signature') || '').split(',').map((s) => s.trim());
  const timestamp = fields.find((s) => s.startsWith('t='))?.slice(2) || '';
  const signatures = fields.filter((s) => /^v0=[a-f0-9]{64}$/i.test(s)).map((s) => s.slice(3));
  if (!secret || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 1800) return false;
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const payload = new TextEncoder().encode(`${timestamp}.${rawBody}`);
    for (const signature of signatures) {
      const bytes = Uint8Array.from(signature.match(/../g)!, (s) => parseInt(s, 16));
      if (await crypto.subtle.verify('HMAC', key, bytes, payload)) return true;
    }
  } catch { /* malformed signature */ }
  return false;
}

export class ElevenLabsSubmissionError extends ContextError {
  constructor(message: string, public ambiguous: boolean) { super(message, 503); }
}

export async function submitElevenLabsTranscription(audioUrl: string, jobId: string, model: string): Promise<string> {
  const config = elevenLabsConfig();
  if (!UUID.test(jobId) || !/^https:\/\//i.test(audioUrl)) throw new ContextError('Invalid transcription job or audio URL.');
  const form = new FormData();
  form.set('model_id', model);
  form.set('source_url', audioUrl);
  form.set('diarize', 'true');
  form.set('tag_audio_events', 'false');
  form.set('timestamps_granularity', 'word');
  form.set('webhook', 'true');
  form.set('webhook_id', config.webhookId);
  form.set('webhook_metadata', JSON.stringify({ job_id: jobId }));
  let response: Response;
  try {
    response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST', headers: { 'xi-api-key': config.apiKey }, body: form,
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // Do not submit again blindly: the provider may already be processing/billing.
    throw new ElevenLabsSubmissionError('ElevenLabs submission is unconfirmed; check the provider job before retrying.', true);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ElevenLabsSubmissionError(`ElevenLabs rejected transcription: HTTP ${response.status}.`, response.status >= 500);
  }
  let result: any;
  try { result = await response.json(); } catch { /* response may be lost after acceptance */ }
  if (typeof result?.request_id !== 'string' || !result.request_id)
    throw new ElevenLabsSubmissionError('ElevenLabs accepted transcription without a request ID; check the provider job.', true);
  return result.request_id;
}

/** Convert diarized Scribe words into the existing utterance pipeline.
 * Speaker IDs are acoustic clusters, never MeetingBaaS participant IDs.
 */
export function elevenLabsTranscription(result: any) {
  if (!result || typeof result.text !== 'string' || !Array.isArray(result.words))
    throw new ContextError('Invalid ElevenLabs transcription result.', 400);
  const labels = new Map<string, string>();
  const utterances: any[] = [];
  const hasSpacing = result.words.some((w: any) => w?.type === 'spacing');
  const unspaced = /^(ja|jpn|zh|zho|cmn|yue|th|tha|lo|lao|my|mya)$/i.test(result.language_code || '');
  let current: any = null;
  let spacing = '';
  for (const [sourceIndex, word] of result.words.entries()) {
    if (word?.type === 'spacing') { spacing += String(word.text || ''); continue; }
    if (word?.type !== 'word' || typeof word.text !== 'string' || !word.text.trim()) continue;
    const id = typeof word.speaker_id === 'string' ? word.speaker_id : 'unknown';
    if (!labels.has(id)) labels.set(id, `Speaker ${labels.size + 1}`);
    const gap = current?.words.length && typeof word.start === 'number' && typeof current.words.at(-1)?.end === 'number'
      ? word.start - current.words.at(-1).end : 0;
    if (!current || current.cluster !== id || gap > 2) {
      current = { cluster: id, speaker_id: id, speaker: 'unknown', anonymous_speaker_label: labels.get(id), text: '', words: [] };
      utterances.push(current);
    }
    const separator = current.words.length ? (hasSpacing || unspaced ? spacing : ' ') : '';
    const confidence = typeof word.logprob === 'number' && Number.isFinite(word.logprob)
      ? Math.min(1, Math.exp(word.logprob)) : 0;
    const timed = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
    current.words.push({ word: word.text.trim(), separator, start: timed(word.start), end: timed(word.end), confidence,
      speaker_id: id, source_word_index: sourceIndex, logprob: word.logprob });
    current.start = current.words[0].start;
    current.end = timed(word.end);
    current.text += separator + word.text.trim();
    spacing = '';
  }
  if (!utterances.length && result.text.trim())
    utterances.push({ speaker: 'unknown', text: result.text.trim() });
  return { provider: 'elevenlabs', result: { utterances } };
}

/** Queue a recording exactly once; store attendance/diarization before URLs expire. */
export async function queueElevenLabsTranscription(admin: any, meeting: any, data: Record<string, any>) {
  const existing = await admin.from('meeting_transcription_jobs').select('*').eq('meeting_id', meeting.id).maybeSingle();
  requireDb(existing.error, 'Transcription job lookup (apply the ElevenLabs migration)');
  if (existing.data && !(existing.data.status === 'failed' && !existing.data.request_id && !existing.data.result))
    return { job_id: existing.data.id, status: existing.data.status, duplicate: true };
  const config = elevenLabsConfig();
  const model = data.extra?.revora?.transcription_model || config.model;
  if (!['scribe_v2', 'scribe_v1'].includes(model)) throw new ContextError('Invalid model recorded for this bot.');
  // Prefer the much smaller FLAC audio artifact; video remains a valid fallback.
  const audio = recordingUrl({ video: data.audio, mp4: data.mp3, audio: data.video, mp3: data.mp4 });
  if (!audio) throw new ContextError('MeetingBaaS audio is not available; retry completion.', 503);
  const recording = recordingUrl(data);
  const end = typeof data.exited_at === 'string' && Number.isFinite(Date.parse(data.exited_at))
    ? new Date(data.exited_at).toISOString() : meeting.ended_at || new Date().toISOString();
  let diarization = typeof data.diarization === 'string' && !data.diarization.startsWith('https://') ? data.diarization : null;
  if (typeof data.diarization === 'string' && data.diarization.startsWith('https://')) {
    try {
      const response = await fetch(data.diarization, { signal: AbortSignal.timeout(5000) });
      if (response.ok) diarization = await response.text();
      else await response.body?.cancel();
    } catch { /* Scribe's numbered speakers remain available without named diarization. */ }
  }
  const job = { id: existing.data?.id || crypto.randomUUID(), meeting_id: meeting.id, model, status: 'submitting',
    input_payload: { ...data, raw_meetingbaas_payload: data.raw_meetingbaas_payload ?? { event: 'bot.completed', data },
      diarization, transcription_provider: 'elevenlabs' }, error_message: null, updated_at: new Date().toISOString() };
  const inserted = existing.data
    ? await admin.from('meeting_transcription_jobs').update(job).eq('id', job.id).eq('status', 'failed').select().maybeSingle()
    : await admin.from('meeting_transcription_jobs').insert(job).select().maybeSingle();
  if (inserted.error?.code === '23505' || (!inserted.error && !inserted.data))
    return { status: 'queued', duplicate: true };
  requireDb(inserted.error, 'Transcription job creation');
  let submissionAttempted = false;
  try {
    // Only the job owner changes meeting state. A racing duplicate cannot move
    // an already processed meeting back to recording.
    const savedMeeting = await admin.from('meetings').update({ status: 'recording', processing_stage: 'transcript_processing',
      transcription_provider: 'elevenlabs', ended_at: end, raw_payload: { event: 'bot.completed', data },
      ...(recording ? { recording_url: recording } : {}), error_message: null })
      .eq('id', meeting.id).in('status', ['pending', 'recording', 'failed']);
    requireDb(savedMeeting.error, 'Recording persistence');
    submissionAttempted = true;
    const requestId = await submitElevenLabsTranscription(audio, job.id, model);
    // A fast ElevenLabs callback may already have advanced this job to ready.
    const saved = await admin.from('meeting_transcription_jobs').update({ request_id: requestId, status: 'queued',
      updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'submitting');
    requireDb(saved.error, 'Transcription request persistence');
    return { job_id: job.id, status: 'queued' };
  } catch (error) {
    const message = error instanceof ContextError ? error.message : 'Transcription submission failed.';
    const ambiguous = error instanceof ElevenLabsSubmissionError ? error.ambiguous : submissionAttempted;
    const status = ambiguous ? 'submission_unknown' : 'failed';
    // Never overwrite a result that arrived while the submission response was lost.
    await admin.from('meeting_transcription_jobs').update({ status, error_message: message, updated_at: new Date().toISOString() })
      .eq('id', job.id).eq('status', 'submitting');
    await admin.from('meetings').update({ error_message: message }).eq('id', meeting.id).eq('status', 'recording');
    throw error;
  }
}
