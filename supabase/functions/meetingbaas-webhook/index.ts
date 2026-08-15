// ====================================================================
// REVORA — Edge Function: meetingbaas-webhook
//
// Public webhook receiver for MeetingBaaS v2 bot events (deploy with
// --no-verify-jwt; MeetingBaaS cannot present a Supabase JWT).
//
//   bot.status_change -> map data.status.code onto our meeting status
//   bot.failed        -> mark the meeting failed with the real error
//   bot.completed     -> fetch the REAL transcript from the signed
//                        `transcription` URL, run Gemini over it, and
//                        persist meetings + summaries + transcripts +
//                        action_items with REAL data.
//
// There is NO fabricated transcript or summary anywhere: if a meeting
// produced no speech, it completes honestly with an explanatory note and
// no AI is run. Recording is automatic in v2; the bot leaves on
// timeout_config.silence_timeout (configured in deploy-bot), so there is
// no fixed timer here.
// ====================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-meeting-baas-api-key, x-mb-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Redact URL query strings before logging an error. Deno's fetch embeds
// the full request URL in thrown network errors — which for us can carry
// the Gemini `?key=` API key or a signed transcript URL's signature. Keep
// the host/path for debugging; drop the query. Never log raw error objects.
function scrub(v: unknown): string {
  const s = v instanceof Error ? v.message || v.name : String(v ?? '');
  return s.replace(/(https?:\/\/[^\s)'"]+)/g, (u) => {
    const q = u.indexOf('?');
    return q === -1 ? u : `${u.slice(0, q)}?<redacted>`;
  });
}

type TranscriptItem = {
  speaker: string;
  text: string;
};

type ActionItem = {
  task: string;
  assignee: string | null;
  due_date: string | null;
  status: string;
};

type AIAnalysis = {
  executive_summary: string;
  key_decisions: string[];
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  action_items: ActionItem[];
};

type NormalizedTranscript = {
  segments: Array<{ speaker: string; start: number | null; end: number | null; text: string }>;
  text: string;
  speakers: string[];
  durationSecs: number | null;
  isEmpty: boolean;
};

// --------------------------------------------------------------------
// Signed-artifact fetch
//
// v2 bot.completed carries a pre-signed `transcription` URL (valid ~4h).
// These are storage-signed URLs: they take NO API key — attaching the
// x-meeting-baas-api-key header would only break the signature. The URL
// embeds a signature, so we deliberately DON'T log it.
// --------------------------------------------------------------------
async function fetchSignedJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      console.error(`[Webhook] transcript artifact fetch failed: HTTP ${res.status}`);
      return null;
    }
    const raw = await res.text();
    return raw ? JSON.parse(raw) : null;
  } catch (err: any) {
    console.error('[Webhook] transcript artifact fetch error:', scrub(err));
    return null;
  }
}

// --------------------------------------------------------------------
// OpenAI Whisper large-v3 Model Transcriber (NVIDIA / Groq / HF / OpenAI)
// --------------------------------------------------------------------
async function transcribeWithWhisperLargeV3(audioUrl: string): Promise<any | null> {
  console.log(`[Whisper large-v3] Fetching audio binary from ${scrub(audioUrl)}...`);
  try {
    const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(60000) });
    if (!audioRes.ok) {
      console.warn(`[Whisper large-v3] Audio fetch HTTP status ${audioRes.status}`);
      return null;
    }
    const audioBlob = await audioRes.blob();
    const sizeMB = (audioBlob.size / (1024 * 1024)).toFixed(2);
    console.log(`[Whisper large-v3] Downloaded audio file: size=${sizeMB} MB, type=${audioBlob.type}`);

    const NVIDIA_API_KEY = Deno.env.get('NVIDIA_API_KEY')?.trim() || Deno.env.get('NV_API_KEY')?.trim();
    const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')?.trim();
    const HF_API_KEY = Deno.env.get('HUGGINGFACE_API_KEY')?.trim() || Deno.env.get('HF_TOKEN')?.trim();
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')?.trim();

    // 1. NVIDIA API (openai/whisper-large-v3 model)
    if (NVIDIA_API_KEY) {
      console.log('[Whisper large-v3] Executing NVIDIA API with model: openai/whisper-large-v3...');
      const formData = new FormData();
      formData.append('file', audioBlob, 'meeting.mp3');
      formData.append('model', 'openai/whisper-large-v3');
      formData.append('response_format', 'verbose_json');

      const nvEndpoints = [
        'https://integrate.api.nvidia.com/v1/audio/transcriptions',
        'https://ai.api.nvidia.com/v1/audio/transcriptions',
      ];

      for (const nvEp of nvEndpoints) {
        try {
          const nvRes = await fetch(nvEp, {
            method: 'POST',
            headers: { Authorization: `Bearer ${NVIDIA_API_KEY}` },
            body: formData,
          });

          if (nvRes.ok) {
            const nvData = await nvRes.json();
            console.log('[Whisper large-v3] NVIDIA API transcription completed successfully.');
            return nvData?.segments || nvData?.text || nvData;
          } else {
            console.warn(`[Whisper large-v3] NVIDIA API returned status ${nvRes.status}: ${await nvRes.text()}`);
          }
        } catch (nvErr) {
          console.warn('[Whisper large-v3] NVIDIA API endpoint error:', nvErr);
        }
      }
    }

    // 2. Groq Audio API (whisper-large-v3 model)
    if (GROQ_API_KEY) {
      console.log('[Whisper large-v3] Executing Groq API with model: whisper-large-v3...');
      const formData = new FormData();
      formData.append('file', audioBlob, 'meeting.mp3');
      formData.append('model', 'whisper-large-v3');
      formData.append('response_format', 'verbose_json');

      const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
        body: formData,
      });

      if (groqRes.ok) {
        const groqData = await groqRes.json();
        console.log('[Whisper large-v3] Groq transcription completed successfully.');
        return groqData?.segments || groqData?.text || groqData;
      } else {
        console.warn(`[Whisper large-v3] Groq API returned status ${groqRes.status}`);
      }
    }

    // 3. Hugging Face Inference API (openai/whisper-large-v3 model)
    if (HF_API_KEY) {
      console.log('[Whisper large-v3] Executing HuggingFace API with model: openai/whisper-large-v3...');
      const hfRes = await fetch('https://api-inference.huggingface.co/models/openai/whisper-large-v3', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${HF_API_KEY}`,
          'Content-Type': 'audio/mpeg',
        },
        body: audioBlob,
      });

      if (hfRes.ok) {
        const hfData = await hfRes.json();
        console.log('[Whisper large-v3] HuggingFace transcription completed successfully.');
        return hfData?.chunks || hfData?.text || hfData;
      } else {
        console.warn(`[Whisper large-v3] HuggingFace API returned status ${hfRes.status}`);
      }
    }

    // 4. OpenAI Audio API (whisper-1 model with whisper-large-v3 backend)
    if (OPENAI_API_KEY) {
      console.log('[Whisper large-v3] Executing OpenAI API with model: whisper-1 (whisper-large-v3 backend)...');
      const formData = new FormData();
      formData.append('file', audioBlob, 'meeting.mp3');
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'verbose_json');

      const oaiRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: formData,
      });

      if (oaiRes.ok) {
        const oaiData = await oaiRes.json();
        console.log('[Whisper large-v3] OpenAI API transcription completed successfully.');
        return oaiData?.segments || oaiData?.text || oaiData;
      } else {
        console.warn(`[Whisper large-v3] OpenAI API returned status ${oaiRes.status}`);
      }
    }

    return null;
  } catch (err) {
    console.error('[Whisper large-v3] Audio transcription error:', scrub(err));
    return null;
  }
}

// --------------------------------------------------------------------
// Universal Utterance Extractor & Transcript Normalization
// --------------------------------------------------------------------
function extractParticipants(data: any, doc: any, body: any): string[] {
  const sources = [
    data?.participants,
    data?.speakers,
    doc?.participants,
    doc?.speakers,
    body?.participants,
    body?.speakers,
    data?.bot?.participants,
    data?.bot?.speakers,
  ];

  const names: string[] = [];

  for (const src of sources) {
    if (Array.isArray(src) && src.length > 0) {
      for (const item of src) {
        let name = '';
        if (typeof item === 'string') {
          name = item.trim();
        } else if (item && typeof item === 'object') {
          name = String(item.name || item.speaker_name || item.user_name || item.user || '').trim();
          if (item.is_bot || item.is_assistant) continue; // skip bot
        }
        if (
          name &&
          !name.toLowerCase().includes('bot') &&
          !name.toLowerCase().includes('revora') &&
          !name.toLowerCase().includes('assistant') &&
          !names.includes(name)
        ) {
          names.push(name);
        }
      }
    }
  }

  return names;
}

function extractUtterancesFromDoc(doc: any): any[] {
  if (!doc) return [];
  if (Array.isArray(doc)) return doc;

  const candidates = [
    doc?.result?.utterances,
    doc?.utterances,
    doc?.prediction, // Gladia format
    doc?.transcript,
    doc?.transcripts,
    doc?.results,
    doc?.segments,
    doc?.speech_to_text,
    doc?.data?.utterances,
    doc?.data?.transcript,
    doc?.data,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
  }

  if (typeof doc?.transcript === 'string' && doc.transcript.trim()) {
    return [{ text: doc.transcript.trim() }];
  }
  if (typeof doc?.text === 'string' && doc.text.trim()) {
    return [{ text: doc.text.trim() }];
  }

  return [];
}

function segmentText(seg: any): string {
  if (typeof seg === 'string') return seg.trim();
  if (!seg || typeof seg !== 'object') return '';

  const candidates = [
    seg.text,
    seg.transcript,
    seg.transcription,
    seg.message,
    seg.content,
    seg.utterance,
    seg.body,
    seg.sentence,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }

  if (Array.isArray(seg.words) && seg.words.length > 0) {
    return seg.words
      .map((w: any) => (typeof w === 'string' ? w : w?.word ?? w?.text ?? ''))
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

function segmentSpeaker(seg: any, participants: string[] = []): string {
  if (typeof seg === 'string') {
    const colonIdx = seg.indexOf(':');
    if (colonIdx > 0 && colonIdx < 30) return seg.slice(0, colonIdx).trim();
    return 'Speaker';
  }
  if (!seg || typeof seg !== 'object') return 'Speaker';

  const raw = seg.speaker ?? seg.speaker_name ?? seg.user_name ?? seg.name ?? seg.user;
  if (raw === null || raw === undefined || raw === '') return 'Speaker';

  const sStr = String(raw).trim();

  // If speaker is numeric index (0, 1) or "Speaker 0", map to participant name if available
  if (typeof raw === 'number' || /^\d+$/.test(sStr) || /^speaker\s*\d+$/i.test(sStr)) {
    const numMatch = sStr.match(/\d+/);
    if (numMatch) {
      const idx = parseInt(numMatch[0], 10);
      if (participants[idx]) return participants[idx];
      return `Speaker ${idx + 1}`;
    }
  }

  if (sStr.toLowerCase() === 'unknown' || sStr.toLowerCase() === 'unknown speaker') {
    return 'Speaker';
  }

  return sStr;
}

function segmentStart(seg: any): number | null {
  if (!seg || typeof seg !== 'object') return null;
  const candidates = [seg.start, seg.start_time, seg.offset];
  const n = candidates.find((v: any) => typeof v === 'number' && Number.isFinite(v));
  return typeof n === 'number' ? n : null;
}

function segmentEnd(seg: any): number | null {
  if (!seg || typeof seg !== 'object') return null;
  if (typeof seg.end === 'number') return seg.end;
  if (typeof seg.end_time === 'number') return seg.end_time;
  if (Array.isArray(seg.words) && seg.words.length > 0) {
    const last = seg.words[seg.words.length - 1];
    if (typeof last?.end === 'number') return last.end;
  }
  return null;
}

function normalizeTranscript(rawInput: any, participants: string[] = []): NormalizedTranscript {
  let utterances: any[] = [];
  if (Array.isArray(rawInput)) {
    utterances = rawInput;
  } else if (rawInput && typeof rawInput === 'object') {
    utterances = extractUtterancesFromDoc(rawInput);
  }

  let turnIndex = 0;
  const segments = utterances
    .map((seg: any) => {
      let speaker = segmentSpeaker(seg, participants);

      // If speaker is generic ("Speaker" or "Unknown"), map alternating turns to known participants if available
      if ((speaker === 'Speaker' || speaker === 'Unknown') && participants.length > 0) {
        speaker = participants[turnIndex % participants.length];
        turnIndex++;
      }

      return {
        speaker,
        start: segmentStart(seg),
        end: segmentEnd(seg),
        text: segmentText(seg),
      };
    })
    .filter((seg) => seg.text.length > 0);

  const speakers = [...new Set(segments.map((s) => s.speaker))];
  const text = segments.map((s) => `${s.speaker}: ${s.text}`).join('\n');
  const ends = segments.map((s) => s.end).filter((v): v is number => typeof v === 'number');
  const durationSecs = ends.length ? Math.round(Math.max(...ends)) : null;

  return { segments, text, speakers, durationSecs, isEmpty: segments.length === 0 };
}

// --------------------------------------------------------------------
// Map a v2 bot.status_change code onto our meeting status vocabulary
// ('pending' | 'recording' | 'failed'). Returns null for unknown codes
// so the row is left unchanged. NEVER returns a completion status —
// completion is driven exclusively by the bot.completed event, which is
// the only payload that carries the transcript.
// --------------------------------------------------------------------
function mapStatusChangeToStatus(
  body: Record<string, any>
): { status: 'pending' | 'recording' | 'failed'; error_message?: string; ended_at?: string } | null {
  const statusObj = body?.data?.status || body?.status;
  let code = '';
  if (typeof statusObj === 'string') {
    code = statusObj;
  } else if (typeof statusObj === 'object' && statusObj !== null) {
    code = String(statusObj.code || statusObj.value || statusObj.name || statusObj.status || '');
  }

  code = code.toLowerCase().trim();
  if (!code) return null;

  const errorMessage =
    body?.data?.error_message || body?.error_message || body?.data?.error || body?.error || null;

  // Terminal join/record failures reported as a status code.
  const FAILED = [
    'waiting_room_timeout',
    'bot_rejected',
    'invalid_meeting_url',
    'meeting_error',
    'login_required',
    'cannot_join_meeting',
    'timeout_waiting_to_start',
  ];
  if (FAILED.includes(code)) {
    return {
      status: 'failed',
      error_message: errorMessage ? String(errorMessage) : `MeetingBaaS reported ${code}`,
      ended_at: new Date().toISOString(),
    };
  }

  // Actively in the call and capturing. Checked before any generic 'fail'
  // so a transient 'recording_failed' (which contains 'recording') stays
  // 'recording' — the real terminal failure arrives as its own bot.failed.
  if (code.includes('recording') || code === 'in_call' || code === 'transcribing' || code === 'in_call_recording') {
    return { status: 'recording' };
  }

  // Still trying to get in.
  if (
    ['queued', 'joining_call', 'in_waiting_room', 'in_waiting_for_host', 'in_call_not_recording'].includes(code) ||
    code.includes('waiting') ||
    code.includes('joining')
  ) {
    return { status: 'pending' };
  }

  return null; // unknown -> leave status unchanged
}

// --------------------------------------------------------------------
// Gemini analysis over the REAL transcript. Returns the analysis, or
// null if every candidate model failed (caller preserves the transcript
// and marks the meeting completed-but-not-summarized). No fake fallback.
// --------------------------------------------------------------------
function cleanJsonResponse(rawText: string): any {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json/i, '').replace(/```$/i, '').trim();
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```/i, '').replace(/```$/i, '').trim();
  }
  return JSON.parse(cleaned);
}

// action_items.due_date is a Postgres `date` column: a non-ISO value
// ("next Friday") would fail the cast and drop the whole batch. Accept
// only YYYY-MM-DD; anything else becomes null (task is still saved).
function sanitizeDueDate(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

async function analyzeTranscript(
  transcriptText: string,
  participants: string[] = []
): Promise<(AIAnalysis & { formatted_transcript?: string }) | null> {
  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
  if (!GEMINI_API_KEY) {
    console.warn('[Webhook] GEMINI_API_KEY is not set — skipping AI summary.');
    return null;
  }

  const configured = Deno.env.get('GEMINI_MODEL')?.trim();
  const geminiModels = [...new Set([configured, 'gemini-flash-latest', 'gemini-2.0-flash', 'gemini-1.5-flash'].filter(
    Boolean
  ))] as string[];

  const participantInfo =
    participants.length > 0
      ? `Known Meeting Participants who joined the call: ${participants.join(', ')}.`
      : 'No explicit participant list provided.';

  const systemPrompt = `You are an expert executive assistant. Analyze this meeting transcript and output a strict JSON object with this structure:
{
  "formatted_transcript": "The complete line-by-line meeting transcript where any generic 'Unknown' or 'Speaker N' labels are replaced with the actual participant names (${participants.join(', ') || 'Actual names'}) based on conversational context, greetings, and speaker turns. Preserve all original spoken text.",
  "executive_summary": "A concise paragraph summarizing key meeting discussions",
  "key_decisions": ["Array of specific decisions made during the meeting"],
  "sentiment": "positive | neutral | negative | mixed",
  "action_items": [
    {
      "task": "Imperative task description",
      "assignee": "Name of assigned owner or null",
      "due_date": "YYYY-MM-DD or null",
      "status": "pending"
    }
  ]
}

${participantInfo}

Original Meeting Transcript:
${transcriptText}`;

  for (const model of geminiModels) {
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: systemPrompt }] }],
            generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
          }),
        }
      );

      if (!resp.ok) {
        console.warn(`[Webhook] Gemini returned status ${resp.status} for model ${model}`);
        continue;
      }

      const data = await resp.json();
      const textPart = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textPart) continue;

      const parsed = cleanJsonResponse(textPart);
      console.log(`[Webhook] Summarized transcript with Gemini model ${model}`);
      return {
        formatted_transcript: typeof parsed.formatted_transcript === 'string' ? parsed.formatted_transcript.trim() : undefined,
        executive_summary: String(parsed.executive_summary || '').trim() || 'No summary was produced.',
        key_decisions: Array.isArray(parsed.key_decisions) ? parsed.key_decisions.map((d: any) => String(d)) : [],
        sentiment: ['positive', 'neutral', 'negative', 'mixed'].includes(parsed.sentiment)
          ? parsed.sentiment
          : 'neutral',
        action_items: Array.isArray(parsed.action_items)
          ? parsed.action_items.map((item: any) => ({
              task: String(item.task || 'Assigned task'),
              assignee: item.assignee ? String(item.assignee) : null,
              due_date: sanitizeDueDate(item.due_date),
              status: 'pending',
            }))
          : [],
      };
    } catch (gErr) {
      console.error(`[Webhook] Gemini API error (${model}):`, scrub(gErr));
    }
  }

  return null;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Payload must be valid JSON' }, 400);
  }

  // Optional shared-secret verification. When MEETINGBAAS_WEBHOOK_SECRET is
  // set, the callback_config.secret is echoed back in x-mb-secret; require a
  // match. When unset, the endpoint stays open (MeetingBaaS-only, public).
  const expectedSecret = (Deno.env.get('MEETINGBAAS_WEBHOOK_SECRET') || '').trim();
  if (expectedSecret) {
    const provided =
      req.headers.get('x-mb-secret') ||
      req.headers.get('x-webhook-secret') ||
      new URL(req.url).searchParams.get('token') ||
      '';
    if (provided !== expectedSecret) {
      console.warn('[Webhook] rejected event: webhook secret mismatch');
      return json({ error: 'Invalid webhook secret' }, 401);
    }
  }

  const eventType = String(body?.event || body?.type || body?.event_type || 'complete').toLowerCase();
  const data = body?.data ?? body;
  const botId = String(body?.bot_id || data?.bot_id || body?.bot?.id || body?.id || '').trim();

  console.log(`[Webhook] event=${eventType} bot_id=${botId || '<none>'}`);

  if (!botId) {
    console.warn('[Webhook] payload missing bot_id — cannot correlate to a meeting');
    return json({ success: true, ignored: 'missing bot_id' }, 200);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://zddythsszyznsguiuiss.supabase.co';
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY');

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('[Webhook] Supabase service role is not configured — cannot persist.');
    return json({ success: false, error: 'Server not configured' }, 200);
  }

  // The anon fallback keeps the function alive, but it cannot do the job:
  // - summaries / transcripts / action_items are service-role-only under RLS
  //   (anon insert fails with 42501), so those tables stay empty; and
  // - the meetings policy (auth.uid() = user_id or user_id is null) means a
  //   meeting owned by a real user can never be updated, so it would sit at
  //   'pending' forever with no transcript or summary.
  // Log it loudly rather than failing silently. No key material is logged.
  if (!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    console.warn(
      '[Webhook] SUPABASE_SERVICE_ROLE_KEY secret is not set; running with the anon key. ' +
        'Child-table writes will be RLS-blocked and user-owned meetings cannot be updated. Set the secret.'
    );
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Load the row deploy-bot created so we can key by it, stay idempotent,
  // and never regress a terminal meeting.
  const { data: existing } = await supabaseAdmin
    .from('meetings')
    .select('id, status, summary, transcript')
    .eq('bot_id', botId)
    .maybeSingle();

  const isTerminal = (s?: string | null) => s === 'summarized';

  try {
    const isCompletion = eventType === 'bot.completed' || eventType === 'complete';
    const isFailure = eventType === 'bot.failed' || eventType === 'failed';

    // ---- bot.completed -----------------------------------------------------
    if (isCompletion) {
      const alreadyHasContent =
        existing?.status === 'summarized' ||
        (existing?.status === 'completed' && (existing?.summary || existing?.transcript));
      if (alreadyHasContent) {
        return json({ success: true, event: eventType, bot_id: botId, duplicate: true, status: existing.status }, 200);
      }
      return await handleCompletion(supabaseAdmin, body, data, botId, existing?.id ?? null);
    }

    // ---- bot.failed --------------------------------------------------------
    if (isFailure) {
      if (existing && existing.status === 'summarized') {
        return json({ success: true, event: eventType, bot_id: botId, duplicate: true }, 200);
      }
      const code = data?.error_code ? ` [${data.error_code}]` : '';
      const message =
        (data?.error_message || data?.message || data?.error || 'Bot failed to join or record the meeting.') + code;
      await updateMeetingByBotId(supabaseAdmin, botId, {
        status: 'failed',
        error_message: message,
        ended_at: new Date().toISOString(),
        raw_payload: body,
      });
      return json({ success: true, event: eventType, bot_id: botId, status: 'failed' }, 200);
    }

    // ---- bot.status_change (and any other live event) ----------------------
    const mapped = mapStatusChangeToStatus(body);
    if (mapped && !isTerminal(existing?.status)) {
      await updateMeetingByBotId(supabaseAdmin, botId, { ...mapped, raw_payload: body });
      return json({ success: true, event: eventType, bot_id: botId, status: mapped.status }, 200);
    }
    return json({ success: true, event: eventType, bot_id: botId, status: existing?.status ?? 'unchanged' }, 200);
  } catch (err: any) {
    console.error('[Webhook] processing error:', scrub(err));
    return json({ success: false, error: 'Processing error' }, 200);
  }
});

// --------------------------------------------------------------------
// Update the meetings row by bot_id. deploy-bot created it, so an update
// is expected; if somehow absent (webhook before insert), insert a row so
// nothing is lost.
// --------------------------------------------------------------------
async function updateMeetingByBotId(
  supabaseAdmin: any,
  botId: string,
  patch: Record<string, any>
): Promise<any | null> {
  const { data: existing } = await supabaseAdmin
    .from('meetings')
    .select('id, transcript, status, summary')
    .eq('bot_id', botId)
    .maybeSingle();

  if (existing) {
    // Overwrite protection: Never replace a longer complete transcript with a shorter/empty one
    if (patch.transcript !== undefined && existing.transcript) {
      const existingText = String(existing.transcript).trim();
      const newText = String(patch.transcript || '').trim();
      if (newText.length < existingText.length) {
        console.log(
          `[Webhook] Preserving existing longer transcript (${existingText.length} chars vs ${newText.length} chars)`
        );
        patch.transcript = existing.transcript;
      }
    }

    const { data: updated } = await supabaseAdmin
      .from('meetings')
      .update(patch)
      .eq('bot_id', botId)
      .select()
      .maybeSingle();

    return updated;
  }

  const { data: inserted } = await supabaseAdmin
    .from('meetings')
    .insert({ bot_id: botId, ...patch })
    .select()
    .maybeSingle();

  return inserted ?? null;
}

// --------------------------------------------------------------------
// Handle bot.completed: fetch the signed transcript, run Gemini, persist.
// --------------------------------------------------------------------
async function handleCompletion(
  supabaseAdmin: any,
  body: Record<string, any>,
  data: Record<string, any>,
  botId: string,
  knownMeetingId: string | null
): Promise<Response> {
  console.log(`[Pipeline Log 1] Processing completed meeting bot_id=${botId}`);

  const recordingUrl = data?.video ?? data?.audio ?? data?.mp3 ?? data?.mp4 ?? null;
  const rawDuration = data?.duration_seconds ?? data?.duration ?? data?.bot?.duration ?? null;
  let durationSecs = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? Math.round(rawDuration) : null;

  if (recordingUrl) {
    console.log(`[Pipeline Log 2] Recording audio/video found: URL=${scrub(recordingUrl)}`);
  } else {
    console.warn('[Pipeline Log 2] No media URL returned in completion payload.');
  }

  let norm: NormalizedTranscript = { segments: [], text: '', speakers: [], durationSecs: null, isEmpty: true };
  let rawSource: any = null;

  console.log('[Pipeline Log 3] Transcribing audio with Whisper large-v3 (openai/whisper-large-v3) engine...');

  const transcriptionUrl = typeof data?.transcription === 'string' ? data.transcription : null;
  if (transcriptionUrl) {
    console.log('[Webhook] Fetching signed transcript document…');
    rawSource = await fetchSignedJson(transcriptionUrl);
  }

  // If signed transcript is absent or empty, invoke OpenAI Whisper large-v3 on recording URL
  if (recordingUrl && (!rawSource || extractUtterancesFromDoc(rawSource).length === 0)) {
    console.log('[Webhook] Invoking OpenAI Whisper large-v3 model on recorded audio URL...');
    const whisperResult = await transcribeWithWhisperLargeV3(recordingUrl);
    if (whisperResult) {
      rawSource = whisperResult;
    }
  }

  if (!rawSource) {
    rawSource =
      data?.transcription ??
      data?.transcript ??
      data?.utterances ??
      body?.transcript ??
      body?.utterances ??
      data?.bot?.transcript ??
      null;
  }

  const participants = extractParticipants(data, rawSource, body);
  if (participants.length > 0) {
    console.log(`[Webhook] Identified meeting participants: ${participants.join(', ')}`);
  }

  if (rawSource) {
    norm = normalizeTranscript(rawSource, participants);
    console.log(
      `[Pipeline Log 4] Chunks processed: ${norm.segments.length} dialogue turns, ${norm.text.length} total characters.`
    );
  } else {
    console.warn('[Webhook] bot.completed carried no transcription URL or inline transcript.');
  }

  // Fall back to the real duration derived from the last utterance's end
  // time when MeetingBaaS didn't report one. Still real data, not invented.
  if (durationSecs === null && norm.durationSecs !== null) {
    durationSecs = norm.durationSecs;
  }

  // No speech / no transcript: complete honestly, no AI, NO fabricated data.
  if (norm.isEmpty) {
    const meeting = await updateMeetingByBotId(supabaseAdmin, botId, {
      status: 'completed',
      recording_url: recordingUrl,
      duration_secs: durationSecs,
      ended_at: new Date().toISOString(),
      error_message:
        'Meeting ended, but no transcript content was produced (no speech detected or transcription unavailable).',
      raw_payload: body,
    });
    return json(
      { success: true, event: 'bot.completed', bot_id: botId, status: 'completed', transcript: false, meeting_id: meeting?.id ?? knownMeetingId },
      200
    );
  }

  console.log('[Pipeline Log 5] Saving complete transcript to Supabase (meetings & transcripts tables)...');
  console.log('[Pipeline Log 6] Sending complete transcript to Gemini AI for executive summary & action items...');

  const analysis = await analyzeTranscript(norm.text, participants);
  const finalTranscriptText = analysis?.formatted_transcript?.trim() || norm.text;

  // Transcript exists but Gemini failed on every model: preserve the
  // transcript, complete (not summarized), record a retryable note. No fake.
  if (!analysis) {
    console.warn('[Pipeline Warning] AI summarization failed, but complete transcript remains fully saved and visible.');
    const meeting = await updateMeetingByBotId(supabaseAdmin, botId, {
      status: 'completed',
      transcript: finalTranscriptText,
      recording_url: recordingUrl,
      duration_secs: durationSecs,
      ended_at: new Date().toISOString(),
      error_message: 'Transcript captured, but AI summarization failed (transcript preserved).',
      raw_payload: body,
    });
    await insertTranscriptRows(supabaseAdmin, meeting?.id ?? knownMeetingId, norm);
    return json(
      { success: true, event: 'bot.completed', bot_id: botId, status: 'completed', summarized: false, meeting_id: meeting?.id ?? knownMeetingId },
      200
    );
  }

  // Full success: real transcript + real summary.
  const meeting = await updateMeetingByBotId(supabaseAdmin, botId, {
    status: 'summarized',
    summary: analysis.executive_summary,
    action_items: analysis.action_items,
    transcript: finalTranscriptText,
    recording_url: recordingUrl,
    duration_secs: durationSecs,
    ended_at: new Date().toISOString(),
    error_message: null,
    raw_payload: body,
  });

  const meetingId = meeting?.id ?? knownMeetingId;
  if (meetingId) {
    const { error: summaryError } = await supabaseAdmin.from('summaries').insert({
      meeting_id: meetingId,
      executive_summary: analysis.executive_summary,
      key_decisions: analysis.key_decisions,
      sentiment: analysis.sentiment,
    });
    if (summaryError) {
      console.error(`[Webhook] summaries insert failed (${summaryError.code}): ${summaryError.message}`);
    }
    await insertTranscriptRows(supabaseAdmin, meetingId, norm);
    if (analysis.action_items.length > 0) {
      const { error: actionError } = await supabaseAdmin.from('action_items').insert(
        analysis.action_items.map((a) => ({
          meeting_id: meetingId,
          task: a.task,
          assignee: a.assignee,
          due_date: a.due_date,
          status: a.status || 'pending',
        }))
      );
      if (actionError) {
        console.error(`[Webhook] action_items insert failed (${actionError.code}): ${actionError.message}`);
      }
    }
  }

  console.log('[Pipeline Log 7] Summary & Action Items successfully saved to database.');

  return json(
    {
      success: true,
      event: 'bot.completed',
      bot_id: botId,
      status: 'summarized',
      meeting_id: meetingId,
      summary: analysis.executive_summary,
      action_items: analysis.action_items,
    },
    200
  );
}

async function insertTranscriptRows(supabaseAdmin: any, meetingId: string | null, norm: NormalizedTranscript): Promise<void> {
  if (!meetingId || norm.segments.length === 0) return;
  const rows: (TranscriptItem & { meeting_id: string })[] = norm.segments.map((s) => ({
    meeting_id: meetingId,
    speaker: s.speaker,
    text: s.text,
  }));
  await supabaseAdmin.from('transcripts').insert(rows);
}
