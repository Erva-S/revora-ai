# Transcription and recording repair — 2026-10-08

This report supersedes the implementation descriptions in the older pipeline documents. Their hosted observations are historical claims, not live evidence from this run.

## Phase 0 reconciliation

All named files exist in this checkout:

- `RECORDING_PIPELINE.md`, `ELEVENLABS_TRANSCRIPTION.md`, `TRANSCRIPT_QUALITY.md`, `CONTEXT_MANAGEMENT.md`, `.env.example`.
- `supabase/functions/{get-meeting-recording,download-meeting-recording,elevenlabs-webhook,process-elevenlabs-transcription}/index.ts`.
- `supabase/functions/_shared/`, including the existing MeetingBaaS, ElevenLabs, recording and pipeline helpers.
- `supabase/migrations/{20261003000000_context_management,20261005000000_elevenlabs_transcription,20261005010000_transcript_provenance,20261005020000_recording_access}.sql`.
- `supabase/tests/`, `src/components/MeetingRecordingLink.jsx`, `src/lib/recordingAccess.js`.

The existing implementations were repaired in place. T1's asynchronous Scribe architecture already exists; no second bot, STT system or extra AI pass was added.

## Phase 1 audit: static evidence and hosted limitations

1. **Actual provider:** `meetingbaas.ts` accepts `elevenlabs`, defaults to it, and disables MeetingBaaS transcription for that path. `elevenlabs.ts` submits `source_url`, `diarize=true`, word timestamps and asynchronous `webhook=true` directly to Scribe. The described fallback-to-Gladia code is absent. The provider that produced the screenshot is **UNCONFIRMED**: hosted `meetings.transcription_provider`, `raw_payload` and deploy/webhook logs were inaccessible.
2. **Batch pipeline:** MeetingBaaS completion saves recording metadata first. Scribe mode queues one service-only job; its signed completion is durably saved, then processed via `elevenLabsTranscription` → `extractUtterances` → exact deduplication → `flattenWords` → `buildSentences` → `mergeTurns` → `turnsToText` → source archive → atomic transcript persistence → `analyzeTranscript` → `persistAnalysis`. Other configured batch providers use MeetingBaaS transcription/diarization artifact fetching before the same assembly. **Interim/final handling: not applicable.** There is no live transcript route. The existing offline snapshot compatibility helper is not a streaming service.
3. **Stats:** existing assembly logs include `diarizationOverrodeUtteranceSpeaker`, `contestedSentences`, `wordsWithNoResolvableSpeaker`, and source/final word counts. Structured logs now retain those exact names, IDs, durations, deduplication counts and HTTP statuses. These are local/mock evidence only; no hosted numeric stats were available. Source word conservation is measured after exact redeliveries are removed.
4. **Recordings/UI:** existing code already prefers `video`/`mp4`, refreshes by bot details, performs byte-range GET probes, and streams downloads. Both dashboard components already use `MeetingRecordingLink`. Both still select meetings with `*` and subscribe to realtime. Transcript display prefers `transcript_segments` and falls back to `meetings.transcript`; it does not read the child `transcripts` table. This differs from the inspected ZIP.
5. **Schema/config:** the four documented migrations already define jobs, raw-source archives, context ordering aliases and recording metadata. Base schema makes `bot_id` unique; ownership/admin RLS is defined in existing migrations. `config.toml` lists eight functions, including the six relevant pipeline functions. Hosted schema/policies/deployment versions are unverified.
6. **Race:** the main webhook already refused a missing meeting with 503. A secondary update fallback still inserted ownerless rows; deploy-bot inserted separately and logged persistence failures before returning success. The unique index prevents two rows with the same bot ID, but the old pattern could leave a single ownerless row. That fallback was removed; dispatch now upserts its ownership fields on `bot_id`, preserving webhook transcript/recording/status fields, and reports failed persistence explicitly.
7. **Silent failures:** action-item cleanup/insertion and context-task RPC errors could be logged while publishing summarized success. The pipeline now surfaces those errors without modifying the context implementation. Gemini failure keeps the saved transcript, records `processing_failed`, and returns a retryable failure. A completed row with unfinished downstream work no longer triggers the old duplicate shortcut.

`supabase functions list` and `supabase migration list` were attempted. The installed Windows CLI initially lacked a Linux binary. A temporary Linux CLI then reported missing Supabase login/access token and missing project linkage. No hosted database rows, provider logs, authenticated recording probes, function inventory or migration history were read. All conclusions above are static analysis plus local tests.

## Phase 2: screenshot root causes

| Problem/candidate | Finding in this checkout before repair |
| --- | --- |
| Words/sentences cross speaker identities | **CONFIRMED risk:** unresolved non-Scribe identities were renamed per word from the coarse timeline. The Scribe path already mapped clusters, but accepted as little as 0.5 seconds of evidence. Historical override of known STT labels in the screenshot is **UNCONFIRMED**. |
| Pause and punctuation segmentation | **CONFIRMED:** 4-second/45-word assembly cuts and Scribe's 2-second gap cuts could divide one speaker's utterance. The exact 1.2-second/punctuation rule described in the prompt is absent and its role in the screenshot is **UNCONFIRMED**. |
| Global start-time word sorting interleaves overlap | **UNCONFIRMED/currently absent:** words already remained within provider utterances; whole turns were sorted. This protection is retained. |
| Gemini reassigns speakers | **UNCONFIRMED/currently absent:** the three attribution functions/call were already removed. Only final-transcript analysis invokes Gemini. |
| Same-speaker merging across 20 seconds | The parameter default was 20, but the implementation already capped the actual gap at 2 seconds and rejected overlap. An effective 20-second merge is **UNCONFIRMED**. The default now correctly states 2. |
| Duplicate text | **CONFIRMED defect:** reused segment IDs and near-equal timestamps could remove genuine speech. Exact word/segment redelivery detection existed, so “no deduplication” is false for this checkout. |
| Longer-text guard / inconsistent stored representations | **CONFIRMED residual guard:** its version-2 bypass covered the normal path, but it remained unsafe for other writes. Separate delete/insert child-row writes were not atomic. Screenshot causation is **UNCONFIRMED**. The guard is gone and all three representations now commit together. |
| Unordered child rows | **CONFIRMED for databases without context migration:** ordering aliases were optional, with unordered fallback inserts. New nullable `turn_index`, `start_seconds`, `end_seconds` are independent of context migration. |
| Lowercase/no punctuation wording | Provider output is preserved verbatim; actual acoustic/model accuracy and historical provider are **UNCONFIRMED**. No grammatical cleanup or invented punctuation is applied. |
| “Could not reach the recording service” | **CONFIRMED source:** generic branches in `recordingAccess.js` and `MeetingRecordingLink.jsx`. HTTP errors could be hidden by that fallback. The older document's hosted function-404 diagnosis is **UNCONFIRMED in this run**. |
| Cached recording URL expires / HEAD rejected / CORS | Temporary cached URLs and GET-based storage access are confirmed by code and current official docs. Actual screenshot storage responses are **UNCONFIRMED**. Fresh access, a GET range probe and native streaming download avoid relying on permanent URLs or storage CORS. |

The context/project “migration not applied” message is a separate rollout issue and remains out of scope.

## Repairs and data integrity

- Speaker IDs stay authoritative. A change always ends a turn. The MeetingBaaS timeline names a **whole** cluster only with at least **2 seconds** of evidence, **90%** voting agreement and **70%** speech coverage. Otherwise stable `Speaker N` labels remain. No dialogue/roster-order/role guesses; the bot remains excluded from the participant registry.
- Provider utterances stay intact through ordinary pauses and punctuation. Scribe has no utterance objects, so speaker changes and a long **10-second** silence define them. Adjacent same-cluster turns merge only across nonoverlapping gaps ≤2 seconds. Overlap stays flagged and words are never globally interleaved.
- Deduplication requires exact speaker, start, end and text. Reused IDs, sub-millisecond timing differences, different speakers and later repetitions survive. Raw inputs are not mutated.
- `20261008000000_meeting_pipeline_integrity.sql` adds nullable ordering and completion-lease columns plus two service-only RPCs. A ten-minute lease prevents concurrent completion/reprocess writers. `persist_meeting_transcript` derives meeting text and ordered child rows from the single turns array in one transaction. Optional context ordering aliases remain populated when installed.
- Raw data uses the existing RLS-enabled, policy-free, service-only `meeting_transcript_sources` archive. The new migration archives legacy raw caches before clearing them. Future meeting payloads contain only compact lifecycle metadata, so dashboard `select('*')` does not deliver raw provider transcription/diarization to browsers.
- Existing `process-elevenlabs-transcription` is the admin/service reprocess endpoint. It consumes the saved Scribe result or an archived MeetingBaaS JSON source. It never calls STT again. Sources that contain only expired URLs cannot be reconstructed and return 409.
- Watch gets fresh video, falling back to fresh audio. MP4 download reports audio-only separately. Deleted files are 410, processing is 202 with Retry-After, missing video is 404, user authorization is 401/403, and provider/API/storage/network errors have distinct codes. A bot-details 404 does **not** prove retention deletion: docs say it can also mean wrong team/not found.
- Download grants contain **only** `meeting_id`, `bot_id`, `user_id`, `exp`; lifetime is two minutes. They are HMAC signed using the existing server key, verified before lookup, and access/bot identity are checked again before streaming. Valid single ranges and 206 are forwarded. Content-Length mismatches fail the stream explicitly. No full-file blob buffering.
- Native download is preceded by a HEAD request to **our** endpoint, which probes storage with GET. Errors retain their HTTP codes and exposed status headers. Errors after native handoff are reported by the browser download manager; the app cannot confirm disk completion. The previous signed-origin/request-ID redirect bridge is no longer used. Existing static files can remain deployed.
- The large-download fallback action opens a **newly refreshed** provider URL directly; it does not reuse the signed URL captured earlier.

## Official documentation checked before provider-call edits

- [MeetingBaaS v2 create bot](https://docs.meetingbaas.com/api-v2/reference/bots/createBot)
- [Bot details](https://docs.meetingbaas.com/api-v2/reference/bots/getBotDetails)
- [Artifacts/retention](https://docs.meetingbaas.com/api-v2/artifacts)
- [Webhooks/callbacks](https://docs.meetingbaas.com/api-v2/webhooks)
- [Scribe API](https://elevenlabs.io/docs/api-reference/speech-to-text/convert)
- [Async speech-to-text](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/batch/webhooks)
- [Official raw-body HMAC implementation](https://github.com/elevenlabs/elevenlabs-js/blob/main/src/wrapper/webhooks.ts)

Documentation corrections: MeetingBaaS batch STT does not accept ElevenLabs; direct asynchronous Scribe is appropriate. Bot-specific callbacks only send completion/failure; lifecycle events need account-level Svix webhooks. `source_url` is current; `cloud_storage_url` is deprecated. ElevenLabs' guide inconsistently shows two event shapes and reserializes JSON in one sample; the documented transcription payload and official SDK's **raw-body** HMAC protocol are used instead. MeetingBaaS details/artifacts document FLAC audio, although an illustrative webhook shows MP3; verified response Content-Type refines audio format metadata.

## Exact owner rollout steps — hosted work NOT RUN

1. **Link and inspect first**, in the repository root with a working native Supabase CLI:
   ```sh
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase functions list
   supabase migration list
   ```
   Use the project serving the current frontend. Complete login privately. Inspect returned version/name/status fields only; do not publish credentials, provider URLs or raw payloads.
2. **Verify migration prerequisites** in Supabase → SQL Editor. Inspect installed table/column names (`meetings.bot_id`, ownership/admin RLS, `processing_stage`, `transcript_segments`, provider/metrics columns, `meeting_transcription_jobs`, `meeting_transcript_sources`, recording status/metadata). If the Oct 5 ElevenLabs/provenance/recording migrations are genuinely pending, apply each pending file **once**, after verifying history, in version order. Do not replay already-applied historical migrations. This repair does not require the context migration.
3. **Apply the new migration**. If CLI dry-run proposes only the new intended migration:
   ```sh
   supabase db push --dry-run
   supabase db push
   ```
   If historical ordering makes that unsafe, use Supabase → SQL Editor → New query, paste the contents of `supabase/migrations/20261008000000_meeting_pipeline_integrity.sql`, and click **Run**. After successful application, record that new version:
   ```sh
   supabase migration repair 20261008000000 --status applied
   supabase migration list
   ```
   The migration is additive/re-runnable and archives raw caches before clearing them. It does not assign legacy meeting owners. Assign a specific legacy owner through existing admin/database tools only when that user's ownership is known.
4. **ElevenLabs → Developers → Webhooks → Create webhook** (or edit the existing meeting webhook): HTTPS callback `https://<your-project-ref>.supabase.co/functions/v1/elevenlabs-webhook`; auth method **HMAC**; event **Transcription completed**. Copy its webhook ID and HMAC secret privately. In Developers → API Keys, ensure the existing STT key has Speech-to-Text permission and available credits.
5. **Supabase → Edge Functions → Secrets**: add/update `SPEECH_TO_TEXT_PROVIDER` to `elevenlabs`, `ELEVENLABS_MODEL_ID` to `scribe_v2`, and privately enter `ELEVENLABS_API_KEY`, `ELEVENLABS_WEBHOOK_ID`, `ELEVENLABS_WEBHOOK_SECRET`. Verify existing `MEETINGBAAS_API_KEY`, `GEMINI_API_KEY`, `MEETINGBAAS_WEBHOOK_SECRET`, and optional `GEMINI_MODEL`. Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; these remain server-side. No new secret names were introduced. Local `.env` does not configure hosted functions.
6. **MeetingBaaS settings**: verify the existing API key belongs to the team holding these bot IDs. Set the bot callback override `MEETINGBAAS_WEBHOOK_URL`, if used, to `https://<your-project-ref>.supabase.co/functions/v1/meetingbaas-webhook`. Deploy-bot already sets speaker-view recording, callbacks and the callback secret. In the MeetingBaaS dashboard's account webhook settings, use the same endpoint and enable `bot.status_change`, `bot.completed`, `bot.failed`; save its Svix signing secret as `MEETINGBAAS_WEBHOOK_SIGNING_SECRET` in Supabase Secrets. Existing bots retain their original capture/provider configuration.
7. **Deploy all six relevant functions** from the repository root; config retains JWT verification for browser/admin calls:
   ```sh
   supabase functions deploy deploy-bot
   supabase functions deploy meetingbaas-webhook --no-verify-jwt
   supabase functions deploy elevenlabs-webhook --no-verify-jwt
   supabase functions deploy process-elevenlabs-transcription
   supabase functions deploy get-meeting-recording
   supabase functions deploy download-meeting-recording --no-verify-jwt
   supabase functions list
   ```
   The two provider webhooks verify their existing secret/HMAC; download verifies its signed grant. Deploy shared-code consumers together.
8. **Rebuild/redeploy the frontend**, from the repository root:
   ```sh
   npm ci
   npm run build
   ```
   Publish the resulting `dist/` through the existing frontend hosting project and reload the browser. The host/deploy command is not identified by the provided project; keep its existing deployment procedure and existing public frontend build variables. The verification build here used an external env-free config, not production `.env` values.
9. **Recover old results when needed**, while signed in as an admin, using the existing Supabase client in the app's developer context:
   ```js
   await supabase.functions.invoke('process-elevenlabs-transcription', {
     body: { meeting_id: '<meeting UUID>', reprocess: true },
   });
   ```
   For an interrupted saved job, omit `reprocess`; wait ten minutes if a worker-exit lease remains active. For non-Scribe archives, `source_id` optionally selects one archived source from that meeting. An ambiguous submission is never automatically resubmitted: confirm its acceptance with ElevenLabs before an administrator resets an unaccepted job. No API keys or signed URLs should be pasted into browser console/logs.

## Automated verification

Commands (Deno/PGlite/native bindings installed temporarily outside the repository):

```sh
deno test --reporter=dot --no-lock --node-modules-dir=none --allow-env --import-map=supabase/tests/import_map.json supabase/tests/*.test.ts
PGLITE_MODULE=/tmp/omnirush/node_modules/@electric-sql/pglite/dist/index.js node --test supabase/tests/pipeline-integrity.test.mjs supabase/tests/recording-access.test.mjs supabase/tests/elevenlabs_database.test.mjs supabase/tests/transcript-provenance.test.mjs supabase/tests/recording-client.test.mjs supabase/tests/transcript-display.test.mjs
deno check --no-lock --node-modules-dir=none supabase/functions/deploy-bot/index.ts supabase/functions/meetingbaas-webhook/index.ts supabase/functions/elevenlabs-webhook/index.ts supabase/functions/process-elevenlabs-transcription/index.ts supabase/functions/get-meeting-recording/index.ts supabase/functions/download-meeting-recording/index.ts
NODE_PATH=/tmp/omnirush/node_modules npm run lint
NODE_PATH=/tmp/omnirush/node_modules node node_modules/vite/bin/vite.js build --config /tmp/omnirush/pipeline-vite.config.mjs
git diff --check
```

The temporary Vite wrapper imports the original Vite configuration and overrides only envDir/output directory, avoiding project `.env` reads and writing verification assets under `/tmp/omnirush/`. Production settings are unchanged. PostgreSQL tests validate migration reruns, raw-data isolation, lease exclusion, meeting/bot correlation, atomic rollback, all three ordered representations, empty results, reprocessing and ownership upsert. Mocked handlers cover provider submission/callbacks, summaries/decisions/action items, recording access/ranges/bytes, revoked access, grants, failed processing, duplicate/out-of-order events and webhook-before-dispatch persistence.

Hosted migrations/deployments, real Scribe requests, a real Google Meet and browser disk playback are **NOT RUN**.

Results: **PASS — 92 Deno tests; 32 PostgreSQL/frontend checks; six Edge entrypoints type-checked; production Vite compilation; lint (existing warnings); `git diff --check`.** Initial tool launches failed because Windows native dependencies were present in Linux; temporary Linux tooling resolved those environment failures without modifying project dependencies or the lockfile.

## Owner live checklist — every item NOT RUN

- [ ] **NOT RUN:** Create/schedule a meeting using the existing flow.
- [ ] **NOT RUN:** Join Google Meet and deploy one bot.
- [ ] **NOT RUN:** Have 2–3 people speak in turns, including a mid-sentence pause and repeated phrases.
- [ ] **NOT RUN:** Include a short 1–2 second stretch of overlapping speech.
- [ ] **NOT RUN:** End the meeting; wait for recording/transcript processing.
- [ ] **NOT RUN:** Verify speaker identity/numbered fallbacks, turn order, preserved words and no redelivery duplicates.
- [ ] **NOT RUN:** Open Watch in the app and verify playback.
- [ ] **NOT RUN:** Click Download, confirm the file saves and plays locally.
- [ ] **NOT RUN:** Confirm transcript, recording, summary and action items belong to the same meeting/bot.
- [ ] **NOT RUN:** Confirm Gemini summary, decisions and action items still generate.
- [ ] **NOT RUN:** Retry access with an expired cache; test processing/deletion states and rejection of a non-owner.

## Limits

MeetingBaaS v2 artifact URLs last **four hours**; grants last **two minutes**. Retention is plan-dependent (currently documented as 3/7/14/30 days). Refresh cannot recover deleted artifacts. New Scribe submission by URL requires audio to remain accessible when ElevenLabs fetches it. Acoustic diarization can still be wrong; weak naming evidence deliberately yields stable numbered speakers.

Supabase documents **150-second Free / 400-second paid wall-clock limits**, including background work, **2 seconds CPU per request**, and **256 MB memory** ([current limits](https://supabase.com/docs/guides/functions/limits)). A slow/large streamed file can exceed the wall-clock limit despite constant-memory streaming; unusually large transcript assemblies can hit CPU/memory limits. Use the new direct-open fallback and the browser's save/download controls for large files; the direct URL still has provider expiry/retention limits. Background callbacks/jobs are durable, but interrupted workers/lost provider deliveries may require the documented admin recovery. After native attachment handoff, disk completion and mid-stream browser failures are observed in the browser download manager.
