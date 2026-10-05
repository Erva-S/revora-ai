# Transcript quality: deterministic source → turns → display

## Provider decision and diagnosis

The repository defaults to direct asynchronous **ElevenLabs Scribe v2**
(`scribe_v2`) after MeetingBaaS records the call. Provider selection has not
changed during the segmentation/recording fixes. Previously deployed meetings
retain their original dispatch-time provider; a local `.env` does not change
hosted Edge secrets or existing bots.

MeetingBaaS-managed batch alternatives are Gladia, Deepgram, AssemblyAI,
Speechmatics, and Soniox. Its managed ElevenLabs option is streaming-only and
requires a WebSocket receiver. Scribe already supplies acoustic speaker IDs
and word timestamps; changing providers would not fix dropping those IDs in
our backend. No real-audio bake-off establishes a superior provider for noisy
audio, overlap recovery, or timestamp accuracy, so no unsupported accuracy
ranking or provider switch is made.

The inspected backend previously ignored word-level speaker IDs, discarded
Scribe acoustic IDs in its adapter, synthesized acoustic-ID aliases from roster
participant numbers, and could rename a Scribe cluster word by word from a
coarse named timeline. Repeated provider fragments were not deduplicated. An
old longer-transcript guard could also keep text inconsistent with new turns.
The optional Gemini attribution pass has been removed completely.

The dashboards previously printed stored text; they did not create these
backend boundary problems. The supplied faulty transcript lacks its original
audio/provider artifact, so its exact upstream fault cannot be proven from
text alone. Metadata-grounded fixtures reproduce the inspected backend issues.

## Speaker mapping and boundaries

- Named standardized provider identities are authoritative.
- Word-level speaker IDs precede the enclosing utterance identity. A speaker-ID
  change always splits a turn; punctuation never decides who spoke.
- Provider utterance boundaries and timing gaps drive segmentation.
- Adjacent turns merge only if speaker and source identity agree, times do not
  overlap, the gap is at most two seconds, and neither turn is contested.
- Acoustic `speaker_0` is never participant ID `0`. Missing names keep stable
  numbered labels rather than guessing from dialogue, roster order, or task roles.
- A Scribe cluster needs ≥0.5 seconds of named timeline evidence, ≥90% name
  agreement, and ≥70% timed-word coverage to receive a participant name. Each
  timeline vote needs ≥80% interval coverage by exactly one named speaker.
- Overlap supplies no ambiguous naming vote; known source identities remain
  separate and overlapping turns are flagged. Conflicting/missing mappings
  remain `Speaker 1`, `Speaker 2`, etc.
- Original spoken words, grammar, timestamps, source IDs/indices, confidence,
  and raw provider metadata are preserved. Production code has no hardcoded
  fixture participant names.

## Partials and deduplication

The current pipeline is batch-only; it does not have a live WebSocket receiver.
For explicitly supplied `transcript.segment` snapshots, normalization emits
finals only, supersedes same-speaker partials, and retains simultaneous finals
from different speakers. No permanent partial event is appended to storage.

Deduplication requires a speaker-scoped source utterance ID, identical
speaker/time/text redelivery, or exact same-speaker timed word fragments.
Repeated phrases at other times or from another speaker remain. Similar text
without timing evidence is not enough to delete speech. Raw input is not mutated.

## Storage and recovery

Apply `supabase/migrations/20261005010000_transcript_provenance.sql`:

- **Raw:** `meeting_transcription_jobs.result` stores the original Scribe result.
  `meeting_transcript_sources` archives webhook envelopes, standardized/raw
  transcription, exact downloaded artifact text, and diarization. Snapshots are
  hash-deduplicated, service-only, and cannot be updated, including by service role.
- **Current source:** `meetings.raw_transcription`, `raw_diarization`, and the
  original MeetingBaaS `raw_payload`; historical versions stay archived.
- **Normalized:** `meetings.transcript_segments` stores speaker turns, original
  word metadata, overlap flags, and mapping evidence. `transcript_source_metadata`
  records normalization version 2, the source hash, provider/model, and metrics.
- **Display:** `meetings.transcript` and ordered `transcripts` rows are projections
  of those turns. Both dashboards render each structured turn as a paragraph,
  with legacy text fallback and no frontend speaker remapping.
- **Downstream:** Gemini performs summary/decision/action-item analysis only.
  Its response cannot alter transcript text or identity; context indexing uses
  the saved deterministic turns.

Admins/service callers can regenerate a completed ElevenLabs meeting:

```js
await supabase.functions.invoke('process-elevenlabs-transcription', {
  body: { meeting_id: '<meeting UUID>', reprocess: true },
});
```

This uses the saved result, preserves raw snapshots, refreshes downstream
analysis/context, and does not submit another STT job. Redeploy the provider
webhooks and processing function to include the updated shared pipeline.

## BEFORE / AFTER

Fixture source words provide Alice → Bob → Alice IDs and timestamps inside
one incorrectly combined utterance:

```text
BEFORE
Alice: Are you ready Yes Lets start

AFTER
Alice: Are you ready

Bob: Yes

Alice: Lets start
```

The words/punctuation are identical; Bob no longer inherits Alice's enclosing
utterance label. The weekly-update regression converts nine source utterances
to seven display turns: adjacent Piyu updates merge, `Thanks.` remains separate
after its time gap, and `No.` does not merge into Erva's next question. All 74
source words survive. `There was a few issues` stays verbatim, not `There were`.

## Verification and limits

`transcript-quality.test.ts` covers the ten requested patterns (two speakers,
rapid alternation, multi-sentence speech, short replies, interruptions, three
speakers, partial/final snapshots, overlap, long speech, joins/rejoins) plus
weekly-update conservation, deduplication, stable/conflicting cluster mapping,
raw immutability, and summary-only Gemini. PostgreSQL/PGlite checks cover raw
archive permissions/idempotence; frontend checks cover paragraph/legacy rendering.
The recording report documents the complete regression run.

Missing provider words, speaker changes, or timestamps cannot be reconstructed
deterministically. Mixed-audio overlap does not guarantee separated voices.
Conservative name mapping can leave short/poorly observed speakers anonymous.
Previously unsaved/expired artifacts cannot be recovered by a migration.
Hosted deployment and new-meeting audio accuracy remain separate live checks.

References: [MeetingBaaS transcription](https://docs.meetingbaas.com/api-v2/transcription),
[artifacts](https://docs.meetingbaas.com/api-v2/artifacts),
[Scribe API](https://elevenlabs.io/docs/api-reference/speech-to-text/convert).
