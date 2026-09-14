# Revora

Revora is an AI meeting assistant. An administrator dispatches a bot into a live
Google Meet, Zoom, or Microsoft Teams call; the bot records the meeting and
produces a timestamped, speaker-attributed transcript; a Gemini pipeline then
generates an executive summary and a deduplicated list of action items with
owners and deadlines. Users see only the meetings assigned to them.

## The problem it solves

Meetings produce decisions and commitments that are quickly lost. Manual notes
are incomplete, generic transcription services return an unattributed wall of
text, and nobody goes back through an hour of recording to find out who agreed
to do what. Revora automates the whole chain — join, record, transcribe,
attribute speakers, summarise, and extract action items — and stores the result
against the specific user who is allowed to read it.

## Technology stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, Vite 8, React Router 7, Tailwind CSS 4 |
| UI libraries | Framer Motion, lucide-react, react-markdown, canvas-confetti, clsx, tailwind-merge |
| Lint | oxlint |
| Backend | Supabase: Postgres, Auth, Realtime, and two Deno Edge Functions |
| Meeting bot | MeetingBaaS v2 API |
| AI | Google Gemini via the `generativelanguage.googleapis.com` REST API |
| Legacy backend | Express + Sequelize/SQLite under `server/` (not part of the current pipeline) |

There is no custom Node server in the working architecture. All server-side
logic lives in the two Supabase Edge Functions.

## Project structure

```
futurrizon/
├── index.html                       Vite entry point
├── package.json                     Frontend scripts and dependencies
├── vite.config.js                   Vite + React + Tailwind v4 plugins
├── .env.example                     Environment variable template (partly outdated)
├── schema.sql                       Early profiles-only schema (superseded by migrations)
├── supabase/
│   ├── config.toml                  Per-function JWT verification settings
│   ├── functions/
│   │   ├── deploy-bot/index.ts             Admin-only bot dispatch and ejection
│   │   └── meetingbaas-webhook/index.ts    Public webhook: transcript + Gemini pipeline
│   └── migrations/                  Postgres schema, RLS policies, triggers
├── src/
│   ├── main.jsx                     React root
│   ├── App.jsx                      Routes and page composition
│   ├── index.css                    Tailwind import and theme tokens
│   ├── context/AuthContext.jsx      Supabase session, profile, and role handling
│   ├── lib/supabaseClient.js        The single Supabase client instance
│   ├── lib/meetingStatus.js         Status and processing-stage display labels
│   ├── pages/UserDashboard.jsx      Overview, meetings, settings, profile
│   ├── pages/AdminDashboard.jsx     Bot deployment, meeting monitor, user directory
│   └── components/                  Landing page sections, modals, dashboard widgets
└── server/                          Legacy Express/SQLite backend (see Known limitations)
```

## Frontend architecture

- **Single-page React app** built with Vite, using React Router for routes:
  `/` and `/login` (public landing page), `/dashboard`, `/meetings`,
  `/meetings/:id`, `/meeting/:id`, `/settings`, `/profile` (signed-in), and
  `/admin`, `/admin-dashboard`, `/admin/meetings` (admin only).
- **`AuthProvider`** wraps the app and exposes the authenticated user, session,
  loading state, and login/logout helpers through the `useAuth` hook.
- **`ProtectedRoute`** is a navigation guard only. It redirects unauthenticated
  visitors to `/login` and non-admins away from `/admin*`. It is explicitly not
  the security boundary — see *Admin vs user functionality*.
- **`UserDashboard`** derives its active tab from the URL and shows the meeting
  feed, meeting detail (recording link, summary, transcript, action items),
  settings, and profile views.
- **`AdminDashboard`** composes the bot deployer, meeting calendar, meeting
  monitor (`AdminMeetingsPanel`), and the user directory.
- **Realtime updates**: `UserDashboard` and `AdminMeetingsPanel` subscribe to
  `postgres_changes` on `public.meetings` and refetch when a row changes, so
  bot status and results appear without a manual refresh.
- **Styling** is Tailwind CSS v4 via `@tailwindcss/vite`, with theme tokens and
  custom shadow utilities defined in `src/index.css`.

## Backend architecture

The backend is Supabase:

- **Postgres** stores profiles, meetings, transcripts, summaries, and action
  items.
- **Auth** issues the JWTs used by the frontend and by the `deploy-bot`
  function.
- **Realtime** broadcasts changes on `public.meetings` to the dashboards.
- **Two Edge Functions** (Deno, TypeScript) hold all privileged logic:

| Function | JWT verification | Responsibility |
| --- | --- | --- |
| `deploy-bot` | Enabled (`verify_jwt = true` in `supabase/config.toml`) | Verify the caller is an admin, dispatch a MeetingBaaS bot, create the meeting row. Also handles admin-initiated bot ejection via `DELETE`. |
| `meetingbaas-webhook` | Disabled (`verify_jwt = false`) | Receive MeetingBaaS events, assemble the transcript, run the Gemini passes, and persist everything. Authenticates with a shared secret instead of a JWT. |

Both functions write to the database with the Supabase **service-role key**,
which bypasses Row Level Security; RLS protects everyone else.

## Supabase and authentication

- Authentication is handled by **Supabase Auth**. The app supports
  email/password sign-in (`signInWithPassword`) and Google OAuth
  (`signInWithOAuth({ provider: 'google' })`).
- A database trigger (`public.handle_new_user`) creates a row in
  `public.profiles` for every new `auth.users` row, defaulting `role` to
  `'user'`. Any account signing up with the address `admin@revora.ai` is
  created with `role = 'admin'`.
- The app reads the profile to resolve the user's display name and role, and
  stores a copy in `localStorage` so the UI can render immediately on refresh.
- **Demo mode:** `AuthContext` can create a client-side demo user or demo admin
  that is persisted in `localStorage` with no Supabase session. Any `admin@...`
  address also falls back to the demo admin. This is a UI convenience for
  exploring the product; it grants no server-side access, because both the Edge
  Function and RLS decide authorization from a real JWT.
- **Row Level Security** is enabled on `profiles`, `meetings`, `transcripts`,
  `summaries`, and `action_items`. The final migration
  (`20260902000000_admin_bot_authorization.sql`) scopes reads to the assigned
  user, makes writes admin-only, removes the earlier `user_id is null` escape
  hatch, and revokes insert/update/delete from the `anon` role.
- A trigger (`public.guard_profile_role_change`) prevents a normal user from
  promoting themselves to `admin` through the "update own profile" policy.

## Admin vs user functionality

**Admin**

- Sign in with an account whose `profiles.role` is `admin`.
- Deploy a Revora bot into a live meeting URL (Google Meet, Zoom, Teams, or a
  generic video call) and optionally assign the resulting meeting to a
  registered user.
- Eject a running bot.
- Monitor every meeting: pipeline stage, bot id, recording link, summary,
  transcript, and action items.
- Manage the user directory: promote/demote roles and delete profile rows.
  Deletion removes the `profiles` row, not the underlying `auth.users` account.
- Schedule pre-meeting briefings through the legacy Express API.

**User**

- Sign in and see only the meetings where `meetings.user_id` matches their own
  id (enforced by RLS).
- Open a meeting to read its summary, full transcript, action items (task,
  assignee, deadline, status), and follow the recording link.
- View settings and profile pages.

The bot deployer component is rendered on the user dashboard as well, but the
`deploy-bot` function rejects any caller whose profile role is not `admin` with
HTTP 403, so a non-admin cannot deploy a bot. Hiding the button is not what
enforces this.

## MeetingBaaS integration

MeetingBaaS is the meeting-bot platform. It is responsible for:

- Joining the meeting with a bot identity (`BOT_NAME`, optional
  `BOT_ENTRY_MESSAGE`, optional `BOT_IMAGE_URL`).
- Recording the call in `speaker_view` mode.
- Running speech-to-text through the configured provider
  (`SPEECH_TO_TEXT_PROVIDER`; valid v2 values are `gladia`, `deepgram`,
  `assemblyai`, `speechmatics`, `soniox` — the function validates the value and
  falls back to `gladia`).
- Producing **diarization** (a speaker timeline).
- Delivering lifecycle callbacks to the Revora webhook.
- Providing signed artifact URLs for the transcription JSON, the diarization
  JSONL, and the recording.

The dispatch payload contains both the v1 and v2 property shapes for
compatibility (`webhook_url` / `speech_to_text` / `automatic_leave` and
`callback_enabled` + `callback_config` / `transcription_enabled` +
`transcription_config` / `timeout_config`). Only the v2 fields are honored by
the v2 API. Dispatch tries `POST /v2/bots`, then `/v1/bots`, then `/bots` (or
`/v1/bots` first if `MEETINGBAAS_API_BASE_URL` ends in `/v1`), authenticating
with the `x-meeting-baas-api-key` header.

## Google Meet bot flow

1. An admin pastes a `https://meet.google.com/...` URL into the deployer.
2. The browser invokes the `deploy-bot` Edge Function with the Supabase session
   JWT in the `Authorization` header.
3. The function verifies the JWT with `auth.getUser`, reads `profiles.role` with
   the service-role key, and rejects anyone who is not an admin (fail-closed: a
   missing service-role key means deployment is refused, not allowed).
4. The function detects the platform from the URL
   (`google_meet`, `zoom`, `teams`, or `video_call`), builds the MeetingBaaS
   payload, and dispatches the bot.
5. On success it inserts a `meetings` row with `bot_id`, `user_id` (the assigned
   owner, defaulting to the admin), `status = 'pending'`, `started_at`, and the
   detected platform. The assigned owner is validated against `profiles`.
6. The bot joins the Meet call and appears as a participant named after
   `BOT_NAME`.
7. The bot leaves under its configured timeouts, when the call ends, or when an
   admin ejects it.

## Recording and transcription flow

Transcription does **not** happen in the browser. The bot streams audio to
MeetingBaaS, which runs the external STT provider and returns artifacts. The
webhook then rebuilds a clean transcript from those artifacts:

1. **Fetch artifacts** — the `transcription` artifact (utterances with
   per-word timings) and the `diarization` artifact (speaker timeline) are
   downloaded from their signed URLs.
2. **Build the participant roster** from MeetingBaaS metadata
   (`data.participants` / `data.speakers`). This roster is the only set of
   speaker names accepted anywhere downstream; nothing is hardcoded.
3. **Flatten to words** — every word is placed in one global, time-ordered
   stream, and its speaker is resolved from the diarization timeline (falling
   back to the utterance's own speaker label). No word is dropped.
4. **Cut sentences** — the stream is split on real punctuation, with safety
   valves for runs over 45 words or gaps of 4 seconds, and each sentence is
   awarded to whichever speaker voiced most of it by duration. This prevents a
   single sentence from being split across two speakers.
5. **Gemini attribution audit** (WHO only) — see below.
6. **Merge turns** — consecutive same-speaker sentences within 20 seconds are
   merged into one readable turn, then rendered as `Speaker: text`.

The webhook logs word conservation (source word count vs final word count) so
that text loss is detectable rather than silent.

## Gemini integration

### Exact model used

The webhook does **not** hardcode a single model. `callGemini` walks a model
chain defined in `supabase/functions/meetingbaas-webhook/index.ts`:

```ts
const KNOWN_DEAD_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro']);
const WORKING_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3-flash-preview'];
```

- `GEMINI_MODEL` is used first, **but only if it is not in `KNOWN_DEAD_MODELS`**.
- The chain then continues through `WORKING_MODELS` in order:
  `gemini-flash-latest` → `gemini-flash-lite-latest` → `gemini-3-flash-preview`.
- Each model gets two attempts; HTTP 429, 500, and 503 are retried, other
  failures move on to the next model. If every model fails, the function logs
  the failure and returns `null` rather than inventing content.

**In the current repository configuration the effective model is
`gemini-flash-latest`**: the root `.env` sets `GEMINI_MODEL=gemini-1.5-flash`,
which is in the dead-model list and is therefore skipped. UI copy that still
says "Gemini 1.5 Flash" is outdated.

Separately, the legacy `server/aiService.js` hardcodes `gemini-1.5-flash`
through the `@google/generative-ai` SDK; that file is not part of the live
pipeline.

### How Gemini is called

Gemini is called over REST:
`POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
with `temperature` 0.1 for attribution and 0.2 for summarisation,
`maxOutputTokens: 8192`, and `responseMimeType: 'application/json'`. The key
comes from the `GEMINI_API_KEY` secret.

### What is sent to Gemini, and what it may return

**Pass 1 — speaker re-attribution (WHO, never WHAT).** The prompt receives the
final transcript turns, each labelled with its index, resolved speaker,
`t=<seconds>`, `stt_confidence`, and an `overlapping_speech` flag, plus the
participant roster. Gemini may only return
`{"corrections":[{"index":0,"speaker":"Exact Name","reason":"..."}]}`.
Guardrails: corrections must use an exact name from the roster and reference a
valid index, otherwise the **entire batch is rejected** and the deterministic
attribution is kept. Transcript text is never modified, merged, split, or
renumbered. An empty correction list is a valid answer.

**Pass 2 — summarisation.** This runs only after the transcript is complete and
already saved. The prompt receives the full transcript text, the participant
roster, and the meeting date (used as "today" for spoken deadlines). It must
return JSON with `executive_summary`, `key_topics`, `key_decisions`,
`sentiment`, and `action_items`.

The result is validated before storage:

- `assignee` is accepted only if it exactly matches a roster name, otherwise it
  becomes `null`.
- `status` is constrained to `pending`, `in_progress`, or `completed`.
- `due_date` is reconciled against the calendar: a spoken weekday resolves to
  the next occurrence on or after the meeting date, and Gemini's ISO date is
  trusted only if the weekday it implies matches the spoken day. The spoken
  wording is preserved in `due_day` when no date can be computed.
- Duplicate action items are removed by task + assignee.

If summarisation fails, the transcript remains saved and visible and the
meeting is flagged with `processing_stage = 'processing_failed'` — a Gemini
failure never costs the transcript.

## Database usage

Created by the migrations in `supabase/migrations/`:

| Table | Purpose |
| --- | --- |
| `profiles` | One row per user, linked to `auth.users`, holding `email`, `full_name`, `avatar_url`, and `role` (`user` or `admin`). |
| `meetings` | One row per bot deployment: `user_id` (owner), `bot_id` (unique join key), `meeting_url`, `title`, `platform`, `status`, `processing_stage`, `recording_url`, `transcript`, `transcript_segments`, `summary`, `action_items` (jsonb), `duration_secs`, `error_message`, `raw_payload`, `started_at`, `ended_at`, timestamps. |
| `transcripts` | One row per transcript turn (`meeting_id`, `speaker`, `text`). Rewritten on each delivery so duplicate webhooks cannot duplicate rows. |
| `summaries` | `executive_summary`, `key_decisions`, `sentiment` per meeting. |
| `action_items` | `task`, `assignee`, `due_day`, `due_date`, `status` per meeting. |

`meetings.bot_id` is the only key MeetingBaaS can join on, so `user_id` is
captured at deploy time. `meetings` is added to the `supabase_realtime`
publication so the dashboards update live.

**Status vocabulary.** `meetings.status` is constrained by the CHECK created
in `0002_meetings.sql` to `pending | recording | completed | summarized |
failed` (`20260608000000_init_schema.sql` also lists `scheduled`, but its
`create table if not exists` is a no-op once 0002 has created the table). The
finer-grained stage shown in the UI is written to the additive
`meetings.processing_stage` column: `bot_dispatched`, `meeting_in_progress`,
`meeting_ended`, `transcript_processing`, `transcript_ready`,
`summary_processing`, `completed`, `processing_failed`. (`recording_retrieved`
exists in the declared stage vocabulary but is never emitted by the current
code.)

`key_topics` is produced by Gemini and returned in the webhook response, but it
is not persisted to a column.

## Webhooks

`meetingbaas-webhook` is deployed with JWT verification disabled because
MeetingBaaS cannot present a Supabase JWT. It authenticates with a shared
secret when `MEETINGBAAS_WEBHOOK_SECRET` is set, accepted from the `x-mb-secret`
header, the `x-webhook-secret` header, or a `?token=` query parameter; a
mismatch is rejected with HTTP 401. If no secret is configured, the check is
skipped.

Handled events:

| Event | Behaviour |
| --- | --- |
| `bot.status_change` | Maps the MeetingBaaS status code onto `meetings.status` and `processing_stage` (queued/joining/waiting → `pending`/`bot_dispatched`; recording/in-call → `recording`/`meeting_in_progress`; call ended → `meeting_ended`). Known failure codes such as `waiting_room_timeout`, `bot_rejected`, `login_required`, or `cannot_join_meeting` mark the meeting failed with the provider's error message. |
| `bot.failed` | Marks the meeting `failed` with the provider error code and message, sets `processing_stage = 'processing_failed'` and `ended_at`, and stores the raw payload. |
| `bot.completed` (or `complete`) | Runs the full post-meeting pipeline described below. |

The handler is idempotent: a meeting that is already `summarized`, or
`completed` with usable content, is reported as a duplicate and ignored. A
re-delivered completion payload can also never overwrite a longer transcript
with a shorter one.

## Complete meeting flow

1. **Schedule / deploy** — an admin enters a meeting URL, an optional title, and
   an optional owner in the deployer.
2. **Authorize** — `deploy-bot` verifies the caller's JWT and `admin` role,
   then validates the assigned owner against `profiles`.
3. **Dispatch** — the function calls the MeetingBaaS v2 create-bot endpoint with
   recording, transcription, callback, and timeout configuration.
4. **Persist** — a `meetings` row is created with `status = 'pending'` and the
   bot id. If dispatch fails, a row is still written with `status = 'failed'`
   and the real MeetingBaaS error, and the API responds 502.
5. **Join** — the bot joins the call and appears as a participant.
6. **Live status** — MeetingBaaS sends `bot.status_change` callbacks; the
   webhook updates the row, and Supabase Realtime pushes the change to the
   dashboards.
7. **Leave** — the bot exits on its configured timeouts, when the call ends, or
   on an admin ejection.
8. **Completed callback** — MeetingBaaS sends `bot.completed` with signed
   artifact URLs.
9. **Transcript assembly** — the webhook fetches the artifacts, rebuilds the
   word-level transcript, and merges turns.
10. **Attribution audit** — Gemini may correct *who* said a line, never *what*
    was said.
11. **Persist transcript** — `meetings.transcript`, `meetings.transcript_segments`,
    the recording URL, duration, and `ended_at` are written, and the
    `transcripts` rows are replaced. The transcript is saved before any
    summarisation runs.
12. **Summarise** — Gemini produces the executive summary, key topics, key
    decisions, sentiment, and action items.
13. **Persist results** — `meetings.summary`, `meetings.action_items`,
    `meetings.status = 'summarized'`, `processing_stage = 'completed'`, plus the
    `summaries` and `action_items` rows.
14. **Read** — the assigned user (and admins) see the meeting, summary,
    transcript, action items, and recording link in the dashboard.

## Environment variables

No secret values are listed here — only names, purposes, and defaults. Never
commit real keys.

### Frontend (root `.env`, `VITE_` prefix required)

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Yes | Supabase project URL. |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anonymous/publishable key. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | No | Alternative key name, used if the anon key is absent. |
| `VITE_API_URL` | No | Base URL for the legacy Express API. Defaults to `http://localhost:5001`. |

### Edge Function secrets (set with `supabase secrets set`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Injected by Supabase; used to build the webhook URL and create service-role clients. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Role verification and RLS-bypassing writes. `deploy-bot` refuses to deploy without it. |
| `SUPABASE_ANON_KEY` | No | Fallback client key for writes. |
| `MEETINGBAAS_API_KEY` | Yes | MeetingBaaS API key, sent as `x-meeting-baas-api-key`. |
| `MEETINGBAAS_API_BASE_URL` | No | Defaults to `https://api.meetingbaas.com`; a trailing `/v1` changes endpoint preference order. |
| `MEETINGBAAS_WEBHOOK_URL` | No | Overrides the callback URL; defaults to `{SUPABASE_URL}/functions/v1/meetingbaas-webhook`. |
| `MEETINGBAAS_WEBHOOK_SECRET` | Recommended | Shared secret the webhook requires. If unset, the check is skipped. |
| `BOT_NAME` | No | Bot display name. Defaults to `Revora Assistant`. |
| `BOT_ENTRY_MESSAGE` | No | Message the bot posts on joining. |
| `BOT_IMAGE_URL` | No | Optional bot avatar. |
| `SPEECH_TO_TEXT_PROVIDER` | No | STT provider; must be one of the v2 providers, otherwise `gladia` is used. |
| `BOT_WAITING_ROOM_TIMEOUT` | No | Seconds to wait in a lobby. Default `300`. |
| `BOT_NO_ONE_JOINED_TIMEOUT` | No | Seconds to wait before leaving an empty call. Default `120`. |
| `BOT_SILENCE_TIMEOUT` | No | Seconds of silence before leaving. Default `30`. |
| `GEMINI_API_KEY` | Yes (for AI) | Gemini API key. Without it, summarisation and attribution are skipped and the transcript is preserved. |
| `GEMINI_MODEL` | No | Preferred model. Ignored when the value is in the known-dead list. |

### Legacy Express server (`process.env`)

`PORT`, `CORS_ORIGIN`, `ADMIN_ID`, `ADMIN_PASSWORD`, `EMAIL_HOST`,
`EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`. `PUBLIC_WEBHOOK_URL` appears in
`.env.example` but is not read by any current code.

## Local setup

Prerequisites: Node.js (with npm), and a Supabase project with the Supabase CLI
installed and linked for deploying functions and setting secrets.

1. Install frontend dependencies:

   ```bash
   npm install
   ```

2. Create your environment file from the template and fill in real values:

   ```bash
   cp .env.example .env
   ```

   Note that `.env.example` is out of date: it does not list
   `SUPABASE_SERVICE_ROLE_KEY`, `MEETINGBAAS_WEBHOOK_SECRET`,
   `MEETINGBAAS_WEBHOOK_URL`, or the `BOT_*` values, and it includes
   `PUBLIC_WEBHOOK_URL`, which nothing reads. Add the variables you need from
   the table above.

3. Apply the database migrations to your Supabase project, in lexical order
   (`0002`, `0003`, `0004`, then the timestamped files). The order matters: the
   timestamped `20260902000000_admin_bot_authorization.sql` migration must sort
   last, because it replaces the permissive policies that
   `20260608000000_init_schema.sql` re-creates.

4. Create at least one user, then make it an admin by setting its
   `profiles.role` to `admin`.

5. Deploy the two Edge Functions and set their secrets:

   ```bash
   supabase functions deploy deploy-bot
   supabase functions deploy meetingbaas-webhook
   supabase secrets set MEETINGBAAS_API_KEY=... GEMINI_API_KEY=... SUPABASE_SERVICE_ROLE_KEY=... MEETINGBAAS_WEBHOOK_SECRET=...
   ```

   The `verify_jwt` setting for each function is read from
   `supabase/config.toml`.

## Running the project

```bash
npm run dev       # Start the Vite dev server
npm run build     # Production build into dist/
npm run preview   # Serve the production build locally
npm run lint      # Run oxlint
```

These are the only scripts defined in `package.json`.

## Currently working

- Email/password and Google OAuth sign-in through Supabase, with profile and
  role resolution and a session-restoring auth provider.
- Role-based route guarding and database-level authorization (RLS plus the
  admin check inside `deploy-bot`).
- Admin-only bot deployment into Google Meet, Zoom, and Teams URLs, with
  optional assignment of the resulting meeting to a specific registered user.
- Bot ejection by an admin.
- Webhook processing of `bot.status_change`, `bot.failed`, and
  `bot.completed` events, with duplicate-delivery protection and transcript
  length protection.
- Word-level transcript reconstruction from MeetingBaaS transcription and
  diarization artifacts, with speaker resolution, sentence segmentation, and
  turn merging.
- Gemini speaker re-attribution constrained to the MeetingBaaS participant
  roster, with the text held immutable and invalid batches rejected.
- Gemini summarisation producing an executive summary, key decisions,
  sentiment, and action items with assignee validation and weekday-to-date
  deadline resolution.
- Persistence of meetings, transcripts, summaries, and action items in
  Supabase, with Supabase Realtime driving live dashboard updates.
- Meeting history with recording link, transcript, summary, and action items;
  admin meeting monitor and user directory with role management.

## In progress

- The AI model surfaced in the UI ("Gemini 1.5 Flash", "Gladia v2 Realtime")
  is static copy rather than a read of the actual configured model or provider.
- Pre-meeting briefings and the meeting scheduling form talk to the legacy
  Express API on port 5001 rather than to Supabase, so that path is separate
  from the meeting pipeline.
- Some dashboard cards describe capabilities in static text rather than
  reflecting live configuration.

## Known limitations

- **No automatic departure when the last human leaves.** Nothing in this
  codebase detects that all participants have left and tells the bot to exit.
  Departure is limited to the three MeetingBaaS timeouts
  (`BOT_WAITING_ROOM_TIMEOUT`, `BOT_NO_ONE_JOINED_TIMEOUT`,
  `BOT_SILENCE_TIMEOUT`), the provider ending the call, or an admin manually
  ejecting the bot.
- **The legacy `server/` backend does not run.** Its `package.json` does not
  declare `dotenv`, `node-cron`, `nodemailer`, `@google/generative-ai`, or
  `mongoose`, all of which its files require, and it has no installed
  `node_modules`. `server/index.js` also never calls `startScheduler`, and
  there is no route for `/api/meetings/extract-tasks` even though
  `TaskExtractorModal` posts to it. Anything depending on this server will fail.
- **`server/models/Briefing.js` references Mongoose** while the rest of the
  legacy server uses Sequelize/SQLite; it is not wired in anywhere.
- **Client-side demo authentication** creates a fake user or admin in
  `localStorage`, and any `admin@...` address can fall back to it. It grants no
  server-side privileges, but it is a real bypass of the sign-in flow as far as
  the UI is concerned.
- **The "Test Mic" control** in the dashboard is a UI toggle with a confetti
  animation; it does not capture or transcribe audio. All transcription happens
  through MeetingBaaS.
- **Deleted users**: the admin delete action removes the `profiles` row only;
  the `auth.users` record remains.
- **`.env.example` is stale** relative to the variables the code actually
  reads.
- `key_topics` from Gemini is returned but never stored.
- `recording_retrieved` is declared in the processing-stage vocabulary but is
  never written.
- The root `schema.sql` describes only an early profiles-only schema and is
  superseded by `supabase/migrations/`.

## Future improvements

- Implement end-of-meeting detection so the bot leaves when the last human
  participant exits, instead of relying on silence and empty-room timeouts.
- Replace the legacy Express/SQLite backend so that briefing generation and
  meeting scheduling use Supabase and the existing Gemini pipeline.
- Drive the settings UI from the real, server-side configuration instead of
  hardcoded model and provider names.
- Add automated tests for the transcript assembly, attribution guardrails, and
  deadline resolution logic.
- Persist `key_topics` alongside the executive summary, or remove it from the
  pipeline output.
- Refresh `.env.example` so it matches the variables the code reads.
- Remove the client-side demo login path, or clearly confine it to development
  builds.
