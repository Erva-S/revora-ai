# ElevenLabs meeting transcription

Revora defaults to **ElevenLabs Scribe v2** (`scribe_v2`) for post-meeting
transcription. MeetingBaaS records the call; Revora submits the audio directly
to ElevenLabs using its asynchronous batch API. Gemini produces the summary
and action items after the transcript is saved.

MeetingBaaS's managed ElevenLabs integration is **streaming-only** and requires
a public WebSocket receiver. This implementation uses ElevenLabs's batch API
to preserve the existing post-meeting dashboard workflow.

## Setup

1. Apply `supabase/migrations/20261005000000_elevenlabs_transcription.sql` to
   the existing migrated database. It depends on the meetings table and
   `0005_transcription_provider_metrics.sql`. It adds the service-only
   `meeting_transcription_jobs` table; each meeting has at most one job. Also
   apply `20261005010000_transcript_provenance.sql` for separate raw source
   snapshots. See [RECORDING_PIPELINE.md](RECORDING_PIPELINE.md) for the additional
   recording-access migration and watch/download functions.
2. In **ElevenLabs → Developers → Webhooks**, create an **HMAC** webhook with
   the **Transcription completed** event and this callback URL:

   ```text
   https://<project-ref>.supabase.co/functions/v1/elevenlabs-webhook
   ```

   Copy its webhook ID and HMAC secret. Use an ElevenLabs API key with
   Speech-to-Text access and available transcription credits.
3. Set these Supabase Edge secrets (the local `.env` does not configure hosted
   Edge Functions):

   ```sh
   supabase secrets set SPEECH_TO_TEXT_PROVIDER=elevenlabs ELEVENLABS_MODEL_ID=scribe_v2
   supabase secrets set "ELEVENLABS_API_KEY=<key>" "ELEVENLABS_WEBHOOK_ID=<webhook-id>" "ELEVENLABS_WEBHOOK_SECRET=<hmac-secret>"
   ```

4. Deploy:

   ```sh
   supabase functions deploy deploy-bot
   supabase functions deploy meetingbaas-webhook
   supabase functions deploy elevenlabs-webhook
   supabase functions deploy process-elevenlabs-transcription
   ```

   `supabase/config.toml` disables JWT verification on the two public provider
   webhooks. ElevenLabs uses raw-body HMAC verification; MeetingBaaS uses its
   existing callback secret/Svix verification. Set `MEETINGBAAS_WEBHOOK_SECRET`
   for callbacks; account-level lifecycle webhooks also require
   `MEETINGBAAS_WEBHOOK_SIGNING_SECRET`.

5. Dispatch a **new** meeting bot. Previously dispatched bots keep the provider
   captured in their metadata; existing transcripts are not retranscribed.

## Exact requests

ElevenLabs-mode bot creation includes:

```json
{
  "recording_mode": "speaker_view",
  "transcription_enabled": false,
  "callback_enabled": true,
  "extra": {
    "revora": {
      "transcription_provider": "elevenlabs",
      "transcription_model": "scribe_v2"
    }
  }
}
```

No `transcription_config.provider=elevenlabs` is sent to MeetingBaaS's batch
API. Recording, callback URL/authentication, and auto-leave settings are
configured through the existing bot deployment path.

On recording completion, Revora sends multipart form data to
`POST https://api.elevenlabs.io/v1/speech-to-text`:

| Field | Value |
| --- | --- |
| Authentication header | `xi-api-key: <ELEVENLABS_API_KEY>` |
| `model_id` | `scribe_v2` by default; `scribe_v1` is also accepted |
| `source_url` | MeetingBaaS's signed audio URL, with video as a fallback |
| `diarize` | `true` |
| `timestamps_granularity` | `word` |
| `tag_audio_events` | `false` |
| `webhook` | `true` |
| `webhook_id` | The configured ElevenLabs webhook ID |
| `webhook_metadata` | JSON containing the durable job UUID |

The API key stays server-side and is never sent to MeetingBaaS or the browser.
There is no additional ElevenLabs SDK dependency.

## Completion, speaker names, and recovery

- MeetingBaaS completion creates one durable job and returns after submission.
- The named diarization timeline is downloaded before its signed URL expires.
- ElevenLabs sends `speech_to_text_transcription` with `data.transcription`,
  `data.request_id`, and the original `data.webhook_metadata`.
- `elevenlabs-webhook` checks HMAC-SHA256 over `timestamp.rawBody`, matches the
  job/request, and saves the result before acknowledging receipt.
- Supabase `EdgeRuntime.waitUntil` processes that saved result in the background;
  Gemini does not hold open the provider's webhook response.
- Scribe's `speaker_0`/`speaker_1` are acoustic clusters, not participant IDs.
  Stable names require sustained, unambiguous MeetingBaaS timeline evidence;
  clusters are never renamed independently word by word. Unresolved speakers
  retain distinct `Speaker 1`, `Speaker 2`, etc. labels.
- The transcript is saved before Gemini, along with `transcription_provider`
  and the exact model in `transcript_metrics.model`. The job also stores its model.
- Duplicate notifications and an early result arriving before submission
  acknowledgement do not reset completed jobs or resubmit audio.

If background processing is interrupted, an admin can retry **the saved result**:

```js
await supabase.functions.invoke('process-elevenlabs-transcription', {
  body: { meeting_id: '<meeting UUID>' },
});
```

The recovery endpoint accepts verified admins or the service key. It does not
submit another transcription request. Processing uses a five-minute lease;
an interrupted lease can be reclaimed after that time.

To regenerate an already completed display transcript using the current
deterministic rules, include `reprocess: true` in that request. It uses the
saved Scribe result, preserves archived source snapshots, and reruns downstream
summary/context processing without submitting/billing another STT job. Gemini
is never used to rename speakers or rewrite transcript content; see
[TRANSCRIPT_QUALITY.md](TRANSCRIPT_QUALITY.md).

A network failure after submission is recorded as `submission_unknown`. The
app waits for the signed callback rather than submitting/billing twice. If the
provider confirms that no job was accepted, an administrator can reset that
job to `failed` with `request_id = null` and replay the MeetingBaaS completion
while its audio is still available. A job whose submission was rejected before
acceptance can retry on the next MeetingBaaS completion delivery.

## Verification and limits

Focused Deno tests exercise real handlers with mocked provider/database calls:
dispatch, multipart submission, signatures, speaker mapping, Unicode text,
duplicates, early callbacks, ambiguous submission, processing recovery, and
authorization. Run:

```sh
deno test --no-lock --node-modules-dir=none --allow-env --import-map=supabase/tests/import_map.json supabase/tests/elevenlabs.test.ts supabase/tests/meetingbaas.test.ts supabase/tests/deploy-bot.test.ts supabase/tests/transcription.test.ts supabase/tests/recording.test.ts supabase/tests/webhook.test.ts
```

`supabase/tests/elevenlabs_database.test.mjs` exercises the migration against
real PostgreSQL via PGlite, including reruns, duplicate jobs, service-only
access, job claims, and cascade deletion. Install PGlite outside the project,
then set `PGLITE_MODULE` to its `dist/index.js` and run:

```sh
node --test supabase/tests/elevenlabs_database.test.mjs
```

- This is post-meeting transcription, not live captions.
- ElevenLabs transcription is billed directly by ElevenLabs.
- Missing keys/webhook settings prevent dispatch until configured.
- ElevenLabs file/duration limits and plan concurrency apply; audio is passed
  by URL instead of being loaded into Edge Function memory.
- MeetingBaaS artifact URLs expire after four hours; provider-retained recordings
  eventually expire under the MeetingBaaS plan's retention policy.
- Missing/ambiguous diarization can leave numbered speaker labels.
- Durable results enable manual recovery, but there is no scheduled recovery
  sweep for lost callbacks or interrupted processing.
- Real ElevenLabs requests, hosted migrations/deployment, and a live meeting
  require credentials and have not been verified by the mocked test suite.

References: [MeetingBaaS streaming](https://docs.meetingbaas.com/api-v2/streaming),
[ElevenLabs batch API](https://elevenlabs.io/docs/api-reference/speech-to-text/convert),
[asynchronous transcription](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/batch/webhooks),
[HMAC protocol](https://github.com/elevenlabs/elevenlabs-js/blob/main/src/wrapper/webhooks.ts).
