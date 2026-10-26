import { ContextError, requireDb, UUID } from './context-utils.ts';
import { meetingBaasRequest, MeetingBaasError } from './meetingbaas.ts';
import { pipelineLog } from './pipeline-log.ts';

export class RecordingError extends ContextError {
  constructor(public code: string, message: string, status: number, public recordingStatus = 'unavailable') {
    super(message, status);
  }
}

export function videoUrl(data: Record<string, any>): string | null {
  return artifactUrl([data.video, data.mp4]);
}
export function audioUrl(data: Record<string, any>): string | null {
  return artifactUrl([data.audio, data.mp3]);
}
function artifactUrl(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
    } catch { /* malformed URLs are not artifacts */ }
  }
  return null;
}

const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : null;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** Stable metadata only: bot_id + video identifies the artifact; URLs are caches. */
export function recordingPatch(data: Record<string, any>, code?: string): Record<string, any> {
  const video = videoUrl(data), audio = audioUrl(data), url = video ?? audio;
  const status = code || (typeof data.status === 'string' ? data.status : data.status?.code) || '';
  let state = 'pending';
  if (data.artifacts_deleted || data.data_deleted) state = 'expired';
  else if (status === 'call_ended') state = 'processing';
  else if (url) state = 'ready';
  else if (['failed', 'recording_failed'].includes(status)) state = 'failed';
  else if (status === 'completed' || data.recording_mode === 'audio_only') state = 'unavailable';
  else if (['call_ended', 'recording_succeeded', 'transcribing', 'transcription_failed', 'api_request_stop', 'all_participants_left'].includes(status)) state = 'processing';
  else if (['in_call_recording', 'recording_paused', 'recording_resumed'].includes(status)) state = 'recording';
  const format = video ? 'mp4' : audio ? (data.audio ? 'flac' : 'mp3') : null;
  const metadata: Record<string, any> = { provider: 'meetingbaas', artifact: video ? 'video' : audio ? 'audio' : null, format };
  if (data.bot_id) metadata.bot_id = data.bot_id;
  if (data.recording_mode) metadata.recording_mode = data.recording_mode;
  if (number(data.duration_seconds) !== null) metadata.duration_seconds = data.duration_seconds;
  if (date(data.created_at)) metadata.bot_created_at = date(data.created_at);
  if (date(data.joined_at)) metadata.joined_at = date(data.joined_at);
  if (date(data.exited_at)) metadata.exited_at = date(data.exited_at);
  if (date(data.completed_at)) metadata.completed_at = date(data.completed_at);
  if (url) {
    metadata.artifact_path = new URL(url).pathname;
  }
  return { recording_status: state, recording_metadata: metadata,
    ...(['expired', 'unavailable', 'failed'].includes(state) ? { recording_url: null } : url ? { recording_url: url } : {}) };
}

export async function saveRecording(admin: any, meetingId: string, botId: string, patch: Record<string, any>) {
  const started = Date.now();
  let query = admin.from('meetings').update(patch).eq('id', meetingId).eq('bot_id', botId);
  if (patch.recording_status !== 'expired') query = query.or('recording_status.is.null,recording_status.neq.expired');
  const saved = await query.select('id').maybeSingle();
  requireDb(saved.error, 'Recording metadata persistence (apply the recording-access migration)');
  if (!saved.data) {
    const current = await admin.from('meetings').select('recording_status').eq('id', meetingId).eq('bot_id', botId).maybeSingle();
    if (!current.error && current.data?.recording_status === 'expired')
      throw new RecordingError('RECORDING_EXPIRED', 'The recording was deleted or expired while access was being refreshed.', 410, 'expired');
    throw new RecordingError('RECORDING_MEETING_CHANGED', 'The meeting recording identifier changed. Reload the meeting.', 409, 'failed');
  }
  pipelineLog('recording_metadata_save', meetingId, botId, { duration_ms: Date.now()-started,
    status: patch.recording_status, http_status: 200 });
}

export async function freshRecording(admin: any, meeting: Record<string, any>, allowAudio = false) {
  const started = Date.now();
  if (!UUID.test(String(meeting.bot_id || '')))
    throw new RecordingError('MISSING_BOT_ID', 'Recording cannot be refreshed because this meeting has no valid recording identifier.', 404);
  let details;
  try { details = await meetingBaasRequest(`/bots/${meeting.bot_id}`); }
  catch (error) {
    const http = error instanceof MeetingBaasError ? error.providerStatus : 502;
    pipelineLog('recording_refresh', meeting.id, meeting.bot_id, { duration_ms: Date.now()-started, http_status: http });
    await saveRecording(admin, meeting.id, meeting.bot_id, { recording_status: http === 404 ? 'unavailable' : 'failed',
      recording_metadata: { ...(meeting.recording_metadata ?? {}), provider_http_status: http,
        error_message: 'MeetingBaaS recording metadata lookup failed.' } });
    if (error instanceof ContextError && error.status === 404)
      throw new RecordingError('RECORDING_NOT_FOUND', 'MeetingBaaS could not find this meeting recording.', 404);
    if ([401,403].includes(http)) throw new RecordingError('PROVIDER_AUTH_ERROR',
      'MeetingBaaS rejected server recording access. Your administrator must check the provider API key and team.', 502, 'failed');
    throw new RecordingError('PROVIDER_UNAVAILABLE', 'The recording service is temporarily unavailable. Please try again shortly.', 502);
  }
  if (!details || typeof details !== 'object' || Array.isArray(details) ||
      (details.bot_id && details.bot_id !== meeting.bot_id)) {
    await saveRecording(admin, meeting.id, meeting.bot_id, { recording_status: 'failed',
      recording_metadata: { ...(meeting.recording_metadata ?? {}), error_message: 'Provider returned invalid recording metadata.' } });
    throw new RecordingError('INVALID_RECORDING_METADATA', 'The recording service returned incomplete recording information. Please retry shortly.', 502);
  }
  // An empty/malformed response is not evidence that a recording is processing.
  if (!videoUrl(details) && !audioUrl(details) && typeof details.status !== 'string' && !details.artifacts_deleted && !details.data_deleted) {
    await saveRecording(admin, meeting.id, meeting.bot_id, { recording_status: 'failed',
      recording_metadata: { ...(meeting.recording_metadata ?? {}), error_message: 'Provider returned incomplete recording metadata.' } });
    throw new RecordingError('INVALID_RECORDING_METADATA', 'The recording service returned incomplete recording information. Please retry shortly.', 502);
  }
  const patch = recordingPatch({ ...details, bot_id: meeting.bot_id });
  await saveRecording(admin, meeting.id, meeting.bot_id, patch);
  if (patch.recording_status === 'expired')
    throw new RecordingError('RECORDING_EXPIRED', 'The recording was deleted under the MeetingBaaS retention policy.', 410, 'expired');
  pipelineLog('recording_refresh', meeting.id, meeting.bot_id, { duration_ms: Date.now()-started, http_status: 200, status: patch.recording_status });
  if (['pending','recording','processing'].includes(patch.recording_status))
    throw new RecordingError('RECORDING_PROCESSING', 'Recording is still being processed. Please try again shortly.', 202, 'processing');
  const url = videoUrl(details) ?? (allowAudio ? audioUrl(details) : null);
  if (!url) {
    if (audioUrl(details) || details.recording_mode === 'audio_only')
      throw new RecordingError('VIDEO_NOT_RECORDED', 'Only audio is available for this meeting. Use Watch to open the audio; an MP4 download is unavailable.', 409);
    throw new RecordingError('RECORDING_UNAVAILABLE', 'Recording is unavailable because MeetingBaaS did not return a video recording artifact.', 404, patch.recording_status);
  }
  return { url, metadata: patch.recording_metadata };
}

/** Signed artifact URLs authorize GET, not HEAD. No API key goes to storage. */
export async function fetchVideo(admin: any, meeting: Record<string, any>, range?: string, signal?: AbortSignal, allowAudio = false) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const artifact = await freshRecording(admin, meeting, allowAudio);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    // Time out obtaining headers, not an entire multi-gigabyte download.
    const timer = setTimeout(abort, 15000);
    let response: Response;
    try { response = await fetch(artifact.url, { headers: range ? { Range: range } : {}, signal: controller.signal }); }
    catch {
      signal?.removeEventListener('abort', abort);
      await saveRecording(admin, meeting.id, meeting.bot_id, { recording_status: 'failed',
        recording_metadata: { ...artifact.metadata, error_message: 'Provider recording file network request failed.' } });
      throw new RecordingError('RECORDING_NETWORK_ERROR', 'The recording file could not be reached. Please try again shortly.', 502);
    } finally { clearTimeout(timer); }
    const type = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    const acceptedTypes = artifact.metadata.artifact === 'audio'
      ? ['audio/flac','audio/x-flac','audio/mpeg','audio/mp3','application/octet-stream','binary/octet-stream']
      : ['video/mp4', 'application/octet-stream', 'binary/octet-stream'];
    if ((response.status === 200 || response.status === 206) && response.body && acceptedTypes.includes(type)) {
      const total = response.headers.get('content-range')?.match(/\/(\d+)$/)?.[1] ||
        (response.status === 200 ? response.headers.get('content-length') : null);
      if (total && Number.isSafeInteger(Number(total))) artifact.metadata.size_bytes = Number(total);
      artifact.metadata.content_type = type;
      if (artifact.metadata.artifact === 'audio') {
        if (['audio/mpeg','audio/mp3'].includes(type)) artifact.metadata.format = 'mp3';
        if (['audio/flac','audio/x-flac'].includes(type)) artifact.metadata.format = 'flac';
      }
      artifact.metadata.accept_ranges = response.headers.get('accept-ranges') === 'bytes' || response.status === 206;
      try { await saveRecording(admin, meeting.id, meeting.bot_id,
        { recording_status: 'ready', recording_metadata: artifact.metadata }); }
      catch (error) { await response.body.cancel(); signal?.removeEventListener('abort', abort); throw error; }
      return { response, metadata: artifact.metadata, url: artifact.url,
        cleanup: () => signal?.removeEventListener('abort', abort) };
    }
    await response.body?.cancel();
    signal?.removeEventListener('abort', abort);
    pipelineLog('recording_storage', meeting.id, meeting.bot_id, { http_status: response.status, attempt: attempt+1 });
    if ([401, 403, 404].includes(response.status) && attempt === 0) continue;
    if (response.status === 416) return { response, metadata: artifact.metadata, url: artifact.url, cleanup: () => {} };
    if ([401,403,404,410].includes(response.status)) {
      const state = response.status === 403 || response.status === 401 ? 'failed' : 'expired';
      await saveRecording(admin, meeting.id, meeting.bot_id, { recording_status: state,
        recording_url: null, recording_metadata: { ...artifact.metadata, storage_http_status: response.status } });
      throw new RecordingError(state === 'expired' ? 'RECORDING_EXPIRED' : 'PROVIDER_ACCESS_DENIED',
        state === 'expired' ? 'The recording file is no longer available from the provider.'
          : 'The provider rejected a newly refreshed recording link. Please contact your administrator.',
        state === 'expired' ? 410 : 502, state);
    }
    await saveRecording(admin, meeting.id, meeting.bot_id, { recording_status: 'failed',
      recording_metadata: { ...artifact.metadata, storage_http_status: response.status } });
    throw new RecordingError(response.ok ? 'INVALID_RECORDING_CONTENT' : 'RECORDING_FILE_UNAVAILABLE',
      response.ok ? 'The recording service did not return a video file.' : 'The recording file could not be opened after refreshing its access link. Please try again shortly.', 502);
  }
  throw new RecordingError('RECORDING_FILE_UNAVAILABLE', 'The recording file could not be opened. Please retry shortly.', 502);
}

export type DownloadGrant = { meeting_id: string; bot_id: string; user_id: string; exp: number };
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function ticketKey() {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) throw new ContextError('Recording access is not configured.');
  return await crypto.subtle.importKey('raw', new TextEncoder().encode(`revora:recording-download:v1:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signDownloadGrant(grant: DownloadGrant) {
  const payload = encode(new TextEncoder().encode(JSON.stringify(grant)));
  const signature = await crypto.subtle.sign('HMAC', await ticketKey(), new TextEncoder().encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function verifyDownloadGrant(token: string): Promise<DownloadGrant> {
  try {
    if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error();
    const [payload, signature] = token.split('.');
    if (!await crypto.subtle.verify('HMAC', await ticketKey(), decode(signature), new TextEncoder().encode(payload))) throw new Error();
    const grant = JSON.parse(new TextDecoder().decode(decode(payload)));
    if (Object.keys(grant).sort().join(',') !== 'bot_id,exp,meeting_id,user_id' ||
        ![grant.meeting_id, grant.bot_id, grant.user_id].every((id) => UUID.test(String(id))) ||
        !Number.isSafeInteger(grant.exp) || grant.exp <= Math.floor(Date.now() / 1000) || grant.exp > Math.floor(Date.now() / 1000)+120) throw new Error();
    return grant;
  } catch { throw new RecordingError('DOWNLOAD_ACCESS_EXPIRED', 'Download access has expired. Click Download Recording again.', 401); }
}
