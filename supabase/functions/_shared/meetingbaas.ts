import { ContextError } from './context-utils.ts';

// ElevenLabs batch transcription runs directly after MeetingBaaS records the call.
// MeetingBaaS supports ElevenLabs only in its separate WebSocket streaming API.
export const MEETINGBAAS_STT_PROVIDERS = new Set(['gladia', 'deepgram', 'assemblyai', 'speechmatics', 'soniox']);
export const STT_PROVIDERS = new Set([...MEETINGBAAS_STT_PROVIDERS, 'elevenlabs']);
export const sanitizeKey = (value: string | undefined): string => (value || '').replace(/^["'\s]+|["'\s]+$/g, '').trim();

export function transcriptionProvider(): string {
  const configured = sanitizeKey(Deno.env.get('SPEECH_TO_TEXT_PROVIDER')).toLowerCase();
  const provider = !configured || configured === 'default' ? 'elevenlabs' : configured;
  if (!STT_PROVIDERS.has(provider)) throw new ContextError('Unsupported SPEECH_TO_TEXT_PROVIDER. Choose elevenlabs or a documented MeetingBaaS batch provider.');
  return provider;
}

export function transcriptionConfig() {
  const provider = transcriptionProvider();
  if (provider === 'elevenlabs') return { provider };
  const apiKey = sanitizeKey(Deno.env.get('SPEECH_TO_TEXT_API_KEY'));
  const customParams: Record<string, unknown> = {};
  if (provider === 'gladia') {
    customParams.diarization = true;
    const vocabulary = Deno.env.get('GLADIA_CUSTOM_VOCABULARY')?.trim();
    if (vocabulary) {
      let terms: unknown;
      try { terms = JSON.parse(vocabulary); } catch { throw new ContextError('GLADIA_CUSTOM_VOCABULARY must be a JSON array of strings.'); }
      if (!Array.isArray(terms) || terms.length > 100 || terms.some((t) => typeof t !== 'string' || !t.trim() || t.length > 100))
        throw new ContextError('GLADIA_CUSTOM_VOCABULARY accepts at most 100 nonempty strings of at most 100 characters.');
      if (terms.length) {
        customParams.custom_vocabulary = true;
        customParams.custom_vocabulary_config = { vocabulary: [...new Set(terms.map((t: string) => t.trim()))] };
      }
    }
  }
  return { provider, ...(apiKey ? { api_key: apiKey } : {}),
    ...(Object.keys(customParams).length ? { custom_params: customParams } : {}) };
}

export function meetingBaasTranscriptionConfig(stt: ReturnType<typeof transcriptionConfig>) {
  return stt.provider === 'elevenlabs'
    ? { transcription_enabled: false }
    : { transcription_enabled: true, transcription_config: stt };
}

export function meetingBaasBaseUrl(): string {
  const raw = (Deno.env.get('MEETINGBAAS_API_BASE_URL') || 'https://api.meetingbaas.com').trim().replace(/\/+$/, '');
  if (/\/v1$/i.test(raw)) throw new ContextError('This integration requires MeetingBaaS v2. Set MEETINGBAAS_API_BASE_URL to the API origin or its /v2 URL.');
  return raw.replace(/\/v2$/i, '');
}

function timeout(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(Deno.env.get(name));
  return Math.min(max, Math.max(min, Number.isFinite(raw) && raw > 0 ? Math.round(raw) : fallback));
}

export function botCaptureConfig(botName: string) {
  const ownNames = new Set([botName, `${botName} (You)`, `${botName} (Guest)`].map((n) => n.trim().toLowerCase()));
  // MeetingBaaS handles its own identity. Only explicitly configured OTHER bots
  // belong here; never infer automation from a person's display name.
  const ignored = [...new Set((Deno.env.get('BOT_IGNORED_PARTICIPANT_NAMES') || '').split(',')
    .map((n) => n.trim()).filter((n) => n && !ownNames.has(n.toLowerCase())))];
  return {
    recording_mode: 'speaker_view',
    allow_multiple_bots: false,
    ignored_participant_names: ignored,
    timeout_config: {
      waiting_room_timeout: timeout('BOT_WAITING_ROOM_TIMEOUT', 300, 120, 1800),
      no_one_joined_timeout: timeout('BOT_NO_ONE_JOINED_TIMEOUT', 120, 120, 1800),
      silence_timeout: timeout('BOT_SILENCE_TIMEOUT', 300, 300, 3600),
      // Initial timeout suppression, NOT a reconnect debounce or an exit delay.
      grace_period: 0,
    },
  };
}

export function recordingUrl(data: Record<string, any>): string | null {
  // Some callbacks use mp4 instead of video. Never prefer audio over either.
  for (const value of [data.video, data.mp4, data.audio, data.mp3]) {
    if (typeof value !== 'string' || !value.trim()) continue;
    try { if (new URL(value).protocol === 'https:') return value; } catch { /* ignore malformed artifacts */ }
  }
  return null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function meetingBaasRequest(path: string, method = 'GET', body?: unknown, attempts = 3): Promise<any> {
  const key = sanitizeKey(Deno.env.get('MEETINGBAAS_API_KEY'));
  if (!key || /your[-_]meetingbaas/i.test(key)) throw new ContextError('MEETINGBAAS_API_KEY is not configured.');
  const url = `${meetingBaasBaseUrl()}/v2${path}`;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { method, headers: { 'x-meeting-baas-api-key': key, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
    } catch {
      if (attempt + 1 === attempts) throw new ContextError('MeetingBaaS network request failed; check the bot status before retrying.', 502);
      await sleep(500 * 2 ** attempt); continue;
    }
    let result: any = null;
    try { result = await response.json(); } catch { /* do not log provider responses: they can echo BYOK secrets */ }
    if (response.ok && result?.success !== false) return result?.data ?? result;
    if (response.status === 409 && method === 'POST' && path.endsWith('/leave') && result?.code === 'FST_ERR_BOT_STATUS') {
      // A conflict alone is not proof of departure; confirm the provider state.
      const current = await meetingBaasRequest(path.replace(/\/leave$/, ''));
      if (['completed', 'failed', 'transcribing', 'call_ended', 'recording_succeeded'].includes(current?.status)) return { already_left: true };
    }
    if ((response.status === 429 || response.status >= 500) && attempt + 1 < attempts) {
      const retry = Number(response.headers.get('retry-after')) * 1000;
      await sleep(Math.min(5000, Math.max(500 * 2 ** attempt, Number.isFinite(retry) ? retry : 0))); continue;
    }
    const code = typeof result?.code === 'string' && /^[A-Z0-9_]+$/.test(result.code) ? ` (${result.code})` : '';
    throw new ContextError(`MeetingBaaS request failed: HTTP ${response.status}${code}.`, response.status === 404 ? 404 : 502);
  }
}
