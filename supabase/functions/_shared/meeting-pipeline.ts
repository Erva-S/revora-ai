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
//                        persist the grounded transcript, summarise, and
//                        persist meetings + transcripts + summaries + action_items.
//
// TRANSCRIPT ASSEMBLY (see assembleTranscript below)
//   The standardized transcription is authoritative for speaker names, word
//   order and chunk-adjusted timing. Diarization only fills unresolved identities
//   where one speaker is active. Overlapping utterances remain separate.
//   Deterministic transcript data is saved before Gemini. Gemini is never used
//   to decide who said a transcript line.
// ====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { loadCarryoverTasks, persistContextTasks, validateTaskUpdates } from './context-tasks.ts';
import type { CarryoverTask, TaskUpdate } from './context-tasks.ts';
import { missingSchema, sha256 } from './context-utils.ts';
import { queueContextIndex } from './context-dispatch.ts';
import { STT_PROVIDERS } from './meetingbaas.ts';
import { recordingPatch, saveRecording, videoUrl } from './meeting-recording.ts';
import { verifyMeetingBaasRequest } from './meetingbaas-auth.ts';
import { queueElevenLabsTranscription } from './elevenlabs.ts';
import { meetingEventMetadata, pipelineLog, scrub } from './pipeline-log.ts';

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
  start: number | null;
  end: number | null;
  confidence: number;
  speaker: string | null;
  utteranceIndex: number;
  sourceSpeakerId?: string | null;
  source: 'provider' | 'diarization' | 'unknown';
  wordTimed: boolean;
  contested?: boolean;
  mapping?: TranscriptTurn['speaker_mapping'];
  sourceWordIndex?: number;
}

/** A transcript turn: real MeetingBaaS words, one resolved speaker. */
interface TranscriptTurn {
  speaker: string;
  text: string;
  start_time: number | null;
  end_time: number | null;
  speaker_source?: 'provider' | 'diarization' | 'unknown';
  source_utterance_index?: number;
  source_utterance_indices?: number[];
  source_speaker_id?: string | null;
  speaker_mapping?: { speaker_id: string; participant: string | null; evidence_seconds: number; agreement: number };
  words?: { word: string; start: number | null; end: number | null; confidence: number }[];
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
  open_questions: string[];
  key_decisions: string[];
  sentiment: string;
  action_items: ActionItem[];
  task_updates: TaskUpdate[];
}

// --------------------------------------------------------------------
// STEP 2 — participant roster from MeetingBaaS metadata (never hardcoded)
// --------------------------------------------------------------------

/** Alias key: lowercase, punctuation collapsed to single spaces. */
function normKey(s: unknown): string {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Build the allowed-speaker roster from `participants` + `speakers` in the bot
 * payload. Our own bot is excluded by comparing against `bot_name` / `is_bot`
 * so no brand string is hardcoded and future meetings work unchanged.
 */
function buildParticipantRegistry(data: Record<string, any>): ParticipantRegistry {
  const reg: ParticipantRegistry = { names: [], lookup: new Map(), ids: [], map: {} };
  const botKeys = new Set(data?.bot_name ? [data.bot_name, `${data.bot_name} (You)`, `${data.bot_name} (Guest)`].map(normKey) : []);
  const ambiguous = new Set<string>();
  const addAlias = (key: string, name: string) => {
    if (!key || ambiguous.has(key)) return;
    if (reg.lookup.has(key) && reg.lookup.get(key) !== name) { reg.lookup.delete(key); ambiguous.add(key); }
    else reg.lookup.set(key, name);
  };

  const consider = (entry: unknown) => {
    if (entry == null) return;
    const p: Record<string, any> = typeof entry === 'string' ? { name: entry } : (entry as Record<string, any>);
    const rawName: string | undefined = p.name ?? p.speaker ?? p.display_name ?? p.user_name ?? undefined;
    const rawId = p.id ?? p.user_id ?? p.speaker_id ?? p.participant_id;
    if (!rawName || !String(rawName).trim()) return;

    // Never let the assistant bot become a transcript speaker.
    if (p.is_bot === true) return;
    if (botKeys.has(normKey(rawName))) return;

    const canonical = String(rawName).trim();
    if (!reg.names.includes(canonical)) reg.names.push(canonical);

    for (const alias of [rawName, canonical, p.display_name, p.user_name]) {
      const k = normKey(alias);
      addAlias(k, canonical);
    }
    if (rawId !== undefined && rawId !== null && String(rawId).trim()) {
      const idKey = normKey(String(rawId));
      addAlias(idKey, canonical);
      if (p.speaker_id !== undefined) addAlias(normKey(p.speaker_id), canonical);
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

/** Fetch a signed artifact URL. Returns null instead of throwing.
 *  Retries up to 2 more times with short backoff on network errors or HTTP 5xx.
 *  Non-retryable failures (4xx) return null immediately. Total worst-case
 *  added time: ~1.5s (500ms + 1000ms backoffs).
 */
async function fetchSignedText(url: string, label: string): Promise<string | null> {
  const BACKOFFS = [0, 500, 1000]; // first attempt immediate, then 500ms, then 1000ms
  for (let attempt = 0; attempt < BACKOFFS.length; attempt++) {
    if (BACKOFFS[attempt] > 0) {
      await new Promise((r) => setTimeout(r, BACKOFFS[attempt]));
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.ok) return await res.text();
      await res.body?.cancel();
      // 5xx → retry if attempts remain; anything else → give up.
      if (res.status >= 500 && attempt < BACKOFFS.length - 1) {
        console.warn(`[Webhook] ${label} artifact fetch HTTP ${res.status} (attempt ${attempt + 1}/${BACKOFFS.length}) — retrying.`);
        continue;
      }
      console.error(`[Webhook] ${label} artifact fetch failed: HTTP ${res.status}`);
      return null;
    } catch (err) {
      if (attempt < BACKOFFS.length - 1) {
        console.warn(`[Webhook] ${label} artifact fetch error (attempt ${attempt + 1}/${BACKOFFS.length}): ${scrub(err)} — retrying.`);
        continue;
      }
      console.error(`[Webhook] ${label} artifact fetch error: ${scrub(err)}`);
      return null;
    }
  }
  return null;
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
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return;
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

/** Fallback only: overlapping/nearby activity cannot override a named utterance. */
function overlap(start: number, end: number, otherStart: number, otherEnd: number): number {
  return Math.max(0, Math.min(end, otherEnd) - Math.max(start, otherStart));
}

function diarizationSpeakerForInterval(
  timeline: DiarSpan[],
  start: number | null,
  end: number | null,
  reg: ParticipantRegistry,
): { speaker: string | null; contested: boolean } {
  const midpoint = start !== null && end !== null ? (start + end) / 2 : start;
  if (midpoint === null) return { speaker: null, contested: false };
  const scores = new Map<string, number>();
  for (const span of timeline) {
    const speaker = canonicalSpeaker(reg, span.speakerName) ?? canonicalSpeaker(reg, span.speakerId);
    if (!speaker) continue;
    const score = start !== null && end !== null && end > start
      ? overlap(start, end, span.start, span.end)
      : (midpoint >= span.start && midpoint < span.end ? 1 : 0);
    if (score > 0) scores.set(speaker, (scores.get(speaker) ?? 0) + score);
  }
  if (scores.size === 1) {
    const [speaker, coverage] = [...scores][0]!;
    const duration = start !== null && end !== null ? end - start : 0;
    return { speaker: duration <= 0 || coverage >= duration * 0.8 ? speaker : null, contested: false };
  }
  if (scores.size > 1) return { speaker: null, contested: true };

  return { speaker: null, contested: false };
}

/** Acoustic IDs are a separate namespace. Map a cluster only when sustained,
 * nonoverlapping timeline evidence agrees; do not rename it word by word.
 */
function sourceSpeakerId(u: Record<string, any>, w: Record<string, any> = {}): string {
  const id = w.speaker_id ?? w.speakerId ?? w.speaker?.id ?? (typeof w.speaker === 'string' ? w.speaker : null) ??
    u.speaker_id ?? u.cluster ?? u.speakerId ?? u.speaker?.id ?? (typeof u.speaker === 'string' ? u.speaker : null);
  return String(id ?? 'unknown');
}

function acousticSpeakerMappings(utterances: Record<string, any>[], timeline: DiarSpan[], reg: ParticipantRegistry) {
  const evidence = new Map<string, { total: number; votes: Map<string, number> }>();
  for (const u of utterances) {
    for (const word of Array.isArray(u.words) && u.words.length ? u.words : [u]) {
      const id = sourceSpeakerId(u, word);
      const item = evidence.get(id) ?? { total: 0, votes: new Map<string, number>() };
      evidence.set(id, item);
      const start = seconds(word.start ?? word.start_time);
      const end = seconds(word.end ?? word.end_time);
      if (start === null || end === null || end <= start) continue;
      const duration = end - start;
      item.total += duration;
      const resolved = diarizationSpeakerForInterval(timeline, start, end, reg);
      if (!resolved.speaker || resolved.contested) continue;
      const covered = Math.min(duration, timeline.filter((span) =>
        (canonicalSpeaker(reg, span.speakerName) ?? canonicalSpeaker(reg, span.speakerId)) === resolved.speaker)
        .reduce((n, span) => n + overlap(start, end, span.start, span.end), 0));
      item.votes.set(resolved.speaker, (item.votes.get(resolved.speaker) ?? 0) + covered);
      evidence.set(id, item);
    }
  }
  return new Map([...evidence].map(([id, item]) => {
    const ranked = [...item.votes].sort((a, b) => b[1] - a[1]);
    const first = ranked[0];
    const observed = ranked.reduce((n, [, score]) => n + score, 0);
    const agreement = first && observed ? first[1] / observed : 0;
    const coverage = item.total ? observed / item.total : 0;
    const participant = id !== 'unknown' && first && first[1] >= 2 && agreement >= 0.9 && coverage >= 0.7 ? first[0] : null;
    return [id, { speaker_id: id, participant, evidence_seconds: observed, agreement }] as const;
  }));
}

/** Pull the utterance array out of whichever envelope the provider used. */
function extractUtterances(doc: unknown): Record<string, any>[] {
  if (!doc) return [];
  if (Array.isArray(doc)) {
    return doc.some((item: any) => item?.event === 'transcript.segment')
      ? coalesceRealtimeTranscriptSegments(doc)
      : doc as Record<string, any>[];
  }
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

const seconds = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/**
 * Flatten within each utterance, keeping its words and provider identity intact.
 * Diarization is used only when a named speaker cannot be resolved.
 */
function flattenWords(
  utterances: Record<string, any>[],
  timeline: DiarSpan[],
  reg: ParticipantRegistry,
  stats: Record<string, number>,
): WordUnit[] {
  const words: WordUnit[] = [];
  const mappings = acousticSpeakerMappings(utterances, timeline, reg);
  const fallbackLabels = new Map<string, string>();
  const identity = (u: Record<string, any>, w: Record<string, any> = {}) => {
    const id = sourceSpeakerId(u, w);
    if (!fallbackLabels.has(id)) fallbackLabels.set(id, `Speaker ${fallbackLabels.size + 1}`);
    const acoustic = !!u.anonymous_speaker_label || /^speaker[_ -]?\d+$|^\d+$|^unknown$/i.test(id);
    const rawName = w.speaker?.name ?? w.speaker_name ?? (typeof w.speaker === 'string' ? w.speaker : null) ??
      (canonicalSpeaker(reg, id) ? id : null) ??
      u.speaker?.name ?? u.speaker_name ?? (typeof u.speaker === 'string' ? u.speaker : null);
    const provided = acoustic ? null : canonicalSpeaker(reg, rawName);
    const mapping = mappings.get(id);
    return { id, speaker: provided ?? mapping?.participant ?? fallbackLabels.get(id)!, mapping,
      source: provided ? 'provider' as const : mapping?.participant ? 'diarization' as const : 'unknown' as const };
  };
  stats.utterancesWithoutWordTimings = 0;
  stats.diarizationOverrodeUtteranceSpeaker = 0;
  stats.wordsWithNoResolvableSpeaker = 0;
  stats.overlapWords = 0;

  utterances.forEach((u, ui) => {
    let list = Array.isArray(u.words) ? u.words.filter((w: any) => w && typeof w === 'object') : [];
    // Some providers return a partial word list. Preserve the complete utterance
    // instead of silently dropping words that have no timing entry.
    const fullText = String(u.text ?? u.transcript ?? '').trim();
    const wordText = list.map((w: any) => `${typeof w.separator === 'string' ? w.separator : ' '}${String(w.word ?? w.text ?? '')}`).join('');
    if (fullText && normKey(wordText) !== normKey(fullText)) list = [];

    if (list.length === 0) {
      // No per-word timings: keep the utterance intact as a single pseudo-word.
      stats.utterancesWithoutWordTimings++;
      const text = String(u.text ?? u.transcript ?? '').trim();
      if (!text) return;
      const start = seconds(u.start ?? u.start_time);
      const end = seconds(u.end ?? u.end_time);
      const diar = diarizationSpeakerForInterval(timeline, start, end, reg);
      const resolved = identity(u);
      if (resolved.source === 'unknown') stats.wordsWithNoResolvableSpeaker += countWords(text);
      if (diar.contested) stats.overlapWords++;
      words.push({ token: ` ${text}`, start, end, confidence: Number(u.confidence ?? 0), speaker: resolved.speaker, utteranceIndex: u.source_utterance_index ?? ui,
        sourceSpeakerId: resolved.id, contested: diar.contested, mapping: resolved.mapping,
        source: resolved.source, wordTimed: false });
      return;
    }

    for (const [wi, w] of list.entries()) {
      const token = String(w.word ?? w.text ?? '');
      if (!token.trim()) continue;
      const start = seconds(w.start ?? w.start_time);
      const end = seconds(w.end ?? w.end_time);
      const diar = diarizationSpeakerForInterval(timeline, start, end, reg);
      const resolved = identity(u, w);
      if (resolved.source === 'unknown') stats.wordsWithNoResolvableSpeaker++;
      if (diar.contested) stats.overlapWords++;
      words.push({
        token: typeof w.separator === 'string' ? `${w.separator}${token}` : token.startsWith(' ') ? token : ` ${token}`,
        start,
        end,
        confidence: Number(w.confidence ?? u.confidence ?? 0),
        speaker: resolved.speaker,
        utteranceIndex: u.source_utterance_index ?? ui,
        sourceSpeakerId: resolved.id,
        sourceWordIndex: w.source_word_index ?? wi,
        contested: diar.contested,
        mapping: resolved.mapping,
        source: resolved.source,
        wordTimed: true,
      });
    }
  });

  // Keep each utterance's word order: global timestamp sorting interleaves the
  // words of simultaneous speakers into sentences that nobody actually spoke.
  stats.totalWords = words.length;
  return words;
}

/**
 * Segment within utterances, splitting on every speaker boundary. There is no
 * majority vote that could hand a short reply to the person speaking longest.
 */
function buildSentences(words: WordUnit[], stats: Record<string, number>): TranscriptTurn[] {
  const units: TranscriptTurn[] = [];
  let cur: WordUnit[] = [];
  let contested = 0;

  const flush = () => {
    if (cur.length === 0) return;
    const text = cur.map((w) => w.token).join('').replace(/\s+/g, ' ').trim();
    const confs = cur.map((w) => w.confidence).filter((c) => Number.isFinite(c) && c > 0);
    if (text) {
      units.push({
        speaker: cur[0].speaker ?? 'Unidentified Speaker',
        text,
        start_time: cur[0].start,
        end_time: cur[cur.length - 1].end,
        contested: cur.some((w) => w.contested),
        speaker_source: cur[0].source,
        source_utterance_index: cur[0].utteranceIndex,
        source_utterance_indices: [...new Set(cur.map((w) => w.utteranceIndex))],
        source_speaker_id: cur[0].sourceSpeakerId ?? null,
        ...(cur[0].mapping ? { speaker_mapping: cur[0].mapping } : {}),
        ...(cur.every((w) => w.wordTimed) ? { words: cur.map((w) => ({ word: w.token.trim(), start: w.start, end: w.end, confidence: w.confidence,
          speaker_id: w.sourceSpeakerId, source_utterance_index: w.utteranceIndex, source_word_index: w.sourceWordIndex })) } : {}),
        confidence: confs.length ? Number((confs.reduce((a, b) => a + b, 0) / confs.length).toFixed(3)) : 0,
      });
    }
    cur = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    cur.push(w);
    const next = words[i + 1];
    const speakerTurn = next && (next.speaker !== w.speaker || next.sourceSpeakerId !== w.sourceSpeakerId || next.utteranceIndex !== w.utteranceIndex);
    // Punctuation is not a speaker boundary. Provider utterance and timestamp
    // boundaries are authoritative; punctuation only remains transcript text.
    if (speakerTurn || !next) flush();
  }
  flush();

  units.sort((a, b) => (a.start_time ?? Infinity) - (b.start_time ?? Infinity) ||
    (a.source_utterance_index ?? Infinity) - (b.source_utterance_index ?? Infinity));
  // Mark actual overlap without concatenating the simultaneous sentences.
  let active: TranscriptTurn[] = [];
  for (const turn of units) {
    if (turn.start_time === null || turn.end_time === null) continue;
    active = active.filter((u) => u.end_time! > turn.start_time!);
    for (const other of active) if (other.source_speaker_id !== turn.source_speaker_id) { other.contested = true; turn.contested = true; }
    active.push(turn);
  }
  contested = units.filter((u) => u.contested).length;
  stats.sentenceCount = units.length;
  stats.contestedSentences = contested;
  return units;
}

/** Merge consecutive sentences by the same speaker into one readable turn. */
function mergeTurns(units: TranscriptTurn[], stats: Record<string, number>, maxGap = 2): TranscriptTurn[] {
  const out: TranscriptTurn[] = [];
  for (const u of units) {
    const prev = out[out.length - 1];
    const sameEvidence = prev && (u.source_speaker_id != null || prev.source_speaker_id != null)
      ? u.source_speaker_id != null && u.source_speaker_id !== 'unknown' && prev.source_speaker_id === u.source_speaker_id
      : prev && prev.speaker_source === u.speaker_source && prev.speaker !== 'Unidentified Speaker';
    if (prev && prev.speaker === u.speaker && !prev.contested && !u.contested && sameEvidence &&
        u.start_time !== null && prev.end_time !== null &&
        u.start_time >= prev.end_time && u.start_time - prev.end_time <= Math.min(maxGap, 2)) {
      prev.text += /^[,.!?;:']/.test(u.text) ? u.text : ` ${u.text}`;
      prev.end_time = u.end_time;
      prev.contested = prev.contested || u.contested;
      prev.words = prev.words && u.words ? [...prev.words, ...u.words] : undefined;
      prev.source_utterance_indices = [...new Set([...(prev.source_utterance_indices ?? []), ...(u.source_utterance_indices ?? [])])];
      continue;
    }
    out.push({ ...u });
  }
  stats.turnsAfterMerge = out.length;
  return out;
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
// Gemini transport for summary/action-item analysis only
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

  const deadline = Date.now() + 60000;
  for (const model of geminiModelChain()) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (Date.now() >= deadline) return null;
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            signal: AbortSignal.timeout(Math.max(1, Math.min(20000, deadline - Date.now()))),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature, maxOutputTokens: 8192, responseMimeType: 'application/json' },
            }),
          },
        );

        if (!res.ok) {
          await res.body?.cancel();
          console.error(`[Gemini] ${label} model=${model} attempt=${attempt} HTTP ${res.status}`);
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

function buildAnalysisPrompt(transcriptText: string, roster: string[], meetingISO: string, openTasks: CarryoverTask[] = []): string {
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

OPEN QUESTIONS: Return open_questions as strings describing topics actually raised but left unresolved. Do not invent questions.
${openTasks.length ? `
EXISTING PROJECT TASKS (reference data, not new commitments):
${JSON.stringify(openTasks)}
You may additionally return task_updates:[{"task_id":"an ID above","status":"pending|in_progress|completed","evidence":"verbatim quote from the CURRENT transcript"}].
Only update a known task when that quote clearly evidences its new status. Otherwise return no update. Historical tasks must NEVER create new action_items; new items still require commitments in the CURRENT transcript.
` : ''}

TRANSCRIPT:
${transcriptText}

Return ONLY this JSON:
{"executive_summary":"2-4 sentences on what the meeting was about and what was decided","key_topics":["topic"],"key_decisions":["decision"],"open_questions":["topic raised but unresolved"],"sentiment":"positive|neutral|negative","action_items":[{"task":"what needs doing","assignee":"Exact Name or null","due_day":"Wednesday or null","due_date":"YYYY-MM-DD or null","status":"pending"}]}`;
}

/** Returns null when Gemini is unavailable — the transcript is preserved regardless. */
async function analyzeTranscript(transcriptText: string, roster: string[], meetingISO: string, openTasks: CarryoverTask[] = []): Promise<AIAnalysis | null> {
  if (!transcriptText.trim()) return null;

  console.log('[Transcript Pipeline] Gemini summarisation request started.');
  const raw = await callGemini(buildAnalysisPrompt(transcriptText, roster, meetingISO, openTasks), 'summarisation', 0.2);
  if (!raw) return null;

  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(cleanJsonResponse(raw));
  } catch {
    console.error('[Transcript Pipeline] could not parse summarisation JSON.');
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
    open_questions: asStrings(parsed.open_questions),
    key_decisions: asStrings(parsed.key_decisions ?? parsed.decisions),
    sentiment: ['positive', 'neutral', 'negative'].includes(String(parsed.sentiment)) ? String(parsed.sentiment) : 'neutral',
    action_items: actionItems,
    task_updates: validateTaskUpdates(parsed.task_updates, openTasks, transcriptText),
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
  provider: string | null;
  rawTranscription: unknown;
  rawDiarization: string | null;
  standardizedTranscription: unknown;
  transcriptionArtifactText: string | null;
}

/**
 * MeetingBaaS streaming events are progressive snapshots. This helper is not
 * used by the current batch bot, but prevents a future streaming consumer from
 * persisting partial + final copies as separate turns. Only final events are
 * returned for permanent transcript storage.
 */
export function coalesceRealtimeTranscriptSegments(events: unknown[]): Record<string, any>[] {
  const records: { segment: Record<string, any>; final: boolean; order: number }[] = [];
  const numeric = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
  const sameSpeaker = (a: Record<string, any>, b: Record<string, any>) => {
    const aSpeaker = a.speaker_id ?? (typeof a.speaker === 'object' ? a.speaker?.id ?? a.speaker?.name : a.speaker) ?? null;
    const bSpeaker = b.speaker_id ?? (typeof b.speaker === 'object' ? b.speaker?.id ?? b.speaker?.name : b.speaker) ?? null;
    return aSpeaker !== null && bSpeaker !== null && String(aSpeaker) === String(bSpeaker);
  };
  const overlaps = (a: Record<string, any>, b: Record<string, any>) => {
    const as = numeric(a.start ?? a.utteranceStart ?? a.start_time);
    const ae = numeric(a.end ?? a.utteranceEnd ?? a.end_time);
    const bs = numeric(b.start ?? b.utteranceStart ?? b.start_time);
    const be = numeric(b.end ?? b.utteranceEnd ?? b.end_time);
    return as !== null && ae !== null && bs !== null && be !== null &&
      (Math.min(ae, be) > Math.max(as, bs) || (as === bs && ae === be));
  };
  for (const item of events as Record<string, any>[]) {
    const data = item?.data ?? item;
    if (!data || typeof data.text !== 'string' || !data.text.trim()) continue;
    const segment = {
      speaker: data.speaker?.name ?? data.speaker?.id ?? data.speaker_id ?? 'unknown',
      speaker_id: data.speaker?.id ?? data.speaker_id ?? null,
      text: data.text,
      start: data.utteranceStart ?? data.start_time ?? data.start,
      end: data.utteranceEnd ?? data.end_time ?? data.end,
      confidence: data.confidence,
      segment_id: data.segment_id ?? data.utterance_id,
      words: Array.isArray(data.words) ? data.words.map((word: any) => ({
        word: word.text ?? word.word,
        start: word.start,
        end: word.end,
        confidence: word.confidence,
        speaker_id: word.speaker?.id ?? word.speaker_id,
      })) : undefined,
    };
    const final = data.isFinal === true || data.is_final === true;
    for (let i = records.length - 1; i >= 0; i--) {
      if (!sameSpeaker(records[i].segment, segment) || !overlaps(records[i].segment, segment)) continue;
      const prior = records[i];
      const sameId = segment.segment_id !== undefined && prior.segment.segment_id === segment.segment_id;
      const sameFinal = prior.segment.start === segment.start && prior.segment.end === segment.end && prior.segment.text === segment.text;
      if (!prior.final || (final && (sameId || sameFinal))) records.splice(i, 1);
    }
    records.push({ segment, final, order: events.indexOf(item) });
  }
  return records.filter((record) => record.final).sort((a, b) => a.order - b.order).map((record) => record.segment);
}

function dedupeUtterances(utterances: Record<string, any>[], stats: Record<string, number>): Record<string, any>[] {
  const kept: Record<string, any>[] = [];
  const seenUtterances = new Set<string>();
  const seenWords = new Set<string>();
  const originalText = (u: Record<string, any>) => String(u.text ?? u.transcript ??
    (Array.isArray(u.words) ? u.words.map((w: any) => w.word ?? w.text ?? '').join(' ') : ''));
  const time = (u: Record<string, any>) => ({
    start: seconds(u.start ?? u.start_time), end: seconds(u.end ?? u.end_time),
  });
  stats.sourceUtteranceCount = utterances.length;
  for (const [sourceIndex, raw] of utterances.entries()) {
    if (raw.isFinal === false || raw.is_final === false) {
      stats.partialEventsIgnored = (stats.partialEventsIgnored ?? 0) + 1;
      continue;
    }
    const utterance: Record<string, any> = { ...raw, source_utterance_index: raw.source_utterance_index ?? sourceIndex };
    const identity = sourceSpeakerId(utterance);
    const text = originalText(utterance);
    const current = time(utterance);
    const key = JSON.stringify([identity,current.start,current.end,text,utterance.words ?? null]);
    const duplicate = text && current.start !== null && current.end !== null && seenUtterances.has(key);
    if (duplicate) {
      stats.duplicateUtterancesRemoved = (stats.duplicateUtterancesRemoved ?? 0) + 1;
      continue;
    }
    seenUtterances.add(key);
    // Remove only exact timed word redeliveries from the same source speaker.
    // Repeated phrases at another time, or simultaneous speakers, are retained.
    const sourceWords = Array.isArray(utterance.words) ? utterance.words : [];
    const wordText = sourceWords.map((w: any) => `${w.separator ?? ' '}${String(w.word ?? w.text ?? '')}`).join('').trim().replace(/\s+/g, ' ');
    if (sourceWords.length && wordText === text.trim().replace(/\s+/g, ' ')) {
      const filtered = sourceWords.map((w: any, i: number) => ({ ...w, source_word_index: w.source_word_index ?? i })).filter((w: any) => {
        const start = seconds(w.start ?? w.start_time), end = seconds(w.end ?? w.end_time);
        if (start === null || end === null) return true;
        const speaker = sourceSpeakerId(utterance, w);
        const key = JSON.stringify([speaker,
          start, end, String(w.word ?? w.text ?? '')]);
        if (seenWords.has(key)) {
          stats.duplicateWordsRemoved = (stats.duplicateWordsRemoved ?? 0) + 1;
          return false;
        }
        seenWords.add(key);
        return true;
      });
      if (filtered.length !== sourceWords.length) {
        utterance.words = filtered;
        utterance.text = filtered.map((w: any) => `${w.separator ?? ' '}${String(w.word ?? w.text ?? '')}`).join('').trim();
        if (!filtered.length) continue;
        utterance.start = filtered[0].start ?? filtered[0].start_time;
        utterance.end = filtered.at(-1).end ?? filtered.at(-1).end_time;
      }
    }
    kept.push(utterance);
  }
  return kept;
}

export async function assembleTranscript(data: Record<string, any>): Promise<AssemblyResult> {
  const started = Date.now();
  const stats: Record<string, number> = {};
  const [transcriptionText, diarizationText, rawProviderText] = await Promise.all([
    typeof data.transcription === 'string' && data.transcription.startsWith('https://')
      ? fetchSignedText(data.transcription, 'transcription') : Promise.resolve(null),
    typeof data.diarization === 'string' && data.diarization.startsWith('https://')
      ? fetchSignedText(data.diarization, 'diarization') : Promise.resolve(typeof data.diarization === 'string' ? data.diarization : null),
    typeof data.raw_transcription === 'string' && data.raw_transcription.startsWith('https://')
      ? fetchSignedText(data.raw_transcription, 'raw transcription') : Promise.resolve(null),
  ]);
  if (typeof data.raw_transcription === 'string' && data.raw_transcription.startsWith('https://') && rawProviderText === null)
    throw new Error('Raw provider transcription artifact unavailable; retry completion.');
  let rawProviderDoc: unknown = rawProviderText;
  if (rawProviderText !== null) {
    try { rawProviderDoc = JSON.parse(rawProviderText); }
    catch { throw new Error('Invalid raw provider transcription JSON; retry completion.'); }
  }
  let doc = data.transcription;
  if (typeof doc === 'string') {
    // An artifact outage is retryable, not a successful silent meeting.
    if (!transcriptionText) throw new Error('Transcription artifact unavailable; retry completion.');
    try { doc = JSON.parse(transcriptionText); } catch { throw new Error('Invalid transcription artifact; retry completion.'); }
    if (!Array.isArray(doc) && !Array.isArray(doc?.result?.utterances) && !Array.isArray(doc?.utterances))
      throw new Error('Unexpected transcription artifact structure; retry completion.');
  }
  // v1 inline transcripts are still accepted for historical callbacks. Raw STT
  // responses have chunk-relative times and anonymous IDs: never display them.
  const utterances = dedupeUtterances(
    extractUtterances(doc || data.transcript).filter((u) => u && typeof u === 'object'),
    stats,
  );
  if (doc?.bot_id && data.bot_id && doc.bot_id !== data.bot_id) throw new Error('Transcription artifact bot ID mismatch.');
  const timeline = parseDiarizationTimeline(diarizationText);
  let registry = buildParticipantRegistry(data);
  const artifactNames = registry.names.length ? [] : [
    ...utterances.map((u) => typeof u.speaker === 'object' ? u.speaker?.name : u.speaker), ...timeline.map((s) => s.speakerName)]
    .filter((name) => typeof name === 'string' && name.trim() && !/^(?:speaker[ _-]*)?\d+$|^unknown$|^unidentified speaker$/i.test(name.trim()) && !canonicalSpeaker(registry, name));
  registry = buildParticipantRegistry({ ...data, speakers: [...(Array.isArray(data.speakers) ? data.speakers : []), ...artifactNames] });
  console.log(`[Transcript Pipeline] diarization intervals: ${timeline.length}`);

  const sourceWordCount = utterances.reduce((n, u) => n + countWords(String(u?.text ?? u?.transcript ??
    (Array.isArray(u.words) ? u.words.map((w: any) => w.word ?? w.text ?? '').join(' ') : ''))), 0);

  // 3. deterministic assembly
  const words = flattenWords(utterances, timeline, registry, stats);
  console.log(
    `[Transcript Pipeline] words=${stats.totalWords} utterancesWithoutWordTimings=${stats.utterancesWithoutWordTimings} diarizationOverrides=${stats.diarizationOverrodeUtteranceSpeaker} unresolvedSpeakerWords=${stats.wordsWithNoResolvableSpeaker}`,
  );

  const sentences = buildSentences(words, stats);
  console.log(`[Transcript Pipeline] segments before cleanup: ${utterances.length} -> sentences: ${stats.sentenceCount} (contested: ${stats.contestedSentences})`);

  // Finished deterministic content is the only input to Gemini analysis.
  const turns = mergeTurns(sentences, stats);
  const text = turnsToText(turns);
  console.log(`[Transcript Pipeline] segments after cleanup: ${stats.turnsAfterMerge}`);
  console.log(`[Transcript Pipeline] word conservation: source=${sourceWordCount} final=${countWords(turns.map((t) => t.text).join(' '))}`);
  pipelineLog('transcript_assembly', data.meeting_id ?? null, data.bot_id ?? null, {
    duration_ms: Date.now()-started, ...stats, sourceWordCount,
    finalWordCount: countWords(turns.map((t) => t.text).join(' ')), http_status: 200,
  });

  const reported = data.transcription_provider ?? doc?.provider;
  return { turns, text, registry, stats, sourceWordCount,
    provider: typeof reported === 'string' && STT_PROVIDERS.has(reported.toLowerCase()) ? reported.toLowerCase() : null,
    rawTranscription: rawProviderDoc ?? data.raw_transcription ?? doc ?? data.transcript ?? null,
    rawDiarization: typeof data.raw_diarization === 'string' ? data.raw_diarization : diarizationText,
    standardizedTranscription: doc ?? data.transcript ?? null,
    transcriptionArtifactText: transcriptionText,
  };
}

/** Separate append-only source snapshots from mutable processing/display rows. */
async function preserveTranscriptSource(admin: any, meetingId: string | null, body: Record<string, any>, assembled: AssemblyResult) {
  if (!meetingId) throw new Error('Cannot preserve a transcript without its meeting ID.');
  const source = {
    webhook_payload: body,
    standardized_transcription: assembled.standardizedTranscription,
    transcription_artifact_text: assembled.transcriptionArtifactText,
    provider_transcription: assembled.rawTranscription,
    diarization_artifact: assembled.rawDiarization,
  };
  const hash = await sha256(JSON.stringify(source));
  const { error } = await admin.from('meeting_transcript_sources').upsert({
    meeting_id: meetingId, content_hash: hash, provider: assembled.provider, payload: source,
  }, { onConflict: 'meeting_id,content_hash', ignoreDuplicates: true });
  if (error) throw new Error(`Raw transcript preservation failed (${error.code || 'database_error'}); apply the transcript provenance migration.`);
  return hash;
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

type LifecyclePatch = {
  provider_status: string;
  provider_status_at: string;
  bot_joining_started_at?: string;
  bot_joined_at?: string;
  last_human_left_at?: string;
  bot_departure_confirmed_at?: string;
};

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
 * from the platform's own lifecycle. Historical all_participants_left aliases
 * are accepted for stored/legacy events. Current v2 documents call_ended AFTER
 * departure, not a live participant-left webhook or a current-roster endpoint.
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
  return MEETING_ENDED_CODES.includes(c);
}

export function mapStatusChangeToStatus(
  body: Record<string, any>,
): { status: 'pending' | 'recording' | 'failed'; processing_stage: Stage; error_message?: string; ended_at?: string } & LifecyclePatch | null {
  const code = statusCodeFrom(body);
  if (!code) return null;

  const errorMessage = body?.data?.status?.error_message || body?.data?.error_message || body?.error_message || body?.data?.error || body?.error || null;
  const occurredAt = body?.data?.status?.created_at;
  const endedAt = typeof occurredAt === 'string' && Number.isFinite(Date.parse(occurredAt)) ? occurredAt : new Date().toISOString();
  const lifecycle: LifecyclePatch = { provider_status: code, provider_status_at: endedAt };

  const FAILED = [
    'waiting_room_timeout',
    'bot_rejected',
    'invalid_meeting_url',
    'meeting_error',
    'login_required',
    'cannot_join_meeting',
    'timeout_waiting_to_start',
    'recording_failed',
    'bot_removed_too_early',
    'failed',
  ];
  if (FAILED.includes(code)) {
    return {
      status: 'failed',
      processing_stage: 'processing_failed',
      error_message: errorMessage ? String(errorMessage) : `MeetingBaaS reported ${code}`,
      ended_at: endedAt,
      ...lifecycle,
    };
  }

  // Checked before the generic "recording..." branch below, because the
  // platform's end reason `recording_timeout` also contains "recording" and
  // must not be mistaken for a meeting that is still running.
  if (isMeetingEndedCode(code)) {
    return {
      status: 'recording', processing_stage: 'meeting_ended', ended_at: endedAt,
      ...lifecycle,
      ...(normalizeCode(code) === 'allparticipantsleft' ? { last_human_left_at: endedAt } : {}),
      bot_departure_confirmed_at: endedAt,
    };
  }

  if (['transcribing', 'recording_succeeded', 'completed'].includes(code)) {
    return { status: 'recording', processing_stage: 'transcript_processing', ...lifecycle };
  }
  if (['in_call_recording', 'recording_paused', 'recording_resumed', 'in_call'].includes(code)) {
    return { status: 'recording', processing_stage: 'meeting_in_progress', ...lifecycle,
      bot_joined_at: endedAt };
  }

  if (
    ['queued', 'pickup_delayed', 'joining_call', 'in_waiting_room', 'in_waiting_for_host', 'in_call_not_recording'].includes(code)
  ) {
    return { status: 'pending', processing_stage: 'bot_dispatched', ...lifecycle,
      ...(code === 'joining_call' || code === 'in_waiting_room' || code === 'in_waiting_for_host'
        ? { bot_joining_started_at: endedAt } : {}) };
  }

  return null;
}

// --------------------------------------------------------------------
// HTTP entrypoint
// --------------------------------------------------------------------

export async function handleMeetingBaasWebhook(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const t0 = Date.now();

  let body: Record<string, any> = {};
  const rawBody = await req.text();
  if (!await verifyMeetingBaasRequest(req, rawBody)) return json({ error: 'Invalid webhook signature or callback secret' }, 401);
  try {
    body = JSON.parse(rawBody);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid envelope');
  } catch {
    return json({ error: 'Payload must be valid JSON' }, 400);
  }

  const eventType = String(body?.event || body?.type || body?.event_type || '').toLowerCase();
  if (!['bot.completed', 'complete', 'bot.failed', 'failed', 'bot.status_change'].includes(eventType))
    return json({ success: true, ignored: 'unsupported event' }, 200);
  const data = body?.data ?? body;
  const botId = String(body?.bot_id || data?.bot_id || body?.bot?.id || body?.id || '').trim();
  if (body.bot_id && data.bot_id && body.bot_id !== data.bot_id) return json({ success: false, error: 'Conflicting bot IDs.' }, 409);

  console.log(`[Webhook] T+0ms event=${eventType} bot_id=${botId || '<none>'}`);

  if (!botId) {
    console.warn('[Webhook] payload missing bot_id — cannot correlate to a meeting');
    return json({ success: false, error: 'Missing bot_id.' }, 400);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://zddythsszyznsguiuiss.supabase.co';
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('[Webhook] Supabase service role is not configured — cannot persist.');
    return json({ success: false, error: 'Server not configured' }, 503);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('meetings')
    .select('id, status, summary, transcript, transcription_provider, processing_stage, ended_at, raw_payload, updated_at, recording_status, recording_metadata')
    .eq('bot_id', botId)
    .maybeSingle();
  // A very fast bot can callback before deploy-bot inserts its owned row. Retry
  // instead of inserting an ownerless meeting or acknowledging a lost update.
  if (lookupError || !existing) {
    pipelineLog('webhook_meeting_missing', null, botId, { http_status: 503, retry: true });
    return json({ success: false, error: 'Meeting lookup unavailable; retry delivery.' }, 503);
  }

  try {
    const isCompletion = eventType === 'bot.completed' || eventType === 'complete';
    const isFailure = eventType === 'bot.failed' || eventType === 'failed';

    if (isCompletion) {
      // Finalize video metadata independently, even on a late/duplicate
      // completion whose transcription and summary are already saved.
      if (existing.recording_status !== 'expired' &&
          (videoUrl(data) || data.artifacts_deleted || data.data_deleted || existing.recording_status !== 'ready')) {
        const patch = recordingPatch({ ...data, bot_id: botId }, 'completed');
        if (existing.recording_metadata?.artifact === patch.recording_metadata.artifact)
          patch.recording_metadata = { ...existing.recording_metadata, ...patch.recording_metadata };
        await saveRecording(supabaseAdmin, existing.id, botId, patch);
      }
      const alreadyHasContent =
        existing?.status === 'summarized' ||
        (existing?.status === 'completed' && existing.processing_stage === 'completed');
      if (alreadyHasContent) {
        return json({ success: true, event: eventType, bot_id: botId, duplicate: true, status: existing.status }, 200);
      }
      // Use the provider captured at dispatch; changing today's env must not
      // reroute an older recording. ElevenLabs consumes the recorded audio.
      const provider = data.extra?.revora?.transcription_provider || body.extra?.revora?.transcription_provider || existing.transcription_provider;
      if (provider === 'elevenlabs') {
        const queued = await queueElevenLabsTranscription(supabaseAdmin, existing, { ...data, bot_id: botId,
          raw_meetingbaas_payload: body,
          bot_name: data.bot_name ?? data.extra?.revora?.bot_name ?? body.extra?.revora?.bot_name,
          extra: data.extra ?? body.extra });
        return json({ success: true, transcription_provider: 'elevenlabs', ...queued }, 200);
      }
      return await handleCompletion(supabaseAdmin, body, data, botId, existing.id, existing.ended_at);
    }

    if (isFailure) {
      if (existing?.status === 'summarized' || (existing?.status === 'completed' && existing?.transcript) ||
          (existing.ended_at && existing.transcription_provider === 'elevenlabs' &&
            ['transcript_processing','transcript_ready','summary_processing'].includes(existing.processing_stage))) {
        return json({ success: true, event: eventType, bot_id: botId, duplicate: true }, 200);
      }
      const code = data?.error_code ? ` [${data.error_code}]` : '';
      const message =
        (data?.error_message || data?.message || data?.error || 'Bot failed to join or record the meeting.') + code;
      await updateMeetingByBotId(supabaseAdmin, botId, {
        status: 'failed',
        processing_stage: 'processing_failed',
        error_message: scrub(message),
        recording_status: existing.recording_status === 'expired' ? 'expired' : existing.recording_status === 'ready' ? 'ready' : 'failed',
        ended_at: new Date().toISOString(),
        raw_payload: meetingEventMetadata(body),
      });
      return json({ success: true, event: eventType, bot_id: botId, status: 'failed' }, 200);
    }

    // Auto-leave belongs to the provider, which has the live roster. v2 sends
    // call_ended AFTER departure. participants is historical attendance, not an
    // active count. Do not send speculative/duplicate stop commands here.
    const mapped = mapStatusChangeToStatus(body);
    // 5.3 — Ordering guard: a status_change must never move a meeting that is
    // already 'completed' or 'summarized' back to an earlier stage, and must not
    // overwrite its raw_payload. Failure events keep current behaviour (handled
    // above). This prevents out-of-order webhook deliveries from regressing a
    // finished meeting's status.
    const isFinished = ['completed', 'summarized', 'failed'].includes(existing.status);
    if (mapped && !isFinished) {
      const previousAt = Date.parse(existing.raw_payload?.data?.status?.created_at || '');
      const incomingAt = Date.parse(data?.status?.created_at || '');
      const activeStage = ['bot_dispatched', 'meeting_in_progress'].includes(mapped.processing_stage);
      const processing = ['transcript_processing', 'transcript_ready', 'summary_processing'].includes(existing.processing_stage);
      if ((Number.isFinite(previousAt) && Number.isFinite(incomingAt) && incomingAt <= previousAt) ||
          (activeStage && (existing.ended_at || processing)) ||
          (mapped.status === 'failed' && existing.ended_at && processing && existing.transcription_provider === 'elevenlabs') ||
          (mapped.processing_stage === 'bot_dispatched' && existing.status === 'recording'))
        return json({ success: true, ignored: 'stale status event' }, 200);
      if (mapped.processing_stage === 'meeting_ended') {
        const endedCode = statusCodeFrom(body);
        console.log(
          `[MeetingBaaS] Bot left the meeting (reason=${endedCode || 'unknown'}) bot_id=${botId}` +
            (endedCode === 'all_participants_left' ? ' - no human participants remained.' : '')
        );
      }
      // CAS prevents a delayed status request from overwriting a concurrent
      // completion. A retry will see the newer row and apply the ordering guard.
      const videoState = recordingPatch({ ...data, bot_id: botId });
      let query = supabaseAdmin.from('meetings').update({ ...mapped,
        ...(!['ready', 'expired'].includes(existing.recording_status) ? { recording_status: videoState.recording_status } : {}), raw_payload: meetingEventMetadata(body) })
        .eq('bot_id', botId).in('status', ['pending', 'recording']);
      if (existing.updated_at) query = query.eq('updated_at', existing.updated_at);
      const saved = await query.select('id').maybeSingle();
      if (saved.error || !saved.data) return json({ success: false, error: 'Status update superseded or unavailable; retry.' }, 503);
      console.log(`[Webhook] T+${Date.now() - t0}ms DB updated (status=${mapped.status}, stage=${mapped.processing_stage})`);
      return json({ success: true, event: eventType, bot_id: botId, status: mapped.status, stage: mapped.processing_stage }, 200);
    }
    if (mapped && isFinished) {
      console.log(`[Webhook] Ignoring status_change (${mapped.status}/${mapped.processing_stage}) — meeting already ${existing.status}.`);
    }
    return json({ success: true, event: eventType, bot_id: botId, status: existing?.status ?? 'unchanged' }, 200);
  } catch {
    pipelineLog('webhook_failed', existing.id, botId, { duration_ms: Date.now()-t0, http_status: 503 });
    const failed = await supabaseAdmin.from('meetings').update({ processing_stage: 'processing_failed',
      error_message: 'Meeting processing failed; retry delivery or reprocess the archived result.' })
      .eq('id', existing.id).eq('bot_id', botId).neq('status', 'summarized');
    if (failed.error) pipelineLog('failure_state_save_failed', existing.id, botId, { http_status: 503 });
    return json({ success: false, error: 'Processing error; retry delivery.' }, 503);
  }
}

async function updateMeetingByBotId(
  supabaseAdmin: any,
  botId: string,
  patch: Record<string, any>,
): Promise<any | null> {
  const { data: saved, error } = await supabaseAdmin.from('meetings').update(patch).eq('bot_id', botId).select().maybeSingle();
  if (!saved) pipelineLog('meeting_update_missing', null, botId, { http_status: 503 });
  if (error || !saved) throw new Error(`Meeting persistence failed (${error?.code || 'no_row'}).`);
  return saved ?? null;
}

// --------------------------------------------------------------------
// bot.completed — assemble, preserve raw, persist, summarise
// --------------------------------------------------------------------

/** The meeting's own date, used as "today" for spoken deadlines. */
function meetingDateISO(data: Record<string, any>): string {
  const raw = data?.joined_at ?? data?.created_at ?? data?.started_at ?? null;
  const d = raw ? new Date(raw) : new Date();
  return (Number.isNaN(d.getTime()) ? new Date() : d).toISOString().slice(0, 10);
}

export async function handleCompletion(
  supabaseAdmin: any,
  body: Record<string, any>,
  data: Record<string, any>,
  botId: string,
  knownMeetingId: string | null,
  knownEndedAt?: string | null,
  reprocess = false,
): Promise<Response> {
  if (!knownMeetingId || (data.bot_id && data.bot_id !== botId)) throw new Error('Meeting/bot mismatch.');
  const token = crypto.randomUUID();
  const claim = await supabaseAdmin.rpc('claim_meeting_transcript', {
    p_meeting_id: knownMeetingId, p_bot_id: botId, p_token: token, p_reprocess: reprocess,
  });
  if (claim.error) {
    pipelineLog('transcript_lease_failed', knownMeetingId, botId, { http_status: 503, database_code: claim.error.code });
    throw new Error('Transcript lease unavailable; apply the pipeline integrity migration.');
  }
  if (claim.data !== 'claimed') return json({ success: true, duplicate: true, status: claim.data }, claim.data === 'processing' ? 202 : 200);
  try {
    return await runCompletion(supabaseAdmin, body, { ...data, bot_id: botId, meeting_id: knownMeetingId }, botId, knownMeetingId, token, knownEndedAt);
  } catch (error) {
    const failed = await supabaseAdmin.from('meetings').update({ processing_stage: 'processing_failed',
      error_message: 'Transcript/analysis processing failed. The archived source can be reprocessed.' })
      .eq('id', knownMeetingId).eq('bot_id', botId).eq('transcript_processing_token', token);
    if (failed.error) pipelineLog('failure_state_save_failed', knownMeetingId, botId, { http_status: 503 });
    throw error;
  } finally {
    const released = await supabaseAdmin.from('meetings').update({ transcript_processing_token: null, transcript_processing_at: null })
      .eq('id', knownMeetingId).eq('bot_id', botId).eq('transcript_processing_token', token);
    if (released.error) pipelineLog('transcript_lease_release_failed', knownMeetingId, botId, { http_status: 503 });
  }
}

async function runCompletion(supabaseAdmin: any, body: Record<string, any>, data: Record<string, any>,
  botId: string, knownMeetingId: string, token: string, knownEndedAt?: string | null): Promise<Response> {
  console.log(`[Transcript Pipeline] MeetingBaaS meeting/bot id: ${botId}`);

  const validDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  const endedAt = validDate(data.exited_at) || knownEndedAt || new Date().toISOString();
  const joinedAt = validDate(data.joined_at);
  console.log(`[Transcript Pipeline] transcription artifact available: ${data?.transcription ? 'yes' : 'no'}`);
  console.log(`[Transcript Pipeline] diarization artifact available: ${data?.diarization ? 'yes' : 'no'}`);

  const rawDuration = data?.duration_seconds ?? data?.duration ?? null;
  const durationSecs = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? Math.round(rawDuration) : null;

  await updateMeetingByBotId(supabaseAdmin, botId, {
    status: 'recording',
    processing_stage: 'transcript_processing',
    raw_payload: meetingEventMetadata(data.raw_meetingbaas_payload ?? body),
  });

  const assembled = await assembleTranscript({ ...data,
    bot_name: data.bot_name ?? body.extra?.revora?.bot_name ?? data.extra?.revora?.bot_name ?? Deno.env.get('BOT_NAME') });
  const sourceHash = await preserveTranscriptSource(supabaseAdmin, knownMeetingId, data.raw_meetingbaas_payload ?? body, assembled);
  const meetingISO = meetingDateISO(data);

  const transcriptMetrics = { ...assembled.stats, sourceWordCount: assembled.sourceWordCount,
    finalWordCount: countWords(assembled.turns.map((t) => t.text).join(' ')),
    ...(data.transcription_model ? { model: data.transcription_model } : {}) };
  const persisted = await supabaseAdmin.rpc('persist_meeting_transcript', {
    p_meeting_id: knownMeetingId, p_bot_id: botId, p_token: token, p_turns: assembled.turns,
    p_patch: { transcription_provider: assembled.provider, transcript_metrics: transcriptMetrics,
      duration_secs: durationSecs, ended_at: endedAt, ...(joinedAt ? { started_at: joinedAt } : {}),
      transcript_source_metadata: { provider: assembled.provider, model: data.transcription_model ?? null,
        normalization_version: 3, source_hash: sourceHash, speaker_mapping: 'whole_cluster_timeline_evidence',
        source_utterance_count: assembled.stats.sourceUtteranceCount ?? 0,
        duplicate_utterances_removed: assembled.stats.duplicateUtterancesRemoved ?? 0, partial_events_persisted: 0 } },
  });
  if (persisted.error || persisted.data !== knownMeetingId) {
    pipelineLog('transcript_persistence_failed', knownMeetingId, botId, { http_status: 503, database_code: persisted.error?.code });
    throw new Error('Atomic transcript persistence failed.');
  }
  const meetingId = knownMeetingId;

  // No speech / no transcript: finish honestly. Never fabricate content.
  if (assembled.turns.length === 0) {
    console.warn('[Transcript Pipeline] MeetingBaaS returned no transcript content — nothing to summarise.');
    const meeting = await updateMeetingByBotId(supabaseAdmin, botId, {
      status: 'completed',
      processing_stage: 'completed',
      duration_secs: durationSecs,
      ended_at: endedAt,
      ...(joinedAt ? { started_at: joinedAt } : {}),
      error_message: 'Meeting ended, but no transcript content was produced (no speech detected or transcription unavailable).',
      raw_payload: meetingEventMetadata(data.raw_meetingbaas_payload ?? body),
    });
    return json(
      { success: true, event: 'bot.completed', bot_id: botId, status: 'completed', transcript: false, meeting_id: meeting?.id ?? knownMeetingId },
      200,
    );
  }

  await updateMeetingByBotId(supabaseAdmin, botId, { processing_stage: 'summary_processing' });
  const openTasks = await loadCarryoverTasks(supabaseAdmin, meetingId);
  const analysisStarted = Date.now();
  const analysis = await analyzeTranscript(assembled.text, assembled.registry.names, meetingISO, openTasks);
  pipelineLog('gemini_analysis', meetingId, botId, { duration_ms: Date.now()-analysisStarted,
    http_status: analysis ? 200 : 503, action_items: analysis?.action_items.length ?? 0 });

  if (!analysis) {
    console.warn('[Transcript Pipeline] summarisation failed — complete transcript remains saved and visible.');
    await updateMeetingByBotId(supabaseAdmin, botId, {
      status: 'completed',
      processing_stage: 'processing_failed',
      error_message: 'Transcript captured, but AI summarization failed (transcript preserved).',
    });
    return json(
      { success: false, event: 'bot.completed', bot_id: botId, status: 'processing_failed', summarized: false, meeting_id: meetingId },
      503,
    );
  }

  console.log(`[Transcript Pipeline] action items extracted: ${analysis.action_items.length}`);

  // Publish the final state only after dependent rows are persisted. A failed
  // write remains retryable from the saved ElevenLabs result.
  if (meetingId) await persistAnalysis(supabaseAdmin, meetingId, analysis);
  const meeting = await updateMeetingByBotId(supabaseAdmin, botId, {
    status: 'summarized',
    processing_stage: 'completed',
    summary: analysis.executive_summary,
    action_items: analysis.action_items,
    error_message: null,
  });

  const finalId = meeting?.id ?? meetingId;
  if (finalId) queueContextIndex(supabaseAdmin, finalId);

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

async function persistAnalysis(supabaseAdmin: any, meetingId: string, analysis: AIAnalysis): Promise<void> {
  // 5.4 — Idempotency: delete existing summaries before inserting, mirroring
  // the pattern already used for action_items. Prevents duplicate rows on
  // bot.completed re-delivery.
  const { error: delSummaryError } = await supabaseAdmin.from('summaries').delete().eq('meeting_id', meetingId);
  if (delSummaryError) throw new Error(`Summary replacement failed (${delSummaryError.code || 'database_error'}).`);

  const summaryRow = {
    meeting_id: meetingId,
    executive_summary: analysis.executive_summary,
    key_decisions: analysis.key_decisions,
    sentiment: analysis.sentiment,
  };
  let { error: summaryError } = await supabaseAdmin.from('summaries').insert({ ...summaryRow,
    key_topics: analysis.key_topics, open_questions: analysis.open_questions });
  if (missingSchema(summaryError)) {
    ({ error: summaryError } = await supabaseAdmin.from('summaries').insert(summaryRow));
  }
  if (summaryError) throw new Error(`Summary persistence failed (${summaryError.code || 'database_error'}).`);

  // Keep the existing context task behavior, while surfacing its logged-and-
  // swallowed RPC failures to this pipeline instead of publishing silent success.
  let taskPersistenceError: unknown = null;
  const taskAdmin = {
    from: (table: string) => supabaseAdmin.from(table),
    rpc: async (name: string, args: unknown) => {
      try {
        const result = await supabaseAdmin.rpc(name, args);
        taskPersistenceError = result.error;
        return result;
      } catch (error) { taskPersistenceError = error; throw error; }
    },
  };
  const contextHandled = await persistContextTasks(taskAdmin, meetingId, analysis.action_items, analysis.task_updates);
  if (contextHandled && taskPersistenceError) throw new Error('Action item persistence failed; existing context tasks were retained.');
  if (contextHandled) return;

  const rows = analysis.action_items.map((a) => ({
    meeting_id: meetingId,
    task: a.task,
    assignee: a.assignee,
    due_day: a.due_day,
    due_date: a.due_date,
    status: a.status,
  }));

  const { error: delError } = await supabaseAdmin.from('action_items').delete().eq('meeting_id', meetingId);
  if (delError) throw new Error('Action item replacement failed.');
  if (!rows.length) return;

  let { error } = await supabaseAdmin.from('action_items').insert(rows);
  if (error && (error.code === '42703' || /column .* does not exist/i.test(error.message ?? ''))) {
    console.warn('[Webhook] action_items.due_day missing — retrying without it. Apply migration 0004.');
    ({ error } = await supabaseAdmin.from('action_items').insert(rows.map(({ due_day: _d, ...r }) => r)));
  }
  if (error) throw new Error('Action item persistence failed.');
  else console.log(`[Transcript Pipeline] Supabase save: summary + ${rows.length} action item(s) persisted.`);
}
