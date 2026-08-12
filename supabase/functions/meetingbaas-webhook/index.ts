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
// Transcript normalization (v2 OutputTranscription.result.utterances)
//
//   [{ text, speaker, start, end, words:[{word,start,end}] }]
// `speaker` is typically a diarization INDEX (0,1,2…), not a name — we
// render those as "Speaker N". Stays defensive about older shapes too.
// --------------------------------------------------------------------
function segmentText(seg: any): string {
  if (typeof seg?.text === 'string' && seg.text.trim()) return seg.text.trim();
  if (typeof seg?.transcript === 'string' && seg.transcript.trim()) return seg.transcript.trim();
  if (Array.isArray(seg?.words)) {
    return seg.words
      .map((w: any) => (typeof w === 'string' ? w : w?.word ?? w?.text ?? ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

function segmentSpeaker(seg: any): string {
  const raw = seg?.speaker ?? seg?.speaker_name;
  if (raw === null || raw === undefined || raw === '') return 'Unknown speaker';
  if (typeof raw === 'number' || /^\d+$/.test(String(raw))) return `Speaker ${raw}`;
  return String(raw);
}

function segmentStart(seg: any): number | null {
  const candidates = [seg?.start, seg?.start_time, seg?.offset];
  const n = candidates.find((v: any) => typeof v === 'number' && Number.isFinite(v));
  return typeof n === 'number' ? n : null;
}

function segmentEnd(seg: any): number | null {
  if (typeof seg?.end === 'number') return seg.end;
  if (typeof seg?.end_time === 'number') return seg.end_time;
  if (Array.isArray(seg?.words) && seg.words.length) {
    const last = seg.words[seg.words.length - 1];
    if (typeof last?.end === 'number') return last.end;
  }
  return null;
}

function normalizeTranscript(rawTranscript: any): NormalizedTranscript {
  const input = Array.isArray(rawTranscript) ? rawTranscript : [];

  const segments = input
    .map((seg: any) => ({
      speaker: segmentSpeaker(seg),
      start: segmentStart(seg),
      end: segmentEnd(seg),
      text: segmentText(seg),
    }))
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
  const code = String(
    body?.data?.status?.code || body?.status?.code || body?.data?.status || body?.status || ''
  )
    .toLowerCase()
    .trim();
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

async function analyzeTranscript(transcriptText: string): Promise<AIAnalysis | null> {
  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
  if (!GEMINI_API_KEY) {
    console.warn('[Webhook] GEMINI_API_KEY is not set — skipping AI summary.');
    return null;
  }

  // Lead with GEMINI_MODEL (set this to a stable alias like
  // 'gemini-flash-latest'); dated models such as gemini-2.5-flash now 404
  // for new API keys. Keep a couple of fallbacks, de-duplicated.
  const configured = Deno.env.get('GEMINI_MODEL')?.trim();
  const geminiModels = [...new Set([configured, 'gemini-flash-latest', 'gemini-2.0-flash', 'gemini-1.5-flash'].filter(
    Boolean
  ))] as string[];

  const systemPrompt = `You are an expert executive assistant. Analyze this meeting transcript and output a strict JSON object with this structure:
{
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
Only use information present in the transcript. Never invent an assignee or due_date — use null when the transcript does not state one.

Meeting Transcript:
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

  return null; // every model failed — caller preserves the transcript, no fake data
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
  const { data: updated } = await supabaseAdmin
    .from('meetings')
    .update(patch)
    .eq('bot_id', botId)
    .select()
    .maybeSingle();

  if (updated) return updated;

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
  const recordingUrl = data?.video ?? data?.audio ?? null;
  const rawDuration = data?.duration_seconds ?? data?.duration ?? data?.bot?.duration ?? null;
  let durationSecs = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? Math.round(rawDuration) : null;

  // The ONLY transcript source: the signed `transcription` document URL.
  let norm: NormalizedTranscript = { segments: [], text: '', speakers: [], durationSecs: null, isEmpty: true };
  const transcriptionUrl = typeof data?.transcription === 'string' ? data.transcription : null;
  if (transcriptionUrl) {
    console.log('[Webhook] fetching signed transcript document…');
    const doc = await fetchSignedJson(transcriptionUrl);
    const utterances = doc?.result?.utterances ?? doc?.utterances ?? [];
    norm = normalizeTranscript(Array.isArray(utterances) ? utterances : []);
  } else {
    console.warn('[Webhook] bot.completed carried no transcription URL.');
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

  const analysis = await analyzeTranscript(norm.text);

  // Transcript exists but Gemini failed on every model: preserve the
  // transcript, complete (not summarized), record a retryable note. No fake.
  if (!analysis) {
    const meeting = await updateMeetingByBotId(supabaseAdmin, botId, {
      status: 'completed',
      transcript: norm.text,
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
    transcript: norm.text,
    recording_url: recordingUrl,
    duration_secs: durationSecs,
    ended_at: new Date().toISOString(),
    error_message: null,
    raw_payload: body,
  });

  const meetingId = meeting?.id ?? knownMeetingId;
  if (meetingId) {
    // Child tables are a denormalized mirror; the dashboard reads the meetings
    // row itself, so a failure here must not fail the webhook. But it must not
    // be silent either — an RLS rejection (42501) here is the signal that the
    // service-role secret is missing.
    // summaries (futurrizon shape: executive_summary / key_decisions / sentiment)
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
