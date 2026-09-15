// ====================================================================
// REVORA — Edge Function: meetingbaas-webhook
//
// Public webhook receiver for MeetingBaaS v2 bot events (deploy with
// --no-verify-jwt; MeetingBaaS cannot present a Supabase JWT).
//
//   bot.status_change -> map data.status.code onto our meeting status
//                        (including the platform's own end reasons -
//                        all_participants_left / no_speaker / no_attendees /
//                        call_ended - which is how a bot departure reaches us)
//   bot.failed        -> mark the meeting failed with the real error
//   bot.completed     -> assemble the transcript from MeetingBaaS artifacts,
//                        audit speaker attribution with Gemini, summarise, and
//                        persist meetings + transcripts + summaries + action_items.
//
// TRANSCRIPT ASSEMBLY (see assembleTranscript below)
//   MeetingBaaS gives us two independent speaker signals for the same audio:
//     * `transcription`  -> utterances, each with per-WORD timestamps and a
//                           speaker name, but the speaker flips mid-sentence
//                           whenever people overlap.
//     * `diarization`    -> a coarser, cleaner speaker timeline (JSONL).
//   We flatten every word, resolve each word's speaker from the diarization
//   timeline (falling back to the utterance speaker), cut the stream into
//   sentences on real punctuation, and award each sentence to whoever spoke
//   most of it. Every word, timestamp and name comes from MeetingBaaS —
//   nothing is generated. Gemini is then allowed to correct WHO said a line,
//   never WHAT was said, and only using the known participant roster.
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

// Redact query strings so signed artifact URLs never leak their tokens to logs.
function scrub(v: unknown): string {
  const s = v instanceof Error ? v.message || v.name : String(v ?? '');
  return s.replace(/(https?:\/\/[^\s)'"]+)/g, (u) => {
    const q = u.indexOf('?');
    return q === -1 ? u : `${u.slice(0, q)}?<redacted>`;
  });
}

// --------------------------------------------------------------------
// Types
// --------------------------------------------------------------------

/** One diarization interval straight from the MeetingBaaS JSONL artifact. */
interface DiarSpan {
  speakerName?: string;
  speakerId?: string;
  start: number;
  end: number;
}

/** A single word from a MeetingBaaS utterance, re-keyed to a canonical speaker. */
interface WordUnit {
  token: string;
  start: number;
  end: number;
  confidence: number;
  speaker: string | null;
  utteranceIndex: number;
}

/** A transcript turn: real MeetingBaaS words, one resolved speaker. */
interface TranscriptTurn {
  speaker: string;
  text: string;
  start_time: number;
  end_time: number;
  /** true when more than one speaker's words fell inside this unit (overlap). */
  contested?: boolean;
  /** mean STT confidence across the words in this unit. */
  confidence?: number;
}

/** Participants resolved from MeetingBaaS metadata — the only allowed speakers. */
interface ParticipantRegistry {
  /** Canonical display names, e.g. ["Erva Savaliya", "Vaishali Savaliya"]. */
  names: string[];
  /** Every alias we accept (normalised) -> canonical name. */
  lookup: Map<string, string>;
  /** Numeric/string speaker ids seen in metadata. */
  ids: string[];
  /** speaker id -> canonical name, for logging the mapping. */
  map: Record<string, string>;
}

interface ActionItem {
  task: string;
  assignee: string | null;
  /** Natural-language day exactly as spoken, e.g. "Wednesday". */
  due_day: string | null;
  /** Resolved calendar date, or null when it genuinely cannot be computed. */
  due_date: string | null;
  status: string;
}

interface AIAnalysis {
  executive_summary: string;
  key_topics: string[];
  key_decisions: string[];
  sentiment: string;
  action_items: ActionItem[];
}

// --------------------------------------------------------------------
// STEP 2 — participant roster from MeetingBaaS metadata (never hardcoded)
// --------------------------------------------------------------------

/** Title-case only the words the provider gave us in all-lowercase. */
function toTitleCase(name: string): string {
  return String(name)
    .split(/(\s+)/)
    .map((part) => {
      if (!/[a-z]/.test(part)) return part;
      if (part === part.toLowerCase()) return part.charAt(0).toUpperCase() + part.slice(1);
      return part;
    })
    .join('');
}

/** Alias key: lowercase, punctuation collapsed to single spaces. */
function normKey(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Build the allowed-speaker roster from `participants` + `speakers` in the bot
 * payload. Our own bot is excluded by comparing against `bot_name` / `is_bot`
 * so no brand string is hardcoded and future meetings work unchanged.
 */
function buildParticipantRegistry(data: Record<string, any>): ParticipantRegistry {
  const reg: ParticipantRegistry = { names: [], lookup: new Map(), ids: [], map: {} };
  const botKey = normKey(data?.bot_name);

  const consider = (entry: unknown) => {
    if (entry == null) return;
    const p: Record<string, any> = typeof entry === 'string' ? { name: entry } : (entry as Record<string, any>);
    const rawName: string | undefined = p.name ?? p.speaker ?? p.display_name ?? p.user_name ?? undefined;
    const rawId = p.id ?? p.user_id ?? p.speaker_id ?? p.participant_id;
    if (!rawName || !String(rawName).trim()) return;

    // Never let the assistant bot become a transcript speaker.
    if (p.is_bot === true) return;
    if (botKey && normKey(rawName) === botKey) return;

    const canonical = toTitleCase(String(rawName).trim());
    if (!reg.names.includes(canonical)) reg.names.push(canonical);

    for (const alias of [rawName, canonical, p.display_name, p.user_name]) {
      const k = normKey(alias);
      if (k) reg.lookup.set(k, canonical);
    }
    if (rawId !== undefined && rawId !== null && String(rawId).trim()) {
      const idKey = normKey(String(rawId));
      reg.lookup.set(idKey, canonical);
      reg.lookup.set(`speaker ${idKey}`, canonical);
      if (!reg.ids.includes(String(rawId))) reg.ids.push(String(rawId));
      reg.map[String(rawId)] = canonical;
    }
  };

  for (const p of Array.isArray(data?.participants) ? data.participants : []) consider(p);
  for (const s of Array.isArray(data?.speakers) ? data.speakers : []) consider(s);
  return reg;
}

/** Resolve any raw speaker label to a roster name, or null when unknown. */
function canonicalSpeaker(reg: ParticipantRegistry, raw: unknown): string | null {
  const k = normKey(raw);
  if (!k || k === 'unknown' || k === 'speaker') return null;
  return reg.lookup.get(k) ?? null;
}

// --------------------------------------------------------------------
// MeetingBaaS artifact fetching
// --------------------------------------------------------------------

/** Fetch a signed artifact URL. Returns null instead of throwing. */
async function fetchSignedText(url: string, label: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[Webhook] ${label} artifact fetch failed: HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.error(`[Webhook] ${label} artifact fetch error: ${scrub(err)}`);
    return null;
  }
}

/**
 * Parse the diarization JSONL artifact into a sorted timeline.
 * Lines look like {"speaker":"Piyu Savaliya","start_time":0,"end_time":4.03,"user_id":4}
 * so `speaker` may hold a NAME while `user_id` holds the cluster id — classify
 * by shape rather than by key name.
 */
function parseDiarizationTimeline(text: string | null): DiarSpan[] {
  if (!text) return [];
  const spans: DiarSpan[] = [];

  const ingest = (item: Record<string, any>) => {
    const rawSpeaker = item.speaker;
    const rawIsName = typeof rawSpeaker === 'string' && !/^\d+$/.test(rawSpeaker.trim());
    const speakerName = item.speaker_name ?? item.name ?? item.user_name ?? (rawIsName ? rawSpeaker : undefined);
    const speakerId = item.speaker_id ?? item.user_id ?? item.id ?? (rawIsName ? undefined : rawSpeaker);
    const start = Number(item.start_time ?? item.start ?? item.from ?? NaN);
    const end = Number(item.end_time ?? item.end ?? item.to ?? NaN);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    spans.push({
      speakerName: speakerName === undefined ? undefined : String(speakerName),
      speakerId: speakerId === undefined || speakerId === null ? undefined : String(speakerId),
      start,
      end,
    });
  };

  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const doc = JSON.parse(trimmed);
      const arr = Array.isArray(doc) ? doc : (doc.segments ?? doc.diarization ?? doc.result?.segments ?? []);
      if (Array.isArray(arr)) for (const item of arr) if (item && typeof item === 'object') ingest(item);
    } catch {
      /* fall through to JSONL */
    }
  }
  if (spans.length === 0) {
    for (const line of trimmed.split('\n')) {
      const l = line.trim();
      if (!l) continue;
      try {
        const item = JSON.parse(l);
        if (item && typeof item === 'object') ingest(item);
      } catch {
        /* skip malformed line */
      }
    }
  }

  spans.sort((a, b) => a.start - b.start);
  return spans;
}

/** Which roster member was speaking at time `t`? Containment first, then <=1s nearest. */
function diarizationSpeakerAt(timeline: DiarSpan[], t: number, reg: ParticipantRegistry): string | null {
  for (const s of timeline) {
    if (t >= s.start && t <= s.end) {
      return canonicalSpeaker(reg, s.speakerName) ?? canonicalSpeaker(reg, s.speakerId);
    }
  }
  let best: DiarSpan | null = null;
  let bestGap = Infinity;
  for (const s of timeline) {
    const gap = t < s.start ? s.start - t : t - s.end;
    if (gap >= 0 && gap < bestGap) {
      bestGap = gap;
      best = s;
    }
  }
  if (!best || bestGap > 1.0) return null;
  return canonicalSpeaker(reg, best.speakerName) ?? canonicalSpeaker(reg, best.speakerId);
}

/** Pull the utterance array out of whichever envelope the provider used. */
function extractUtterances(doc: unknown): Record<string, any>[] {
  if (!doc) return [];
  if (Array.isArray(doc)) return doc as Record<string, any>[];
  const d = doc as Record<string, any>;
  const candidates = [
    d.result?.utterances,
    d.utterances,
    d.result?.segments,
    d.segments,
    d.transcription?.utterances,
    d.transcript?.utterances,
  ];
  for (const c of candidates) if (Array.isArray(c) && c.length > 0) return c as Record<string, any>[];
  return [];
}

// --------------------------------------------------------------------
// STEP 3 — deterministic word-level transcript assembly
// --------------------------------------------------------------------

const TERMINAL_PUNCT = /[.!?]["')\]]?$/;

/**
 * Flatten every utterance into one global, time-ordered word stream and resolve
 * each word's speaker from the diarization timeline (the cleaner signal),
 * falling back to the utterance's own speaker label. No word is dropped.
 */
function flattenWords(
  utterances: Record<string, any>[],
  timeline: DiarSpan[],
  reg: ParticipantRegistry,
  stats: Record<string, number>,
): WordUnit[] {
  const words: WordUnit[] = [];
  stats.utterancesWithoutWordTimings = 0;
  stats.diarizationOverrodeUtteranceSpeaker = 0;
  stats.wordsWithNoResolvableSpeaker = 0;

  utterances.forEach((u, ui) => {
    const utteranceSpeaker = canonicalSpeaker(reg, u.speaker ?? u.speaker_name ?? u.speaker_id);
    const list = Array.isArray(u.words) ? u.words : [];

    if (list.length === 0) {
      // No per-word timings: keep the utterance intact as a single pseudo-word.
      stats.utterancesWithoutWordTimings++;
      const text = String(u.text ?? u.transcript ?? '').trim();
      if (!text) return;
      const start = Number(u.start ?? u.start_time ?? 0);
      const end = Number(u.end ?? u.end_time ?? start);
      const mid = (start + end) / 2;
      const diar = diarizationSpeakerAt(timeline, mid, reg);
      const speaker = diar ?? utteranceSpeaker;
      if (!speaker) stats.wordsWithNoResolvableSpeaker++;
      words.push({ token: ` ${text}`, start, end, confidence: Number(u.confidence ?? 0), speaker, utteranceIndex: ui });
      return;
    }

    for (const w of list) {
      const token = String(w.word ?? w.text ?? '');
      if (!token.trim()) continue;
      const start = Number(w.start ?? w.start_time ?? u.start ?? 0);
      const end = Number(w.end ?? w.end_time ?? start);
      const mid = (start + end) / 2;
      const diar = diarizationSpeakerAt(timeline, mid, reg);
      const speaker = diar ?? utteranceSpeaker;
      if (diar && utteranceSpeaker && diar !== utteranceSpeaker) stats.diarizationOverrodeUtteranceSpeaker++;
      if (!speaker) stats.wordsWithNoResolvableSpeaker++;
      words.push({
        token: token.startsWith(' ') ? token : ` ${token}`,
        start,
        end,
        confidence: Number(w.confidence ?? u.confidence ?? 0),
        speaker,
        utteranceIndex: ui,
      });
    }
  });

  words.sort((a, b) => a.start - b.start || a.end - b.end);
  stats.totalWords = words.length;
  return words;
}

/**
 * Cut the word stream into sentences on real punctuation (plus safety valves for
 * runaway length and long silences) and award each sentence to whoever spoke the
 * most of it by duration. This is what stops one sentence being split across two
 * speakers, and stops "Yes," / "sure." landing on separate lines.
 */
function buildSentences(words: WordUnit[], stats: Record<string, number>): TranscriptTurn[] {
  const MAX_WORDS = 45;
  const TURN_GAP = 1.2;
  const HARD_GAP = 4.0;

  const units: TranscriptTurn[] = [];
  let cur: WordUnit[] = [];
  let contested = 0;

  const flush = () => {
    if (cur.length === 0) return;
    const durations = new Map<string, number>();
    let firstSpeaker: string | null = null;
    for (const w of cur) {
      if (!w.speaker) continue;
      if (firstSpeaker === null) firstSpeaker = w.speaker;
      const d = Math.max(w.end - w.start, 0.01);
      durations.set(w.speaker, (durations.get(w.speaker) ?? 0) + d);
    }
    let speaker = firstSpeaker;
    let bestDur = -1;
    for (const [name, d] of durations) {
      if (d > bestDur) {
        bestDur = d;
        speaker = name;
      }
    }
    if (durations.size > 1) contested++;
    const text = cur.map((w) => w.token).join('').replace(/\s+/g, ' ').trim();
    const confs = cur.map((w) => w.confidence).filter((c) => Number.isFinite(c) && c > 0);
    if (text) {
      units.push({
        speaker: speaker ?? 'Unidentified Speaker',
        text,
        start_time: cur[0].start,
        end_time: cur[cur.length - 1].end,
        contested: durations.size > 1,
        confidence: confs.length ? Number((confs.reduce((a, b) => a + b, 0) / confs.length).toFixed(3)) : 0,
      });
    }
    cur = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    cur.push(w);
    const next = words[i + 1];
    const gap = next ? next.start - w.end : Infinity;
    const endsSentence = TERMINAL_PUNCT.test(w.token.trim());
    const tooLong = cur.length >= MAX_WORDS;
    const longSilence = gap >= HARD_GAP;
    const speakerTurn = next ? gap >= TURN_GAP && next.speaker !== w.speaker : false;
    if (endsSentence || tooLong || longSilence || speakerTurn || !next) flush();
  }
  flush();

  stats.sentenceCount = units.length;
  stats.contestedSentences = contested;
  return units;
}

/** Merge consecutive sentences by the same speaker into one readable turn. */
function mergeTurns(units: TranscriptTurn[], stats: Record<string, number>, maxGap = 20): TranscriptTurn[] {
  const out: TranscriptTurn[] = [];
  for (const u of units) {
    const prev = out[out.length - 1];
    if (prev && prev.speaker === u.speaker && u.start_time - prev.end_time <= maxGap) {
      prev.text += /^[,.!?;:']/.test(u.text) ? u.text : ` ${u.text}`;
      prev.end_time = u.end_time;
      prev.contested = prev.contested || u.contested;
      continue;
    }
    out.push({ ...u });
  }
  stats.turnsAfterMerge = out.length;
  return out;
}

/**
 * Apply Gemini's speaker-only corrections. Text is never touched. Any correction
 * pointing at an out-of-range index or a speaker outside the MeetingBaaS roster
 * rejects the ENTIRE batch — we would rather keep the deterministic attribution
 * than let the model invent a speaker.
 */
function applySpeakerCorrections(
  units: TranscriptTurn[],
  corrections: unknown,
  roster: string[],
  stats: Record<string, number>,
): { units: TranscriptTurn[]; rejected: string | null } {
  if (!Array.isArray(corrections) || corrections.length === 0) {
    stats.geminiCorrectionsApplied = 0;
    return { units, rejected: null };
  }
  for (const c of corrections as Record<string, any>[]) {
    const idx = Number(c?.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= units.length) {
      return { units, rejected: `correction index out of range: ${JSON.stringify(c?.index)}` };
    }
    if (typeof c?.speaker !== 'string' || !roster.includes(c.speaker)) {
      return { units, rejected: 'speaker outside the MeetingBaaS participant roster' };
    }
  }
  let applied = 0;
  const next = units.map((u) => ({ ...u }));
  for (const c of corrections as Record<string, any>[]) {
    const idx = Number(c.index);
    if (next[idx].speaker !== c.speaker) {
      next[idx].speaker = c.speaker;
      applied++;
    }
  }
  stats.geminiCorrectionsApplied = applied;
  return { units: next, rejected: null };
}

/** Render turns as the "Speaker: text" transcript the UI already displays. */
function turnsToText(units: TranscriptTurn[]): string {
  return units.map((u) => `${u.speaker}: ${u.text}`).join('\n');
}

/** Words present in the raw source vs the final transcript — proves nothing was lost. */
function countWords(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

// --------------------------------------------------------------------
// Gemini transport (shared by the re-attribution and analysis passes)
// --------------------------------------------------------------------

// Models verified as dead against this key — never waste an attempt on them.
const KNOWN_DEAD_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro']);
const WORKING_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3-flash-preview'];

function geminiModelChain(): string[] {
  const configured = Deno.env.get('GEMINI_MODEL')?.trim();
  const chain = [configured && !KNOWN_DEAD_MODELS.has(configured) ? configured : null, ...WORKING_MODELS].filter(Boolean) as string[];
  return [...new Set(chain)];
}

function cleanJsonResponse(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

/**
 * POST a prompt to Gemini, walking the model chain and retrying transient
 * failures (429/500/503). Returns the raw text, or null when every model failed.
 */
async function callGemini(prompt: string, label: string, temperature = 0.1): Promise<string | null> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    console.error(`[Webhook] GEMINI_API_KEY not configured — skipping ${label}.`);
    return null;
  }

  for (const model of geminiModelChain()) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature, maxOutputTokens: 8192, responseMimeType: 'application/json' },
            }),
          },
        );

        if (!res.ok) {
          const body = scrub(await res.text()).slice(0, 200);
          console.error(`[Gemini] ${label} model=${model} attempt=${attempt} HTTP ${res.status}: ${body}`);
          if (res.status === 429 || res.status === 500 || res.status === 503) continue; // transient -> retry
          break; // permanent for this model -> next model
        }

        const payload = await res.json();
        const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          console.error(
            `[Gemini] ${label} model=${model} returned no text (finishReason=${payload?.candidates?.[0]?.finishReason ?? 'n/a'}, blockReason=${payload?.promptFeedback?.blockReason ?? 'n/a'})`,
          );
          continue;
        }
        console.log(`[Gemini] ${label} response received from ${model}.`);
        return text;
      } catch (err) {
        console.error(`[Gemini] ${label} model=${model} attempt=${attempt} error: ${scrub(err)}`);
      }
    }
  }
  console.error(`[Gemini] ${label}: all models failed.`);
  return null;
}

// --------------------------------------------------------------------
// STEP 2/4 — constrained Gemini speaker re-attribution (WHO, never WHAT)
// --------------------------------------------------------------------

function buildReattributionPrompt(units: TranscriptTurn[], roster: string[]): string {
  const lines = units
    .map((u, i) => {
      const flags = [
        `t=${u.start_time.toFixed(1)}s`,
        `stt_confidence=${(u.confidence ?? 0).toFixed(2)}`,
        u.contested ? 'overlapping_speech=true' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `[${i}] speaker="${u.speaker}" ${flags}\n${u.text}`;
    })
    .join('\n\n');

  return `You are auditing speaker attribution in a real meeting transcript produced by an automatic speech-to-text system.

The ONLY people in this meeting are:
${roster.map((n) => `- ${n}`).join('\n')}

RULES — these are absolute:
- You may ONLY use speaker names from the list above. Do not invent, rename, abbreviate or guess any other speaker.
- You must NOT change, rewrite, add, remove, reorder or re-punctuate any transcript text. You are only allowed to change WHO said a line.
- Do NOT merge lines, split lines, or renumber indexes.
- Only propose a correction when the conversation logic makes the current attribution clearly wrong (for example: a person answering their own question, or a person reporting on a task that another person owns). Lines marked overlapping_speech=true or with low stt_confidence are the likeliest errors.
- If the current attribution is plausible, leave it alone. Returning an empty list is a valid and expected answer.

TRANSCRIPT:
${lines}

Return ONLY this JSON:
{"corrections":[{"index":0,"speaker":"Exact Name From The List","reason":"short reason"}]}`;
}

/** Ask Gemini to audit attribution; returns the (possibly unchanged) turns. */
async function auditSpeakerAttribution(
  units: TranscriptTurn[],
  roster: string[],
  stats: Record<string, number>,
): Promise<TranscriptTurn[]> {
  if (units.length === 0 || roster.length < 2) return units;

  console.log('[Transcript Pipeline] Gemini speaker re-attribution request started.');
  const raw = await callGemini(buildReattributionPrompt(units, roster), 'speaker re-attribution', 0.1);
  if (!raw) {
    console.warn('[Transcript Pipeline] speaker re-attribution unavailable — keeping deterministic attribution.');
    return units;
  }

  let proposed: unknown;
  try {
    proposed = JSON.parse(cleanJsonResponse(raw))?.corrections;
  } catch (err) {
    console.error(`[Transcript Pipeline] could not parse re-attribution JSON: ${scrub(err)}`);
    return units;
  }

  const { units: next, rejected } = applySpeakerCorrections(units, proposed, roster, stats);
  if (rejected) {
    console.error(`[Transcript Pipeline] Gemini corrections REJECTED (${rejected}) — keeping deterministic attribution.`);
    return units;
  }
  console.log(`[Transcript Pipeline] Gemini speaker corrections applied: ${stats.geminiCorrectionsApplied ?? 0}.`);
  return next;
}

// --------------------------------------------------------------------
// STEP 6 — natural-language deadline resolution
// --------------------------------------------------------------------

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function weekdayName(isoDate: string): string | null {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : DAY_NAMES[d.getUTCDay()];
}

/**
 * Resolve a spoken day ("Wednesday", "tomorrow", "Fri") to the next occurrence
 * on or after the meeting date. Returns null when it is not a day we recognise —
 * in that case the natural-language text is preserved instead of inventing one.
 */
function resolveWeekdayToDate(dayText: unknown, meetingISO: string): string | null {
  const t = String(dayText ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!t) return null;
  const base = new Date(`${meetingISO}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (t === 'today') return iso(base);
  if (t === 'tomorrow') {
    base.setUTCDate(base.getUTCDate() + 1);
    return iso(base);
  }

  let target = DAY_NAMES.findIndex((d) => d.toLowerCase() === t);
  if (target === -1 && t.length === 3) target = DAY_NAMES.findIndex((d) => d.toLowerCase().startsWith(t));
  if (target === -1) return null;

  // "Wednesday" said on a Wednesday means next Wednesday, not today.
  let delta = (target - base.getUTCDay() + 7) % 7;
  if (delta === 0) delta = 7;
  base.setUTCDate(base.getUTCDate() + delta);
  return iso(base);
}

/** Only real ISO dates reach the `date` column. */
function sanitizeDueDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * Reconcile what Gemini returned with what the calendar actually says. Gemini's
 * ISO date is only trusted when it matches the day it also reported; otherwise we
 * recompute from the meeting date ourselves.
 */
function reconcileDueDate(item: Record<string, any>, meetingISO: string): { due_day: string | null; due_date: string | null } {
  const dueDay = typeof item.due_day === 'string' && item.due_day.trim() ? item.due_day.trim() : null;
  const geminiDate = sanitizeDueDate(item.due_date);
  const computed = dueDay ? resolveWeekdayToDate(dueDay, meetingISO) : null;

  if (geminiDate && dueDay) {
    const named = weekdayName(geminiDate);
    if (named && named.toLowerCase() === dueDay.toLowerCase()) return { due_day: dueDay, due_date: geminiDate };
    return { due_day: dueDay, due_date: computed ?? geminiDate };
  }
  if (computed) return { due_day: dueDay, due_date: computed };
  return { due_day: dueDay, due_date: geminiDate };
}

// --------------------------------------------------------------------
// STEP 7/8 — summary + action items from the FINAL COMPLETE transcript
// --------------------------------------------------------------------

function buildAnalysisPrompt(transcriptText: string, roster: string[], meetingISO: string): string {
  const dow = weekdayName(meetingISO) ?? 'unknown weekday';
  return `You are analysing the complete, final transcript of a real meeting.

MEETING DATE: ${meetingISO} (${dow})
PARTICIPANTS (the only valid assignees):
${roster.map((n) => `- ${n}`).join('\n')}

ACTION ITEM RULES:
- Create an action item ONLY when someone actually commits to work, or work is assigned to someone and they accept it.
- Do NOT create an action item for something merely discussed, suggested, or wondered about. "Someone should probably fix the transcription." is NOT an action item unless a named person accepts it.
- Do NOT create duplicate action items when the same commitment is mentioned more than once. One commitment = one action item.
- assignee must be an exact name from the participant list, or null if genuinely unassigned. Never invent a name.
- status: "completed" if the work is already finished, "in_progress" if actively underway, otherwise "pending".

DEADLINE RULES:
- Use the MEETING DATE above as "today" when interpreting spoken deadlines.
- due_day: the deadline exactly as spoken, e.g. "Wednesday", "tomorrow", "end of the month". null if no deadline was mentioned.
- due_date: the resolved calendar date in YYYY-MM-DD. A named weekday means the NEXT occurrence on or after the meeting date.
- If a clear day such as Wednesday, Thursday or Friday was mentioned, you MUST fill due_date. Only use null for due_date when the deadline is genuinely vague (e.g. "soon", "next quarter") — and in that case still keep the spoken words in due_day.

TRANSCRIPT:
${transcriptText}

Return ONLY this JSON:
{"executive_summary":"2-4 sentences on what the meeting was about and what was decided","key_topics":["topic"],"key_decisions":["decision"],"sentiment":"positive|neutral|negative","action_items":[{"task":"what needs doing","assignee":"Exact Name or null","due_day":"Wednesday or null","due_date":"YYYY-MM-DD or null","status":"pending"}]}`;
}

/** Returns null when Gemini is unavailable — the transcript is preserved regardless. */
async function analyzeTranscript(transcriptText: string, roster: string[], meetingISO: string): Promise<AIAnalysis | null> {
  if (!transcriptText.trim()) return null;

  console.log('[Transcript Pipeline] Gemini summarisation request started.');
  const raw = await callGemini(buildAnalysisPrompt(transcriptText, roster, meetingISO), 'summarisation', 0.2);
  if (!raw) return null;

  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(cleanJsonResponse(raw));
  } catch (err) {
    console.error(`[Transcript Pipeline] could not parse summarisation JSON: ${scrub(err)}`);
    return null;
  }

  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : String(x?.title ?? x?.topic ?? ''))).filter(Boolean) : [];

  const seen = new Set<string>();
  const actionItems: ActionItem[] = (Array.isArray(parsed.action_items) ? parsed.action_items : [])
    .map((raw: Record<string, any>) => {
      const task = String(raw?.task ?? raw?.title ?? '').trim();
      if (!task) return null;
      // Assignees are constrained to the real roster — never invented.
      const assignee = typeof raw?.assignee === 'string' && roster.includes(raw.assignee.trim()) ? raw.assignee.trim() : null;
      const { due_day, due_date } = reconcileDueDate(raw ?? {}, meetingISO);
      const status = ['pending', 'in_progress', 'completed'].includes(String(raw?.status)) ? String(raw.status) : 'pending';
      return { task, assignee, due_day, due_date, status } as ActionItem;
    })
    .filter((x): x is ActionItem => x !== null)
    .filter((x) => {
      const k = normKey(`${x.task}|${x.assignee ?? ''}`);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  return {
    executive_summary: String(parsed.executive_summary ?? parsed.summary ?? '').trim(),
    key_topics: asStrings(parsed.key_topics),
    key_decisions: asStrings(parsed.key_decisions ?? parsed.decisions),
    sentiment: ['positive', 'neutral', 'negative'].includes(String(parsed.sentiment)) ? String(parsed.sentiment) : 'neutral',
    action_items: actionItems,
  };
}

// --------------------------------------------------------------------
// Orchestration: raw MeetingBaaS artifacts -> final transcript turns
// --------------------------------------------------------------------

interface AssemblyResult {
  turns: TranscriptTurn[];
  text: string;
  registry: ParticipantRegistry;
  stats: Record<string, number>;
  sourceWordCount: number;
}

async function assembleTranscript(data: Record<string, any>): Promise<AssemblyResult> {
  const stats: Record<string, number> = {};
  const registry = buildParticipantRegistry(data);

  console.log(`[Transcript Pipeline] participants resolved: ${registry.names.length ? registry.names.join(', ') : '(none)'}`);
  console.log(`[Transcript Pipeline] speaker ids: [${registry.ids.join(', ')}]`);
  console.log(`[Transcript Pipeline] speaker id -> participant map: ${JSON.stringify(registry.map)}`);

  // 1. transcription artifact (utterances with per-word timings)
  let utterances: Record<string, any>[] = [];
  if (typeof data?.transcription === 'string' && data.transcription.startsWith('http')) {
    const text = await fetchSignedText(data.transcription, 'transcription');
    if (text) {
      try {
        utterances = extractUtterances(JSON.parse(text));
      } catch (err) {
        console.error(`[Webhook] transcription artifact was not valid JSON: ${scrub(err)}`);
      }
    }
  } else if (data?.transcription && typeof data.transcription === 'object') {
    utterances = extractUtterances(data.transcription);
  }
  if (utterances.length === 0) utterances = extractUtterances(data?.raw_transcription);

  console.log(`[Transcript Pipeline] transcript segments received from MeetingBaaS: ${utterances.length}`);

  // 2. diarization artifact (cleaner speaker timeline)
  let timeline: DiarSpan[] = [];
  if (typeof data?.diarization === 'string' && data.diarization.startsWith('http')) {
    timeline = parseDiarizationTimeline(await fetchSignedText(data.diarization, 'diarization'));
  } else if (typeof data?.diarization === 'string') {
    timeline = parseDiarizationTimeline(data.diarization);
  }
  console.log(`[Transcript Pipeline] diarization intervals: ${timeline.length}`);

  const sourceWordCount = utterances.reduce((n, u) => n + countWords(String(u?.text ?? u?.transcript ?? '')), 0);

  // 3. deterministic assembly
  const words = flattenWords(utterances, timeline, registry, stats);
  console.log(
    `[Transcript Pipeline] words=${stats.totalWords} utterancesWithoutWordTimings=${stats.utterancesWithoutWordTimings} diarizationOverrides=${stats.diarizationOverrodeUtteranceSpeaker} unresolvedSpeakerWords=${stats.wordsWithNoResolvableSpeaker}`,
  );

  const sentences = buildSentences(words, stats);
  console.log(`[Transcript Pipeline] segments before cleanup: ${utterances.length} -> sentences: ${stats.sentenceCount} (contested: ${stats.contestedSentences})`);

  // 4. Gemini audits WHO said each line (text is immutable)
  const audited = await auditSpeakerAttribution(sentences, registry.names, stats);

  // 5. merge consecutive same-speaker lines into readable turns
  const turns = mergeTurns(audited, stats);
  const text = turnsToText(turns);
  console.log(`[Transcript Pipeline] segments after cleanup: ${stats.turnsAfterMerge}`);
  console.log(`[Transcript Pipeline] word conservation: source=${sourceWordCount} final=${countWords(turns.map((t) => t.text).join(' '))}`);

  return { turns, text, registry, stats, sourceWordCount };
}

// --------------------------------------------------------------------
// STEP 9 — status vocabulary
//
// `meetings.status` has a CHECK constraint (scheduled|pending|recording|
// completed|summarized|failed) so it stays as-is. The finer-grained stage the
// user sees is written to the additive `processing_stage` column.
// --------------------------------------------------------------------

type Stage =
  | 'bot_dispatched'
  | 'meeting_in_progress'
  | 'meeting_ended'
  | 'recording_retrieved'
  | 'transcript_processing'
  | 'transcript_ready'
  | 'summary_processing'
  | 'completed'
  | 'processing_failed';

/** The raw MeetingBaaS status code from a payload ('' when absent). */
function statusCodeFrom(body: Record<string, any>): string {
  const statusObj = body?.data?.status ?? body?.status;
  let code = '';
  if (typeof statusObj === 'string') code = statusObj;
  else if (statusObj && typeof statusObj === 'object') {
    code = String(statusObj.code || statusObj.value || statusObj.name || statusObj.status || '');
  }
  return code.toLowerCase().trim();
}

/**
 * MeetingBaaS reasons that mean the bot is no longer in the meeting. They come
 * from the platform's own end-of-meeting detection, and `all_participants_left`
 * is the one that means "the last human participant left" - the bot watches the
 * live attendee roster and leaves once nobody but the bot remains. MeetingBaaS
 * exposes no participant join/leave event and no participant-count API for our
 * server to poll, so these reasons are how a departure reaches us.
 */
function normalizeCode(code: string): string {
  // The same reason is spelled differently across the platform:
  // `allParticipantsLeft` internally, `ALL_PARTICIPANTS_LEFT` in the documented
  // error codes, `all_participants_left` in payloads. Compare without
  // separators so all three match.
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const MEETING_ENDED_CODES = [
  'callended',
  'allparticipantsleft',
  'noattendees',
  'nospeaker',
  'recordingtimeout',
  'botremoved',
  'apirequeststop',
  'apirequest',
];

function isMeetingEndedCode(code: string): boolean {
  const c = normalizeCode(code);
  return MEETING_ENDED_CODES.includes(c) || c.includes('ended') || c.includes('left');
}

function mapStatusChangeToStatus(
  body: Record<string, any>,
): { status: 'pending' | 'recording' | 'failed'; processing_stage: Stage; error_message?: string; ended_at?: string } | null {
  const code = statusCodeFrom(body);
  if (!code) return null;

  const errorMessage = body?.data?.error_message || body?.error_message || body?.data?.error || body?.error || null;

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
      processing_stage: 'processing_failed',
      error_message: errorMessage ? String(errorMessage) : `MeetingBaaS reported ${code}`,
      ended_at: new Date().toISOString(),
    };
  }

  // Checked before the generic "recording..." branch below, because the
  // platform's end reason `recording_timeout` also contains "recording" and
  // must not be mistaken for a meeting that is still running.
  if (isMeetingEndedCode(code)) {
    return { status: 'recording', processing_stage: 'meeting_ended', ended_at: new Date().toISOString() };
  }

  if (code.includes('recording') || code === 'in_call' || code === 'transcribing' || code === 'in_call_recording') {
    return { status: 'recording', processing_stage: 'meeting_in_progress' };
  }

  if (
    ['queued', 'joining_call', 'in_waiting_room', 'in_waiting_for_host', 'in_call_not_recording'].includes(code) ||
    code.includes('waiting') ||
    code.includes('joining')
  ) {
    return { status: 'pending', processing_stage: 'bot_dispatched' };
  }

  return null;
}

// --------------------------------------------------------------------
// HTTP entrypoint
// --------------------------------------------------------------------

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Payload must be valid JSON' }, 400);
  }

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

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing } = await supabaseAdmin
    .from('meetings')
    .select('id, status, summary, transcript')
    .eq('bot_id', botId)
    .maybeSingle();

  try {
    const isCompletion = eventType === 'bot.completed' || eventType === 'complete';
    const isFailure = eventType === 'bot.failed' || eventType === 'failed';

    if (isCompletion) {
      const alreadyHasContent =
        existing?.status === 'summarized' ||
        (existing?.status === 'completed' && (existing?.summary || existing?.transcript));
      if (alreadyHasContent) {
        return json({ success: true, event: eventType, bot_id: botId, duplicate: true, status: existing.status }, 200);
      }
      return await handleCompletion(supabaseAdmin, body, data, botId, existing?.id ?? null);
    }

    if (isFailure) {
      if (existing?.status === 'summarized') {
        return json({ success: true, event: eventType, bot_id: botId, duplicate: true }, 200);
      }
      const code = data?.error_code ? ` [${data.error_code}]` : '';
      const message =
        (data?.error_message || data?.message || data?.error || 'Bot failed to join or record the meeting.') + code;
      await updateMeetingByBotId(supabaseAdmin, botId, {
        status: 'failed',
        processing_stage: 'processing_failed',
        error_message: message,
        ended_at: new Date().toISOString(),
        raw_payload: body,
      });
      return json({ success: true, event: eventType, bot_id: botId, status: 'failed' }, 200);
    }

    const mapped = mapStatusChangeToStatus(body);
    if (mapped && existing?.status !== 'summarized') {
      if (mapped.processing_stage === 'meeting_ended') {
        const endedCode = statusCodeFrom(body);
        console.log(
          `[MeetingBaaS] Bot left the meeting (reason=${endedCode || 'unknown'}) bot_id=${botId}` +
            (endedCode === 'all_participants_left' ? ' - no human participants remained.' : '')
        );
      }
      await updateMeetingByBotId(supabaseAdmin, botId, { ...mapped, raw_payload: body });
      return json({ success: true, event: eventType, bot_id: botId, status: mapped.status, stage: mapped.processing_stage }, 200);
    }
    return json({ success: true, event: eventType, bot_id: botId, status: existing?.status ?? 'unchanged' }, 200);
  } catch (err) {
    console.error('[Webhook] processing error:', scrub(err));
    return json({ success: false, error: 'Processing error' }, 200);
  }
});

// Columns added by migration 0004. If the migration has not been applied yet we
// retry without them rather than losing the whole transcript write.
const OPTIONAL_COLUMNS = ['processing_stage', 'transcript_segments'];

async function updateMeetingByBotId(supabaseAdmin: any, botId: string, patch: Record<string, any>): Promise<any | null> {
  const { data: existing } = await supabaseAdmin
    .from('meetings')
    .select('id, transcript, status, summary')
    .eq('bot_id', botId)
    .maybeSingle();

  // Never let a shorter re-delivery clobber a longer transcript we already have.
  if (existing && patch.transcript !== undefined && existing.transcript) {
    const existingText = String(existing.transcript).trim();
    const newText = String(patch.transcript || '').trim();
    if (newText.length < existingText.length) {
      console.log(`[Webhook] Preserving existing longer transcript (${existingText.length} chars vs ${newText.length} chars)`);
      patch.transcript = existing.transcript;
    }
  }

  const write = async (p: Record<string, any>) =>
    existing
      ? await supabaseAdmin.from('meetings').update(p).eq('bot_id', botId).select().maybeSingle()
      : await supabaseAdmin.from('meetings').insert({ bot_id: botId, ...p }).select().maybeSingle();

  let { data: saved, error } = await write(patch);

  if (error && (error.code === '42703' || /column .* does not exist/i.test(error.message ?? ''))) {
    const fallback = { ...patch };
    for (const c of OPTIONAL_COLUMNS) delete fallback[c];
    console.warn(`[Webhook] meetings update rejected an optional column (${error.message}) — retrying without ${OPTIONAL_COLUMNS.join('/')}. Apply migration 0004.`);
    ({ data: saved, error } = await write(fallback));
  }

  if (error) console.error(`[Webhook] meetings write failed (${error.code}): ${error.message}`);
  return saved ?? null;
}

// --------------------------------------------------------------------
// bot.completed — assemble, audit, summarise, persist
// --------------------------------------------------------------------

/** The meeting's own date, used as "today" for spoken deadlines. */
function meetingDateISO(data: Record<string, any>): string {
  const raw = data?.joined_at ?? data?.created_at ?? data?.started_at ?? null;
  const d = raw ? new Date(raw) : new Date();
  return (Number.isNaN(d.getTime()) ? new Date() : d).toISOString().slice(0, 10);
}

async function handleCompletion(
  supabaseAdmin: any,
  body: Record<string, any>,
  data: Record<string, any>,
  botId: string,
  knownMeetingId: string | null,
): Promise<Response> {
  console.log(`[Transcript Pipeline] MeetingBaaS meeting/bot id: ${botId}`);

  const recordingUrl = data?.video ?? data?.audio ?? data?.mp4 ?? data?.mp3 ?? null;
  console.log(`[Transcript Pipeline] recording available: ${recordingUrl ? 'yes' : 'no'}`);
  console.log(`[Transcript Pipeline] transcription artifact available: ${data?.transcription ? 'yes' : 'no'}`);
  console.log(`[Transcript Pipeline] diarization artifact available: ${data?.diarization ? 'yes' : 'no'}`);

  const rawDuration = data?.duration_seconds ?? data?.duration ?? null;
  const durationSecs = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? Math.round(rawDuration) : null;

  await updateMeetingByBotId(supabaseAdmin, botId, {
    status: 'recording',
    processing_stage: 'transcript_processing',
    recording_url: recordingUrl,
  });

  const assembled = await assembleTranscript(data);
  const meetingISO = meetingDateISO(data);

  // No speech / no transcript: finish honestly. Never fabricate content.
  if (assembled.turns.length === 0) {
    console.warn('[Transcript Pipeline] MeetingBaaS returned no transcript content — nothing to summarise.');
    const meeting = await updateMeetingByBotId(supabaseAdmin, botId, {
      status: 'completed',
      processing_stage: 'completed',
      recording_url: recordingUrl,
      duration_secs: durationSecs,
      ended_at: new Date().toISOString(),
      error_message: 'Meeting ended, but no transcript content was produced (no speech detected or transcription unavailable).',
      raw_payload: body,
    });
    return json(
      { success: true, event: 'bot.completed', bot_id: botId, status: 'completed', transcript: false, meeting_id: meeting?.id ?? knownMeetingId },
      200,
    );
  }

  // STEP 8: the transcript is complete before anything is summarised, and it is
  // persisted first so a Gemini failure can never cost us the transcript.
  const transcriptSaved = await updateMeetingByBotId(supabaseAdmin, botId, {
    status: 'completed',
    processing_stage: 'transcript_ready',
    transcript: assembled.text,
    transcript_segments: assembled.turns,
    recording_url: recordingUrl,
    duration_secs: durationSecs,
    ended_at: new Date().toISOString(),
    error_message: null,
    raw_payload: body,
  });
  const meetingId = transcriptSaved?.id ?? knownMeetingId;
  await replaceTranscriptRows(supabaseAdmin, meetingId, assembled.turns);

  await updateMeetingByBotId(supabaseAdmin, botId, { processing_stage: 'summary_processing' });
  const analysis = await analyzeTranscript(assembled.text, assembled.registry.names, meetingISO);

  if (!analysis) {
    console.warn('[Transcript Pipeline] summarisation failed — complete transcript remains saved and visible.');
    await updateMeetingByBotId(supabaseAdmin, botId, {
      status: 'completed',
      processing_stage: 'processing_failed',
      error_message: 'Transcript captured, but AI summarization failed (transcript preserved).',
    });
    return json(
      { success: true, event: 'bot.completed', bot_id: botId, status: 'completed', summarized: false, meeting_id: meetingId, metrics: assembled.stats },
      200,
    );
  }

  console.log(`[Transcript Pipeline] action items extracted: ${analysis.action_items.length}`);

  const meeting = await updateMeetingByBotId(supabaseAdmin, botId, {
    status: 'summarized',
    processing_stage: 'completed',
    summary: analysis.executive_summary,
    action_items: analysis.action_items,
    error_message: null,
  });

  const finalId = meeting?.id ?? meetingId;
  if (finalId) await persistAnalysis(supabaseAdmin, finalId, analysis);

  return json(
    {
      success: true,
      event: 'bot.completed',
      bot_id: botId,
      status: 'summarized',
      meeting_id: finalId,
      participants: assembled.registry.names,
      summary: analysis.executive_summary,
      action_items: analysis.action_items,
      metrics: assembled.stats,
    },
    200,
  );
}

// --------------------------------------------------------------------
// Persistence helpers
// --------------------------------------------------------------------

/** Replace (not append) the per-turn transcript rows so re-delivery can't duplicate them. */
async function replaceTranscriptRows(supabaseAdmin: any, meetingId: string | null, turns: TranscriptTurn[]): Promise<void> {
  if (!meetingId || turns.length === 0) return;

  const { error: delError } = await supabaseAdmin.from('transcripts').delete().eq('meeting_id', meetingId);
  if (delError) console.error(`[Webhook] transcripts cleanup failed (${delError.code}): ${delError.message}`);

  const rows = turns.map((t) => ({ meeting_id: meetingId, speaker: t.speaker, text: t.text }));
  const { error } = await supabaseAdmin.from('transcripts').insert(rows);
  if (error) console.error(`[Webhook] transcripts insert failed (${error.code}): ${error.message}`);
  else console.log(`[Transcript Pipeline] Supabase save: ${rows.length} transcript row(s) persisted.`);
}

async function persistAnalysis(supabaseAdmin: any, meetingId: string, analysis: AIAnalysis): Promise<void> {
  const { error: summaryError } = await supabaseAdmin.from('summaries').insert({
    meeting_id: meetingId,
    executive_summary: analysis.executive_summary,
    key_decisions: analysis.key_decisions,
    sentiment: analysis.sentiment,
  });
  if (summaryError) console.error(`[Webhook] summaries insert failed (${summaryError.code}): ${summaryError.message}`);

  if (analysis.action_items.length === 0) {
    console.log('[Transcript Pipeline] Supabase save: summary stored, no action items to store.');
    return;
  }

  const rows = analysis.action_items.map((a) => ({
    meeting_id: meetingId,
    task: a.task,
    assignee: a.assignee,
    due_day: a.due_day,
    due_date: a.due_date,
    status: a.status,
  }));

  const { error: delError } = await supabaseAdmin.from('action_items').delete().eq('meeting_id', meetingId);
  if (delError) console.error(`[Webhook] action_items cleanup failed (${delError.code}): ${delError.message}`);

  let { error } = await supabaseAdmin.from('action_items').insert(rows);
  if (error && (error.code === '42703' || /column .* does not exist/i.test(error.message ?? ''))) {
    console.warn('[Webhook] action_items.due_day missing — retrying without it. Apply migration 0004.');
    ({ error } = await supabaseAdmin.from('action_items').insert(rows.map(({ due_day: _d, ...r }) => r)));
  }
  if (error) console.error(`[Webhook] action_items insert failed (${error.code}): ${error.message}`);
  else console.log(`[Transcript Pipeline] Supabase save: summary + ${rows.length} action item(s) persisted.`);
}
