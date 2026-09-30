-- ====================================================================
-- REVORA — 0005: transcription provider observability
--
-- Additive only. Does not touch RLS, existing columns, or the
-- meetings.status CHECK constraint.
--
--   meetings.transcription_provider  text  — which STT provider was
--       configured when this meeting's bot was deployed (e.g. gladia,
--       deepgram, assemblyai). Written by the webhook at transcript_ready.
--   meetings.transcript_metrics      jsonb — pipeline statistics from
--       assembleTranscript: word counts, diarization overrides, contested
--       sentences, Gemini corrections, source vs final word count.
--       Enables provider bake-off comparisons without re-running meetings.
-- ====================================================================

alter table public.meetings
  add column if not exists transcription_provider text;

alter table public.meetings
  add column if not exists transcript_metrics jsonb;

comment on column public.meetings.transcription_provider is
  'STT provider configured at bot deploy time (gladia, deepgram, assemblyai, speechmatics, soniox).';
comment on column public.meetings.transcript_metrics is
  'Pipeline stats from assembleTranscript: {utterancesWithoutWordTimings, diarizationOverrodeUtteranceSpeaker, wordsWithNoResolvableSpeaker, totalWords, sentenceCount, contestedSentences, turnsAfterMerge, geminiCorrectionsApplied, sourceWordCount, finalWordCount}.';
