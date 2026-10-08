# Recording pipeline: findings, implementation, and deployment

Current checkout audit, corrected implementation and rollout: [MEETING_PIPELINE_FIXES.md](MEETING_PIPELINE_FIXES.md). Hosted observations below are historical and were not re-verified by the October 8 repair.

## 1. Verified root cause

Read-only live checks on **2026-10-05** found:

- The configured Supabase project's `get-meeting-recording` function returns
  HTTP **404**, `NOT_FOUND`, `Requested function was not found` (POST and OPTIONS).
  The frontend calls the correct name, but that function is not deployed.
- MeetingBaaS successfully generated the recordings, and the application stored
  their signed MP4 URLs. The Oct 4 cached URL now returns **403**; refreshing via
  bot details returns a working URL. The cached URL is not a permanent identifier.
- Fresh signed GET requests return **206**, `video/mp4`, a valid MP4 `ftyp`
  header, and a total file size. No redirects were observed.
- `HEAD` against these signed **GET** URLs returns **403**. Availability checks
  must use small byte-range GETs, not treat that HEAD rejection as missing video.
- A range GET with an Origin header returned no `Access-Control-Allow-Origin`.
  Direct top-level playback navigation works without CORS, but browser fetch/blob
  downloads must not depend on storage CORS.
- The inspected completed database rows have `user_id = null` and are visible
  through the old anonymous policy. The fix includes owner/admin checks and a
  restrictive meeting read policy; it never guesses a legacy owner.

The primary reported button failure is the **missing hosted access endpoint**.
Temporary URL expiration and missing download support are additional integration
defects. The recording itself did not fail in the two verified meetings.

## 2. Actual provider artifacts

| Field | Oct 5 meeting | Oct 4 meeting |
| --- | --- | --- |
| Meeting ID | `2f0a3da7-78f1-4e4d-bcfe-5a47230d2456` | `e848c29c-cecc-4a44-9eac-f52ded623046` |
| Stable bot ID | `cec0dff6-6777-4b0c-ac1e-1ddd65d8fab5` | `73d79af2-e756-4c02-84a8-1cbe587a06bc` |
| Provider status | `completed` | `completed` |
| Recording mode | `speaker_view` | `speaker_view` |
| Format | MP4, validated header | MP4, validated header |
| Duration | 222 seconds | 186 seconds |
| Size (range response total) | 20,143,597 bytes | 18,657,151 bytes |
| Joined (UTC) | `2026-10-05T16:20:09Z` | `2026-10-04T12:33:01Z` |
| Exited (UTC) | `2026-10-05T16:23:51Z` | `2026-10-04T12:36:07Z` |
| `artifacts_deleted` | `false` | `false` |

`GET /v2/bots/{bot_id}` returns `video`, not a separate download URL or independent
video recording ID. The stable identity is the existing `bot_id` plus the `video`
artifact. Storage paths end in `/{bot_id}/output.mp4`. Fresh URL metadata specifies
`X-Amz-Expires=14400` (four hours). Exact URLs/signatures/API keys are not logged.
The provider responses did not supply a recording-generation/completion timestamp;
joined/exited timestamps must not be relabeled as artifact availability time.

The two inspected old bot callbacks point to a placeholder tunnel and have no
callback secret. Stored results prove some completion delivery occurred, not
that those per-bot callback settings are reliable. New deployments use the
stable Supabase webhook URL unless an explicit override is set.

## 3–6. Playback, fresh URLs, download, and proxy

**Watch:** authenticate a real Supabase user → read the meeting with caller RLS
→ explicitly check owner/admin → get fresh MeetingBaaS bot details → validate
video with `GET Range: bytes=0-31` → save metadata → recheck access → return the
fresh URL → navigate a synchronously reserved browser tab to the actual MP4.
No stored URL fallback is used if the stable bot identifier is missing.

**Download:** the same authenticated endpoint issues a two-minute HMAC-signed
grant containing only meeting/bot/user IDs, expiry, request ID, and frontend
origin. The browser first checks the streaming endpoint with HEAD, then starts
a native attachment request. No user JWT or provider key is put in its URL.

`download-meeting-recording` verifies the grant, rechecks the current owner and
profile role before/after retrieval, refreshes the provider URL again, and streams
the actual MP4 bytes with `Content-Disposition: attachment`. It forwards valid
single byte ranges/206 responses, supports HEAD via a signed **GET** probe, and
propagates cancellation. It does not buffer/transcode the entire video or open
a recording page masquerading as a download.

The proxy is required for reliable forced downloads: cross-origin `download`
attributes are not reliable, and this storage does not expose browser-fetch CORS.
Video URLs/storage credentials are never passed to the proxy by the client.

Pre-stream download failures redirect the hidden download frame to a small static
frontend status page, which sends a request-ID/origin/frame-checked data message
to the app. This avoids Supabase's standard-domain rewriting of GET HTML to plain
text. Mid-stream failures are logged and shown by the native browser download
manager; JavaScript cannot claim that a file has finished saving to disk.

Processing, missing video, audio-only, provider API/network errors, retention
deletion, stale access links, malformed metadata/content, and unauthorized access
have distinct responses. A storage 401/403/404 refreshes once; deletion returns
410, while finalization returns 202 with `Retry-After: 15`.

## 7. Lifecycle/database

The bot still records `speaker_view` video and leaves through native provider
timeouts. `call_ended` means **processing**, not ready. Completion saves video
metadata before STT/AI work; a late/duplicate completion can add the video without
rerunning transcript/summary processing. Stale status events cannot regress ready
or deleted recording state. Missing cached URLs no longer hide recording actions.

`20261005020000_recording_access.sql` adds only:

- `meetings.recording_status`: pending/recording/processing/ready/unavailable/expired/failed.
- `meetings.recording_metadata`: stable artifact kind/path, format, recording mode,
  duration/provider timestamps, observed availability, content type/range support,
  and file size when verified. No timestamp/size is invented when absent.
- A restrictive SELECT policy intersecting legacy policies: authenticated owner
  or verified admin only. Service writes remain supported.

Existing `meetings.bot_id` is reused. `recording_url` remains an explicitly temporary
cache; there is no new recording table or duplicate artifact. Admins can access
legacy ownerless recordings; a regular user needs explicit admin assignment.

## 8–9. Files/environment

Backend: `_shared/meeting-recording.ts`, `get-meeting-recording/index.ts`,
`download-meeting-recording/index.ts`, `_shared/meeting-pipeline.ts`,
`_shared/elevenlabs.ts`, and `supabase/config.toml` (paths under `supabase/functions`
except config). Frontend: `MeetingRecordingLink.jsx`, both meeting dashboards,
`src/lib/recordingAccess.js`, and `public/recording-download-status.{html,js}`.
Migration/tests/docs are additive; see the recording test files and this report.

**No new environment variable or secret is introduced.** The access endpoint uses
the existing `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`MEETINGBAAS_API_KEY`, and optional `MEETINGBAAS_API_BASE_URL`. A domain-separated
HMAC derived from the server-only service key signs grants. Rotation invalidates
existing grants. Local `.env` values do not configure hosted Edge Functions.

## Deployment required

Live deployment was blocked: there is no Supabase access token/login in this
environment. A Google Meet URL/participants were also not supplied for a new call.
The hosted application is not repaired until the following steps are completed:

1. Apply existing prerequisites including
   `20260902000000_admin_bot_authorization.sql` (protected profile roles, owner/admin
   policies), then the new `20261005020000_recording_access.sql`. Existing transcript
   work also requires the ElevenLabs/provenance migrations documented separately.
   Apply to the already migrated database; do not blindly replay historical files
   whose ordering is discussed in `CONTEXT_MANAGEMENT.md`.
2. Assign specific legacy meetings to their approved owners, if regular-user access
   is needed. Do not assign every ownerless meeting to an arbitrary user.
3. Deploy with the project's `supabase/config.toml`:

   ```sh
   supabase functions deploy get-meeting-recording --project-ref zddythsszyznsguiuiss
   supabase functions deploy download-meeting-recording --project-ref zddythsszyznsguiuiss --no-verify-jwt
   supabase functions deploy meetingbaas-webhook --project-ref zddythsszyznsguiuiss
   supabase functions deploy deploy-bot --project-ref zddythsszyznsguiuiss
   ```

   Redeploy existing ElevenLabs processing functions with the updated shared code
   when applying the transcription changes. Publish the frontend build, including
   both static download-status files.
4. Configure the stable callback URL/secret in hosted secrets. An explicit
   `MEETINGBAAS_WEBHOOK_URL` must target the actual deployed webhook; remove any
   placeholder/expired tunnel override. Configure account-level Svix lifecycle
   webhooks separately; bot-specific callbacks send completion/failure only.
5. Verify both recording functions exist, anonymous meeting reads return no rows,
   and user A cannot access user B's meeting through either endpoint. New bot rows
   must have a verified `user_id`; demo-mode localStorage is not a real session.

## 10. Testing

The complete local Deno suite covers recording configuration, provider completion
and delayed artifacts, actual-byte download responses, fresh/expired links, HEAD
method mismatch, ranges, storage/API/network errors, ownership reassignment,
admin downgrade, forged/expired grants, native-download error notifications,
backpressure/cancellation, and existing transcription/Gemini/context regressions.
PostgreSQL/PGlite tests validate migration reruns, preserved data, anonymous/
other-user isolation, admin legacy access, and valid recording states. Frontend
tests cover processing, deployment/auth errors, invalid links, and download checks.

Production build, lint, and deployed-entrypoint Deno type checks are required in
addition to those tests. Live provider GET/range checks above are real; endpoint
authorization/stream tests use mocked database/provider transports. They do not
prove a newly deployed browser flow.

Verified local results: **79 Deno tests and 17 PostgreSQL/frontend checks passed**;
all six relevant function entrypoints type-check, production build passes,
and lint passes with existing unrelated warnings. A further read-only probe ran
the new download handler against the **real Oct 5 MeetingBaaS/storage artifact**
using simulated local admin/database responses: it streamed all **20,143,597
bytes**, matched Content-Length, validated the MP4 header, and returned the
attachment headers. No hosted database writes were made. This validates actual
provider/stream compatibility, not hosted authentication or browser disk saving.

Regression command:

```sh
deno test --no-lock --node-modules-dir=none --allow-env --import-map=supabase/tests/import_map.json supabase/tests/*.test.ts
```

Node/PGlite checks are in `recording-access.test.mjs`, `recording-client.test.mjs`,
`elevenlabs_database.test.mjs`, `transcript-provenance.test.mjs`, and
`transcript-display.test.mjs` under `supabase/tests/`. Set `PGLITE_MODULE` to an
externally installed PGlite `dist/index.js` if it is not resolvable locally.
This WSL environment used `NODE_PATH=/tmp/omnirush/node_modules` for existing
Linux-native build/lint dependencies, without changing the project lockfile.

After deployment, run a **new meeting**: join/start recording → participants speak
→ last human leaves → bot departs → processing state → completion artifact stored
→ watch video → download and open the MP4 → refresh/retry both actions → test an
expired cached URL → reject an unrelated user. Also click during finalization and
verify the processing message. Never mark this live checklist passed without a
real call and browser/download verification.

## 11. Limits

MeetingBaaS URLs expire after four hours and retained artifacts are eventually
deleted under the account plan. Refresh cannot recover deleted recordings;
long-term archival requires ownership of the recording in durable storage.
Recording-generation timestamps/independent artifact IDs are not always supplied.
Supabase Edge workers have 150-second free/400-second paid wall-clock limits;
very slow/large downloads can be interrupted even though streaming avoids the
256 MB memory limit. Native Range/retry is supported, and a fresh action renews
access, but unlimited download duration is not claimed.

References: [bot details](https://docs.meetingbaas.com/api-v2/reference/bots/getBotDetails),
[artifacts/retention](https://docs.meetingbaas.com/api-v2/artifacts),
[webhooks](https://docs.meetingbaas.com/api-v2/webhooks),
[Supabase limits](https://supabase.com/docs/guides/functions/limits).
