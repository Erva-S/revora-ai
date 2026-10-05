import assert from 'node:assert/strict';
import { assembleTranscript, mapStatusChangeToStatus } from '../functions/meetingbaas-webhook/index.ts';

const utterance = (speaker: string, text: string, start: number, step = 0.2) => {
  const tokens = text.split(' ');
  return { speaker, text, start, end: start + step * tokens.length,
    words: tokens.map((word, i) => ({ word, start: start + step * i, end: start + step * (i + 1), confidence: 0.97 })) };
};
const input = (utterances: any[], speakers: string[] = ['Alice', 'Bob', 'Chloé']) => ({
  speakers, transcription: { provider: 'gladia', result: { utterances } },
});

Deno.test('two speakers: a short unpunctuated reply keeps its identity and word timing', async () => {
  const a = utterance('Alice', 'Can we ship', 0);
  const b = utterance('Bob', 'yes tomorrow', 0.7);
  const result = await assembleTranscript(input([a, b]));
  assert.deepEqual(result.turns.map((t) => [t.speaker, t.text]), [['Alice', a.text], ['Bob', b.text]]);
  assert.equal(result.turns[1].start_time, b.start);
  assert.equal(result.turns[1].words?.[0].start, b.words[0].start);
  assert.equal(result.provider, 'gladia');
});

Deno.test('3+ simultaneous speakers: overlapping words never interleave or majority-vote identities', async () => {
  const turns = [utterance('Alice', 'Revora ships on Friday.', 0), utterance('Bob', 'Supabase needs review.', 0.1),
    utterance('Chloé', 'I will test OAuth.', 0.2)];
  const result = await assembleTranscript({ ...input(turns),
    diarization: turns.map((u) => JSON.stringify({ speaker: u.speaker, start_time: 0, end_time: 4 })).join('\n') });
  assert.deepEqual(result.turns.map((t) => [t.speaker, t.text]), turns.map((t) => [t.speaker, t.text]));
  assert.ok(result.turns.every((t) => t.contested && t.speaker_source === 'provider'));
  assert.equal(result.sourceWordCount, result.turns.reduce((n, t) => n + t.text.split(' ').length, 0));
});

Deno.test('standardized attribution wins over conflicting coarse diarization and Unicode names survive', async () => {
  const result = await assembleTranscript({ ...input([utterance('દેવ', 'OAuth uses PKCE.', 0)], ['દેવ', 'Zoë']),
    diarization: JSON.stringify({ speaker: 'Zoë', start_time: 0, end_time: 10 }) });
  assert.equal(result.turns[0].speaker, 'દેવ');
  assert.equal(result.turns[0].text, 'OAuth uses PKCE.');
  assert.equal(result.stats.diarizationOverrodeUtteranceSpeaker, 0);
});

Deno.test('unresolved identity uses only unambiguous contemporaneous diarization', async () => {
  const unknown = utterance('unknown', 'A useful technical discussion.', 1);
  const spans = [{ speaker: 'Alice', start_time: 0, end_time: 10 }, { speaker: 'Bob', start_time: 0, end_time: 10 }];
  const ambiguous = await assembleTranscript({ ...input([unknown]), diarization: spans.map((s) => JSON.stringify(s)).join('\n') });
  assert.equal(ambiguous.turns[0].speaker, 'Unidentified Speaker');
  const single = await assembleTranscript({ ...input([unknown]), diarization: JSON.stringify(spans[1]) });
  assert.equal(single.turns[0].speaker, 'Bob');
  assert.equal(single.turns[0].speaker_source, 'diarization');
});

Deno.test('short/partial word-list transcript keeps every name and does not invent timings', async () => {
  const result = await assembleTranscript(input([{ speaker: 'Alice', text: 'Chloé will verify PostgreSQL and Revora.',
    words: [{ word: 'Chloé', start: 1, end: 2 }] }]));
  assert.equal(result.turns[0].text, 'Chloé will verify PostgreSQL and Revora.');
  assert.equal(result.turns[0].start_time, null);
  assert.equal(result.turns[0].end_time, null);
  assert.equal(result.turns[0].words, undefined);
});

Deno.test('missing roster uses standardized names, but raw provider chunks are never displayed', async () => {
  const result = await assembleTranscript(input([utterance('Mary-Jane', 'Check the SDK.', 1)], []));
  assert.equal(result.turns[0].speaker, 'Mary-Jane');
  const raw = await assembleTranscript({ raw_transcription: { utterances: [utterance('0', 'Misaligned chunk.', 0)] } });
  assert.deepEqual(raw.turns, []);
});

Deno.test('three-hour meeting retains all 1080 alternating utterances and final timestamps', async () => {
  const turns = Array.from({ length: 1080 }, (_, i) => utterance(['Alice', 'Bob', 'Chloé'][i % 3], `Milestone ${i} uses Kubernetes.`, i * 10));
  const result = await assembleTranscript(input(turns));
  assert.equal(result.turns.length, turns.length);
  assert.deepEqual(result.turns.map((t) => t.text), turns.map((t) => t.text));
  assert.equal(result.turns.at(-1)?.end_time, turns.at(-1)?.end);
});

Deno.test('artifact outage is retryable instead of being mistaken for a silent meeting', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('', { status: 403 });
    await assert.rejects(assembleTranscript({ transcription: 'https://artifacts.example.test/transcript.json' }), /unavailable/);
    globalThis.fetch = async () => Response.json({ error: 'not a transcription' });
    await assert.rejects(assembleTranscript({ transcription: 'https://artifacts.example.test/transcript.json' }), /structure/);
  } finally { globalThis.fetch = original; }
});

Deno.test('lifecycle mappings distinguish recording initialization/failure from post-call processing', () => {
  const map = (code: string) => mapStatusChangeToStatus({ data: { status: { code, created_at: '2026-10-04T10:00:00Z' } } });
  assert.equal(map('in_call_not_recording')?.processing_stage, 'bot_dispatched');
  assert.equal(map('in_call_recording')?.processing_stage, 'meeting_in_progress');
  assert.equal(map('recording_failed')?.status, 'failed');
  assert.equal(map('transcribing')?.processing_stage, 'transcript_processing');
  assert.equal(map('recording_succeeded')?.processing_stage, 'transcript_processing');
  assert.equal(map('call_ended')?.ended_at, '2026-10-04T10:00:00Z');
  assert.equal(map('participant_left'), null);
});
