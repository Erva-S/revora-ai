# Revora — Technical & Architectural Project Context (`context.md`)

This document is the comprehensive reference manual for **Revora** (AI-Powered Live Meeting Assistant). Any AI assistant or engineer collaborating on this repository must read this document alongside [decisions.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/decisions.md) before proposing significant architectural modifications or modifying project code.

---

## Table of Contents

1. [A. Project Overview](#a-project-overview)
   - [A.1 Purpose & Problem Statement](#a1-purpose--problem-statement)
   - [A.2 Main Objectives & User Roles](#a2-main-objectives--user-roles)
   - [A.3 Current Stage & Known Limitations](#a3-current-stage--known-limitations)
2. [B. Technical Context](#b-technical-context)
   - [B.1 End-to-End System Architecture](#b1-end-to-end-system-architecture)
   - [B.2 Technology Stack & Libraries](#b2-technology-stack--libraries)
   - [B.3 Environment Variables & Configuration](#b3-environment-variables--configuration)
   - [B.4 Database Schema, Migrations & Data Flow](#b4-database-schema-migrations--data-flow)
   - [B.5 Edge Functions, API Endpoints & Webhooks](#b5-edge-functions-api-endpoints--webhooks)
   - [B.6 Meeting Bot Lifecycle, Transcription & Summarization](#b6-meeting-bot-lifecycle-transcription--summarization)
   - [B.7 Video Recording Access & Streaming Proxy](#b7-video-recording-access--streaming-proxy)
   - [B.8 Context Management, RAG & Briefings](#b8-context-management-rag--briefings)
   - [B.9 Repository Directory Layout & Component Catalog](#b9-repository-directory-layout--component-catalog)
   - [B.10 Error Handling, Security & Technical Debt](#b10-error-handling-security--technical-debt)
3. [C. Non-Technical Context](#c-non-technical-context)
   - [C.1 Team Roles & Stakeholders](#c1-team-roles--stakeholders)
   - [C.2 Product Goals & Design Philosophy](#c2-product-goals--design-philosophy)
   - [C.3 Academic & Demonstration Context](#c3-academic--demonstration-context)
4. [D. Current Implementation Status](#d-current-implementation-status)
   - [D.1 Completed and Verified Features](#d1-completed-and-verified-features)
   - [D.2 Implemented but Pending Hosted Verification](#d2-implemented-but-pending-hosted-verification)
   - [D.3 Partially Implemented / Divergent Systems](#d3-partially-implemented--divergent-systems)
   - [D.4 Known Bugs & Blockers](#d4-known-bugs--blockers)
   - [D.5 Prioritized Next Tasks](#d5-prioritized-next-tasks)
5. [E. AI Collaboration Guidelines](#e-ai-collaboration-guidelines)
   - [E.1 Pre-Flight Rules for AI Assistants](#e1-pre-flight-rules-for-ai-assistants)
   - [E.2 Verification & Claim Standards](#e2-verification--claim-standards)
   - [E.3 Maintenance Workflow](#e3-maintenance-workflow)

---

## A. Project Overview

### A.1 Purpose & Problem Statement
Meetings generate crucial organizational decisions, architectural direction, and action items that are frequently lost or unrecorded. Traditional note-taking is incomplete, and standard meeting recordings produce unstructured walls of text without clear speaker attribution or deadlines.

**Revora** automates the entire meeting lifecycle:
1. **Joining & Recording:** An autonomous bot joins live calls (Google Meet, Zoom, MS Teams) via the MeetingBaaS API, posts a chat greeting, and records the session.
2. **High-Accuracy Diarized Transcription:** Call audio is submitted to **ElevenLabs Scribe v2** for speaker-attributed, timestamped transcription.
3. **Structured Intelligence:** Google Gemini extracts executive summaries, key discussion points, and deduplicated action items with assigned owners and due dates.
4. **Context & Briefings:** Transcripts are chunked and embedded using Google `gemini-embedding-001` into a `pgvector` store, enabling automated pre-meeting briefing generation based on historical project meetings.
5. **Multi-Tenant Privacy:** Supabase Row Level Security (RLS) ensures attendees see only meetings and action items explicitly belonging to them.

### A.2 Main Objectives & User Roles
- **Admin:**
  - Deploys the Revora bot into live meeting URLs (Google Meet, Zoom, MS Teams).
  - Assigns recorded calls to specific registered users or projects.
  - Monitors live bot statuses and can forcibly eject running bots.
  - Creates and manages planned meetings and projects.
  - Administers user accounts, promotions, and role assignments.
- **Regular User:**
  - Authenticates via Google OAuth or email/password.
  - Views a personal feed of completed and planned meetings assigned to them.
  - Reads executive summaries, structured transcripts, and generated action items.
  - Streams video recordings or downloads MP4 attachments.
  - Reads AI-generated context briefings before attending upcoming calls.

### A.3 Current Stage & Known Limitations
- **Current Stage:** Functional beta / active commercial prototype under development by **Futurrizon Technologies Ltd**.
- **Known Limitations:**
  - Primary speech processing is batch-only post-call; there is no real-time live transcription streaming.
  - Two parallel migration histories exist: lexical replay (`supabase db reset`) on an empty database fails at `0004` unless ordered manually (documented in [CONTEXT_MANAGEMENT.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/CONTEXT_MANAGEMENT.md#L41-L47)).
  - The legacy Node/Express/SQLite backend in `server/` remains unmerged with the Supabase Edge Functions.

---

## B. Technical Context

### B.1 End-to-End System Architecture

```
+---------------------------------------------------------------------------------------------+
|                                    REACT FRONTEND (Vite 8)                                  |
|   Pages: LandingPage, UserDashboard, AdminDashboard                                         |
|   Components: MeetingBotDeployer, PlannedMeetingsPanel, AdminMeetingsPanel, Briefings       |
+---------------------------------------------------------------------------------------------+
               |                                              ^
               | 1. Dispatches Bot (Admin)                    | Realtime Postgres Changes
               | 2. Requests Briefing / Stream Video          | (Status & Summaries)
               v                                              |
+---------------------------------------------------------------------------------------------+
|                                    SUPABASE PLATFORM                                        |
|                                                                                             |
|  [Edge Functions (Deno)]                                                                    |
|    - deploy-bot                     -> Calls MeetingBaaS API to dispatch bot                 |
|    - meetingbaas-webhook            -> Captures MP4/FLAC audio & queues ElevenLabs job       |
|    - elevenlabs-webhook             -> Ingests Scribe v2 transcript, triggers Gemini         |
|    - generate-briefing              -> Hybrid pgvector + relational RAG context briefing     |
|    - get-meeting-recording          -> Probes video storage & issues signed grants           |
|    - download-meeting-recording     -> Streams attachment bytes to browser                   |
|    - process-elevenlabs-transcription -> Idempotent reprocess/recovery endpoint             |
|                                                                                             |
|  [Postgres Database + pgvector]                                                             |
|    - profiles, meetings, transcripts, transcript_segments, action_items, briefings, chunks  |
|    - planned_meetings, project_documents (CAS versioned Markdown storage)                   |
|    - Row Level Security (RLS) & Defensively Fenced RPCs                                     |
+---------------------------------------------------------------------------------------------+
         |                                |                                   |
         v                                v                                   v
+------------------+             +-------------------+             +--------------------+
|   MeetingBaaS    |             |    ElevenLabs     |             |   Google Gemini    |
|   (v2 Bot API)   |             |    (Scribe v2)    |             | (1.5 Flash + Emb)  |
| Joins call &     |             | Asynchronous      |             | Summaries, Action  |
| records MP4      |             | Diarized Batch STT|             | Items, Embeddings  |
+------------------+             +-------------------+             +--------------------+
```

### B.2 Technology Stack & Libraries

| Category | Technology / Library | Version | Role in Revora |
|---|---|---|---|
| **Frontend Framework** | React | `^19.2.8` | Component UI and reactive state |
| **Build Tool** | Vite | `^8.2.0` | Bundler and local development server |
| **Routing** | React Router DOM | `^7.18.3` | Client-side routing and protected routes |
| **Styling** | Tailwind CSS | `^4.3.3` | Utility-first responsive design (`@tailwindcss/vite`) |
| **Icons & UI** | lucide-react, framer-motion | `^1.28.0`, `^12.43.0` | Iconography and micro-animations |
| **Backend & DB** | Supabase (Postgres 17) | Cloud / Local | Primary relational database, Auth, Realtime, Storage |
| **Edge Functions** | Deno TypeScript | Deno standard | Serverless API endpoints for bots, webhooks, and AI |
| **AI LLM** | Google Gemini 1.5 Flash | REST API | Executive summaries and action-item extraction |
| **AI Embeddings** | Gemini `gemini-embedding-001` | REST API | 768-dimensional RAG vector embeddings |
| **Speech-to-Text** | ElevenLabs Scribe v2 (`scribe_v2`) | Batch REST API | High-accuracy diarized transcription |
| **Call Recording Bot** | MeetingBaaS v2 API | Cloud API | Google Meet, Zoom, MS Teams automated attendee |
| **Legacy Server** | Express + Sequelize (SQLite) | Node.js | Legacy pre-meeting briefing and email prototype (`server/`) |

### B.3 Environment Variables & Configuration

> **CRITICAL SECURITY REQUIREMENT:** Only variable names are documented below. Secret values, tokens, and private keys must never be committed to git.

#### Frontend Environment (`.env` in repository root, Vite)
- `VITE_SUPABASE_URL`: Supabase project URL (e.g., `https://<project-ref>.supabase.co`).
- `VITE_SUPABASE_ANON_KEY`: Supabase public anonymous API key.

#### Supabase Edge Function Secrets (Configured via `supabase secrets set`)
- `SUPABASE_URL`: Built-in Supabase service URL.
- `SUPABASE_ANON_KEY`: Built-in anonymous client key.
- `SUPABASE_SERVICE_ROLE_KEY`: Privileged service key for RLS bypass.
- `MEETINGBAAS_API_KEY`: API key for MeetingBaaS v2 bot dispatch and details.
- `MEETINGBAAS_API_BASE_URL`: Base URL (default: `https://api.meetingbaas.com`).
- `MEETINGBAAS_WEBHOOK_SECRET`: Callback secret for validating per-bot webhooks.
- `MEETINGBAAS_WEBHOOK_SIGNING_SECRET`: Svix secret for account-level lifecycle webhooks (`whsec_...`).
- `SPEECH_TO_TEXT_PROVIDER`: Configured as `elevenlabs`.
- `ELEVENLABS_MODEL_ID`: Default `scribe_v2` (or `scribe_v1`).
- `ELEVENLABS_API_KEY`: ElevenLabs API key with STT permissions.
- `ELEVENLABS_WEBHOOK_ID`: Webhook ID registered in ElevenLabs developer dashboard.
- `ELEVENLABS_WEBHOOK_SECRET`: HMAC signing secret for ElevenLabs webhook validation.
- `GEMINI_API_KEY`: Google AI Studio API key.
- `GEMINI_MODEL`: Default `gemini-1.5-flash`.
- `GEMINI_EMBEDDING_MODEL`: Default `gemini-embedding-001`.
- `EMBEDDING_DIMS`: Must be fixed to `768`.
- `CONTEXT_TOKEN_BUDGET`: Default `7000` tokens.
- `ENABLE_TASK_CARRYOVER`: Default `false`.
- `BOT_NAME`: Display name of the bot (e.g., "AI Meeting Assistant").
- `BOT_ENTRY_MESSAGE`: Chat message posted upon joining Google Meet / Teams calls.

---

### B.4 Database Schema, Migrations & Data Flow

#### Migration Ledger (Located in `supabase/migrations/`)
1. `0002_meetings.sql`: Initial meetings schema.
2. `0003_meetings_meeting_assistant.sql`: Adds bot metadata and status tracking.
3. `0004_transcript_segments_and_due_day.sql`: Introduces `transcript_segments` and action item due dates.
4. `0005_transcription_provider_metrics.sql`: Captures STT provider metadata and latency.
5. `20260608000000_init_schema.sql`: Core schema initialization.
6. `20260902000000_admin_bot_authorization.sql`: Scopes RLS to assigned owners; restricts writes to admins.
7. `20261003000000_context_management.sql`: Adds pgvector chunks, briefings, project associations, and task carryover.
8. `20261005000000_elevenlabs_transcription.sql`: Adds `meeting_transcription_jobs` table.
9. `20261005010000_transcript_provenance.sql`: Adds immutable raw source archive (`meeting_transcript_sources`).
10. `20261005020000_recording_access.sql`: Adds recording state tracking, download grants, and access audit.
11. `20261008000000_meeting_pipeline_integrity.sql`: Adds atomic transcript persistence RPC (`persist_meeting_transcript`) and 10-minute completion lease.
12. `20261013000000_planned_meetings.sql`: Adds `planned_meetings` table and pre-call linkage RPC (`link_planned_meeting`).
13. `20261014000000_project_documents.sql`: Adds `project_documents` and `project_document_revisions` tables with CAS update RPC (`update_project_document`).

#### Key Database Tables & Relationships
- **`public.profiles`**: Extends `auth.users` with `role` (`'admin'` or `'user'`), `name`, and timestamps.
- **`public.projects`**: Client-associated projects (`client_id`, `name`) for grouping meetings.
- **`public.meetings`**: Primary call records (`bot_id`, `user_id`, `project_id`, `status`, `recording_url`, `summary`, `action_items`).
- **`public.planned_meetings`**: Pre-scheduled meetings with agenda and scheduled times, linked to `meetings.id` via `linked_meeting_id`.
- **`public.transcript_segments`**: Diarized speaker turns (`speaker_label`, `text`, `start_seconds`, `end_seconds`, `words`).
- **`public.transcripts`**: Flat relational projection of transcript turns for display.
- **`public.action_items`**: Extracted tasks with `task`, `owner`, `due_day`, `status`, and deduplication `fingerprint`.
- **`public.briefings`**: AI pre-meeting briefings with citations, risks, open questions, and agenda suggestions.
- **`public.transcript_chunks`**: 768-dimensional vector embeddings of transcript segments for project RAG.
- **`public.meeting_transcription_jobs`**: Durable tracking of asynchronous ElevenLabs STT jobs.
- **`public.meeting_transcript_sources`**: Service-only immutable raw payload archive.
- **`public.project_documents`**: Project-scoped Markdown documents (`decisions`, `context`) with CAS versioning.

---

### B.5 Edge Functions, API Endpoints & Webhooks

| Function Name | JWT Verification | Allowed Roles | Description |
|---|---|---|---|
| `deploy-bot` | Enabled (`verify_jwt = true`) | Admin Only | Validates admin role, checks planned meeting constraints, calls MeetingBaaS v2 API to dispatch bot, and records row in `meetings`. Supports `DELETE` to eject bots. |
| `meetingbaas-webhook` | Disabled (`verify_jwt = false`) | MeetingBaaS Webhook | Receives recording completion, extracts signed audio URL, saves video metadata, and submits batch job to ElevenLabs. Validates HMAC/Svix signatures. |
| `elevenlabs-webhook` | Disabled (`verify_jwt = false`) | ElevenLabs Webhook | Validates raw-body HMAC signature, parses Scribe v2 diarization, runs deterministic assembly, commits transcript atomically, and invokes Gemini for summary/tasks. |
| `generate-briefing` | Enabled (`verify_jwt = true`) | Authenticated | Generates a project-level pre-meeting briefing using hybrid RAG (relational recent history + pgvector semantic retrieval). |
| `get-meeting-recording` | Enabled (`verify_jwt = true`) | Owner / Admin | Validates caller RLS, fetches fresh signed MP4 URL from MeetingBaaS, probes storage with byte-range GET, and returns playback URL or download grant. |
| `download-meeting-recording` | Disabled (`verify_jwt = false`) | Valid HMAC Grant | Verifies short-lived (2-min) HMAC grant token, checks user authorization, and streams MP4 bytes directly with attachment header. |
| `process-elevenlabs-transcription`| Enabled (`verify_jwt = true`) | Admin / Service | Recovery endpoint to reprocess saved transcription results without calling STT again. |

---

### B.6 Meeting Bot Lifecycle, Transcription & Summarization

1. **Dispatch:** Admin enters meeting URL $\rightarrow$ `deploy-bot` sends parameters to MeetingBaaS:
   - `recording_mode`: `"speaker_view"`
   - `transcription_enabled`: `false` (bypasses MeetingBaaS streaming STT)
   - `bot_name`: Configured name (e.g., "AI Meeting Assistant")
   - `entry_message`: Introductory chat post upon admittance.
2. **Call Ended:** Meeting concludes $\rightarrow$ MeetingBaaS fires `complete` webhook to `meetingbaas-webhook`.
3. **STT Dispatch:** Function saves video metadata and sends audio URL to ElevenLabs Scribe v2 (`POST https://api.elevenlabs.io/v1/speech-to-text`) with:
   - `diarize`: `true`
   - `timestamps_granularity`: `"word"`
   - `webhook`: `true` (pointing to `elevenlabs-webhook`)
4. **Assembly (Deterministic & Safe):**
   - ElevenLabs completes transcription and fires signed HMAC webhook.
   - Raw data archived to `meeting_transcript_sources`.
   - Pipeline assembly extracts words, merges turns only across non-overlapping gaps $\le 2$ seconds, and enforces strict acoustic voting for speaker names.
   - Gemini attribution pass is completely omitted (prevents hallucinations).
   - Atomic commit via `persist_meeting_transcript` under a 10-minute lease.
5. **AI Summarization & Task Extraction:**
   - Assembly triggers Gemini 1.5 Flash with structured system prompt.
   - Gemini returns JSON with executive summary, key topics, decisions, open questions, and deduplicated action items.
   - Action items committed via atomic RPC `context_persist_action_items`.
   - Realtime event triggers instant UI refresh on User and Admin Dashboards.

---

### B.7 Video Recording Access & Streaming Proxy

- **Expired Link Prevention:** Presigned S3/CloudFront URLs from MeetingBaaS expire after 4 hours (`X-Amz-Expires=14400`). Revora never relies on stored static links.
- **Probe on Playback:** `get-meeting-recording` performs a small range request (`Range: bytes=0-31`) to ensure the video has finished rendering before returning the URL.
- **Streaming Download Proxy:** Because storage does not expose permissive CORS for client-side blob downloads, `download-meeting-recording` acts as a streaming proxy. It checks a signed 2-minute HMAC grant and streams the bytes with `Content-Disposition: attachment; filename="meeting-{id}.mp4"`.

---

### B.8 Context Management, RAG & Briefings

- **Embedding Model:** Google `gemini-embedding-001` (Task type: `RETRIEVAL_DOCUMENT` for chunks, `RETRIEVAL_QUERY` for search queries).
- **Dimension:** Fixed at 768 dimensions.
- **Chunking Strategy:** Turns are packed up to 500 estimated tokens with a 1-turn sliding overlap. Turns exceeding limits are broken down by sentence, then word.
- **Hybrid Retrieval:**
  1. Materializes the 13 most recent meetings and open action items for the project.
  2. Embeds the upcoming meeting agenda/title.
  3. Pre-filters vector search strictly by `project_id` and `user_id` to prevent cross-tenant vector contamination.
  4. Google Gemini synthesizes an actionable pre-meeting briefing with citations to previous meeting IDs.

---

### B.9 Repository Directory Layout & Component Catalog

```
futurrizon/
├── .env.example                               Template for environment variable names
├── CONTEXT_MANAGEMENT.md                      In-depth guide for pgvector RAG & briefings
├── ELEVENLABS_TRANSCRIPTION.md                ElevenLabs Scribe v2 setup & batch webhook docs
├── MEETING_PIPELINE_FIXES.md                  Audit & technical report on transcription repairs
├── RECORDING_PIPELINE.md                      Video recording access & download streaming docs
├── TRANSCRIPT_QUALITY.md                      Diarization & deterministic assembly guidelines
├── README.md                                  High-level architectural overview & setup
├── decisions.md                               Architectural decision records (ADRs) & stakeholder log
├── context.md                                 Comprehensive technical & non-technical reference (this file)
├── package.json                               React 19, Vite, Tailwind CSS 4 configuration
├── vite.config.js                             Vite config with React and Tailwind v4 plugins
├── public/                                    Static assets and favicon
├── src/
│   ├── App.jsx                                Top-level router and layout routing
│   ├── main.jsx                               React DOM mounting
│   ├── index.css                              Tailwind 4 theme variables and global styles
│   ├── context/
│   │   └── AuthContext.jsx                    Supabase auth session, profile loading, and role state
│   ├── lib/
│   │   ├── supabaseClient.js                  Single client instance with local fallback
│   │   ├── meetingStatus.js                   Display helper for pipeline stages and badges
│   │   └── recordingAccess.js                 API helper for fetching playback and download grants
│   ├── pages/
│   │   ├── LandingPage.jsx                    Public landing page with product features
│   │   ├── UserDashboard.jsx                  User meeting feed, detail view, and planned meetings
│   │   ├── AdminDashboard.jsx                 Admin bot deployment, monitoring, and planned meetings
│   │   ├── LoginModal.jsx                     Auth modal for Google OAuth and email/password
│   │   └── SettingsPage.jsx                   User settings and profile configuration
│   └── components/
│       ├── AdminMeetingsPanel.jsx             Admin table monitor with real-time status updates
│       ├── PlannedMeetingsPanel.jsx           Admin and user manager for planned meetings & briefings
│       ├── ContextBriefingSection.jsx         Pre-meeting briefing viewer and generation trigger
│       ├── MeetingBotDeployer.jsx             Live bot URL input and dispatch trigger
│       ├── MeetingRecordingLink.jsx           Player modal launcher and download button
│       └── ActionItemCard.jsx                 Card UI for meeting action items and assignees
├── supabase/
│   ├── config.toml                            Edge Function definitions and JWT flags
│   ├── functions/
│   │   ├── deploy-bot/index.ts                Bot dispatch and planned-meeting linkage
│   │   ├── meetingbaas-webhook/index.ts       MeetingBaaS callback handler
│   │   ├── elevenlabs-webhook/index.ts        ElevenLabs STT completion handler
│   │   ├── generate-briefing/index.ts         AI briefing generation endpoint
│   │   ├── get-meeting-recording/index.ts     Recording probe and grant generator
│   │   ├── download-meeting-recording/index.ts Streaming MP4 attachment proxy
│   │   ├── process-elevenlabs-transcription/  Idempotent transcript reprocessor
│   │   └── _shared/                           Shared pipeline logic (assembly, auth, gemini, meetingbaas)
│   ├── migrations/                            Postgres database migration scripts (0002 through 20261014)
│   └── tests/                                 Test scripts for pipeline integrity and Edge Functions
└── server/                                    Legacy prototype Express/SQLite server (email scheduler)
```

---

### B.10 Error Handling, Security & Technical Debt

#### Error Handling Patterns
- **Database CAS Protection:** Critical updates (`planned_meetings` links, `project_documents`, `briefings`) use Compare-And-Swap (CAS) version checks or optimistic locking to prevent race conditions across serverless instances.
- **Provider Retries:** Webhooks and Gemini API requests utilize exponential backoff for HTTP 429 and 5xx errors.
- **Idempotent Webhooks:** Both MeetingBaaS and ElevenLabs webhook endpoints store completion state and idempotently exit if a completed meeting is redelivered.

#### Security & Privacy Considerations
- **No Client Secrets:** All sensitive API keys (`MEETINGBAAS_API_KEY`, `ELEVENLABS_API_KEY`, `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are stored in Supabase Edge Secrets. The frontend only holds the public anon key.
- **Row Level Security:** Strict database policies enforce that users can only query rows where `user_id = auth.uid()` or where an admin role is confirmed via `is_admin()`.
- **HMAC Signatures:** Download grants and ElevenLabs webhook calls are verified via HMAC-SHA256 signatures before any privileged logic executes.

#### Known Technical Debt
1. **Windows NPM Native Bindings:** Running `vite build` or `oxlint` on Windows produces an npm optional dependency resolution error (`@rolldown/binding-win32-x64-msvc` and `@oxlint/binding-win32-x64-msvc` missing). Development works via Vite dev server, but clean production builds require installing MSVC build tools or rebuilding `node_modules`.
2. **Lexical Migration Replay:** Running `supabase db reset` on a fresh database fails at `0004` due to historical migration ordering (`action_items` referenced before creation in `20260608000000_init_schema.sql`). Staging databases must apply migrations sequentially or use the preflight check in [CONTEXT_MANAGEMENT.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/CONTEXT_MANAGEMENT.md#L143-L150).
3. **Dual Email Architecture:** The Node.js scheduler in `server/scheduler.js` operates independently from Supabase. Production email dispatch should be consolidated into a serverless Edge Function.

---

## C. Non-Technical Context

### C.1 Team Roles & Stakeholders
- **Erva Savaliya (Project Lead / Core Developer):**
  - Architecture, Frontend, UI/UX, Google Authentication.
  - Meeting bot integration, Meet chat auto-entry message, call recording playback & download.
  - Transcript pipeline repairs, ElevenLabs Scribe v2 migration, Gemini summarization, and action items.
- **Rudri Kakadiya (Developer / Collaborator):**
  - Pre-meeting AI generated briefing email reminders.
  - Meeting calendar and attendee profile directory integration.
  - 1-hour automated meeting reminder scheduler (`server/scheduler.js`).
- **Organization / Institution:**
  - Developed for **Futurrizon Technologies Ltd**.

### C.2 Product Goals & Design Philosophy
- **Zero Friction for Attendees:** Attendees do not need to install browser extensions. An autonomous bot enters the meeting link directly and records the call.
- **Privacy First:** Meeting audio, video, transcripts, and AI notes are strictly private to the assigned user and organizational admins.
- **Aesthetic Excellence:** A modern, premium interface using Tailwind CSS, Outfit typography, smooth animations (Framer Motion), and distinct status indicators.

### C.3 Academic & Demonstration Context
- Demonstration criteria require showing:
  1. A bot successfully joining a live Google Meet or Zoom link.
  2. Posting an automated chat message in the meeting.
  3. Generating a clean, speaker-attributed transcript after the bot leaves.
  4. Generating executive summaries and actionable tasks.
  5. Generating a pre-meeting context briefing for an upcoming scheduled meeting.

---

## D. Current Implementation Status

### D.1 Completed and Verified Features
- [x] Admin bot deployment to Google Meet, Zoom, and MS Teams via MeetingBaaS.
- [x] Autonomous bot chat entry greeting in Google Meet.
- [x] Meeting recording capture in `speaker_view` MP4 format.
- [x] Asynchronous ElevenLabs Scribe v2 batch transcription pipeline.
- [x] Deterministic transcript assembly without LLM hallucination or speaker remapping.
- [x] Gemini 1.5 Flash summarization, decision tracking, and action-item extraction.
- [x] Supabase Auth with Google OAuth and email/password authentication.
- [x] Owner-scoped Row Level Security and admin access separation.
- [x] Real-time dashboard updates via Supabase Realtime channels.
- [x] In-app video recording playback and signed byte-range streaming MP4 downloads.

### D.2 Implemented but Pending Hosted Verification
- [ ] Execution of migration `20261013000000_planned_meetings.sql` on the live hosted Supabase instance.
- [ ] Execution of migration `20261014000000_project_documents.sql` on the live hosted Supabase instance.
- [ ] Live deployment of updated `deploy-bot` and `generate-briefing` Edge Functions with planned-meeting support.
- [ ] End-to-end verification of `PlannedMeetingsPanel.jsx` linking a planned row to a live dispatched bot on hosted database.

### D.3 Partially Implemented / Divergent Systems
- **Automated Email Reminder Pipeline:** Implemented in `server/scheduler.js` using local SQLite and Ethereal email; not yet migrated to a serverless Supabase Edge Function with live SMTP.

### D.4 Known Bugs & Blockers
- **Blocker 1 (Hosted DB Push):** Historical migration ordering prevents clean `supabase db reset`; new migrations must be applied manually via Supabase SQL Editor.
- **Blocker 2 (Local Windows Build):** Vite production build fails on Windows due to missing native binding `@rolldown/binding-win32-x64-msvc`. Does not affect Vite dev server.

### D.5 Prioritized Next Tasks
1. **Apply Pending Migrations:** Run `20261013000000_planned_meetings.sql` and `20261014000000_project_documents.sql` in the Supabase hosted SQL Editor.
2. **Deploy Updated Edge Functions:** Deploy `deploy-bot`, `generate-briefing`, and provider webhooks using the Supabase CLI.
3. **Verify Planned Meeting Flow:** Test creating a planned meeting in Admin Dashboard, generating its briefing, and dispatching a bot that links the meeting record.
4. **Consolidate Email Reminders:** Port Rudri's 1-hour email reminder logic from `server/scheduler.js` into a Supabase Edge Function invoked via `pg_cron` or scheduled webhook.

---

## E. AI Collaboration Guidelines

### E.1 Pre-Flight Rules for AI Assistants
1. **Read Before Writing:** Always review both [context.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/context.md) and [decisions.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/decisions.md) before proposing significant architectural modifications.
2. **Preserve Existing Architecture:** Do not suggest replacing Supabase with standard Express or introducing new cloud providers unless explicitly requested.
3. **Respect Settled Decisions:** Do not propose re-adding Gemini transcript re-attribution, Whisper Large v3, or streaming ElevenLabs integrations; these were evaluated and rejected (see [decisions.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/decisions.md)).

### E.2 Verification & Claim Standards
- **Never Fabricate Approval:** Only mark user decisions as "Approved" if verifiable in project files or conversation history. Otherwise, mark as "Pending My Approval".
- **Evidence-Based Claims:** Never claim a feature is "working" or "tested" unless it has been executed and confirmed with automated tests or user observation. Mark unverified code as "Implemented but pending hosted verification".
- **Absolute Secret Hygiene:** Never output secret values, private tokens, passwords, or live database credentials. Document environment variable names only.

### E.3 Maintenance Workflow
Whenever a significant architectural change, database schema migration, or new feature is approved:
1. Append the decision to [decisions.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/decisions.md) with ID, problem, alternatives, and user response.
2. Update the implementation status table and component list in [context.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/context.md).
3. Verify that relative markdown file links remain valid.
