import { ContextError, estimateTokens } from './context-utils.ts';

export const CHUNKER_VERSION = 1;
export const MAX_CHARS = 2000;
export const MAX_CHUNKS = 400;
export interface Turn {
  speaker: string; text: string; segment_index: number;
  start_time: number | null; end_time: number | null;
}
export interface Chunk {
  chunk_index: number; text: string; speakers: string[];
  first_segment_index: number; last_segment_index: number;
  start_time: number | null; end_time: number | null;
  token_estimate: number; chunker_version: number;
}
const seconds = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

export function transcriptTurns(segments: unknown, transcript: unknown): Turn[] {
  if (Array.isArray(segments) && segments.length) {
    return segments.map((s, i) => ({
      speaker: typeof s?.speaker === 'string' ? s.speaker.trim() : 'Speaker',
      text: typeof s?.text === 'string' ? s.text.trim() : '', segment_index: i,
      start_time: seconds(s?.start_time), end_time: seconds(s?.end_time),
    })).filter((s) => s.text);
  }
  return String(transcript ?? '').split(/\r?\n/).map((line, i) => {
    const match = line.match(/^([^:]{1,120}):\s*(.*)$/);
    return { speaker: match?.[1] || 'Speaker', text: (match?.[2] ?? line).trim(),
      segment_index: i, start_time: null, end_time: null };
  }).filter((s) => s.text);
}

function splitOversizedTurn(turn: Turn): Turn[] {
  // Speaker labels are metadata too; pathological labels must not defeat the cap.
  const speaker = turn.speaker.slice(0, 120);
  const capacity = MAX_CHARS - speaker.length - 2;
  if (turn.text.length <= capacity) return [{ ...turn, speaker }];
  const sentences = turn.text.match(/[^.!?]+(?:[.!?]+|$)|[.!?]+/g) || [turn.text];
  const parts: string[] = [];
  let part = '';
  const flush = () => { if (part.trim()) parts.push(part.trim()); part = ''; };
  for (const sentence of sentences) {
    let remaining = sentence.trim();
    if (remaining.length <= capacity && part.length + remaining.length + 1 > capacity) flush();
    while (remaining) {
      const room = capacity - part.length - (part ? 1 : 0);
      if (remaining.length <= room) { part += (part ? ' ' : '') + remaining; break; }
      if (room < 40) { flush(); continue; }
      // Fill any short sentence prefix before splitting a giant sentence, so
      // that prefix does not become a discarded <40-character chunk.
      let at = remaining.lastIndexOf(' ', room);
      if (at < room / 2) at = room;
      part += (part ? ' ' : '') + remaining.slice(0, at).trim();
      flush(); remaining = remaining.slice(at).trim();
    }
  }
  flush();
  // Original segment index/time interval is retained, not fabricated sub-timings.
  return parts.map((text) => ({ ...turn, speaker, text }));
}

export function chunkTranscript(turns: Turn[]): Chunk[] {
  const units = turns.flatMap(splitOversizedTurn);
  const chunks: Chunk[] = [];
  let start = 0;
  while (start < units.length) {
    let end = start;
    let text = '';
    while (end < units.length) {
      const line = `${units[end].speaker}: ${units[end].text}`;
      if (text && text.length + 1 + line.length > MAX_CHARS) break;
      text += (text ? '\n' : '') + line;
      end++;
    }
    const group = units.slice(start, end);
    if (text.length >= 40) {
      if (chunks.length >= MAX_CHUNKS) throw new ContextError('Transcript exceeds the 400-chunk limit; indexing stopped without replacing the existing index.', 422);
      const starts = group.map((t) => t.start_time).filter((n): n is number => n !== null);
      const ends = group.map((t) => t.end_time).filter((n): n is number => n !== null);
      chunks.push({ chunk_index: chunks.length, text, speakers: [...new Set(group.map((t) => t.speaker))],
        first_segment_index: group[0].segment_index, last_segment_index: group[group.length - 1].segment_index,
        start_time: starts.length ? Math.min(...starts) : null, end_time: ends.length ? Math.max(...ends) : null,
        token_estimate: estimateTokens(text), chunker_version: CHUNKER_VERSION });
    }
    if (end === units.length) break;
    // One-turn overlap when it fits WITH new content; always make progress.
    const overlap = end - 1;
    const combined = `${units[overlap].speaker}: ${units[overlap].text}\n${units[end].speaker}: ${units[end].text}`;
    start = overlap > start && combined.length <= MAX_CHARS ? overlap : end;
  }
  return chunks;
}
