# Revora — Architecture & Project Decisions Record (`decisions.md`)

This document is the canonical log of technical, architectural, and operational decisions for **Revora** (AI-Powered Live Meeting Assistant). It records problem contexts, AI-generated proposals, actual stakeholder responses, alternatives evaluated, trade-offs, and current statuses.

> **CRITICAL GROUND RULE FOR AI ASSISTANTS:**
> Distinguish actual stakeholder responses from AI proposals. Never fabricate approvals, opinions, or decisions. If a stakeholder decision or response cannot be verified with direct codebase or documented evidence, explicitly mark it as **"Pending My Approval"** or **"Unknown / Unverified"**.

---

## Decision Status Legend

- **Approved**: Verified decision explicitly confirmed or implemented and accepted by project author/team.
- **Proposed**: Recommended approach drafted by AI or team member, awaiting explicit stakeholder confirmation.
- **Pending My Approval**: Active proposal requiring user review before implementation or deployment.
- **Rejected**: Evaluated and explicitly dismissed.
- **Superseded**: Previously adopted decision replaced by a newer decision (with documented rationale).

---

## Decision Index

| ID | Date | Topic | Status | Primary Stakeholder |
|---|---|---|---|---|
| [DEC-001](#dec-001-primary-transcription-engine-selection-whisper-vs-meetingbaas-vs-elevenlabs) | 2026-09 / 2026-10-05 | Primary Transcription Engine Selection (Whisper vs. MeetingBaaS vs. ElevenLabs) | **Approved** | Erva Savaliya |
| [DEC-002](#dec-002-managed-meetingbaas-elevenlabs-vs-direct-asynchronous-batch-scribe-v2) | 2026-10-05 | Managed MeetingBaaS ElevenLabs vs. Direct Asynchronous Batch Scribe v2 | **Approved** | Technical AI / Erva Savaliya |
| [DEC-003](#dec-003-backend-architecture-migration-expresssqlite-to-supabase-edge-functions) | 2026-09-02 | Backend Architecture: Express/SQLite vs. Supabase Edge Functions | **Approved** (Dual State) | Erva Savaliya / Rudri Kakadiya |
| [DEC-004](#dec-004-transcription-pipeline-repair-speaker-attribution-and-removal-of-gemini-stt-remapping) | 2026-10-08 | Transcription Pipeline Repair & Elimination of Gemini STT Attribution Pass | **Approved** | Technical AI / Erva Savaliya |
| [DEC-005](#dec-005-recording-access-playback-and-streaming-download-architecture) | 2026-10-05 / 2026-10-08 | Video Recording Playback & Signed Byte-Range Streaming Downloads | **Approved** | Technical AI / Erva Savaliya |
| [DEC-006](#dec-006-context-management-hybrid-rag-chunking-and-bounded-briefing-generation) | 2026-10-03 | Context Management: pgvector Chunks, Token Budgets & Bounded Briefings | **Approved** | Technical AI / Erva Savaliya |
| [DEC-007](#dec-007-pre-meeting-briefing-mail-and-reminder-pipeline-dual-implementation) | 2026-09 / 2026-10 | Pre-Meeting Briefing Email & Meeting Reminders (Nodemailer vs. Supabase) | **Pending My Approval** | Rudri Kakadiya / Erva Savaliya |
| [DEC-008](#dec-008-planned-meetings-and-pre-call-bot-dispatch-linkage) | 2026-10-13 | Planned Meetings Schema, Feed & Bot Dispatch Linkage | **Approved** (Code Ready) | Technical AI (Astra) / Erva Savaliya |
| [DEC-009](#dec-009-database-storage-for-project-decisions-and-context-project_documents) | 2026-10-14 | In-Database Versioned Storage for Project Documentation (`project_documents`) | **Pending My Approval** | GPT-6 Astra / User Confirmation |
| [DEC-010](#dec-010-row-level-security-and-elimination-of-null-owner-meetings) | 2026-09-02 | RLS Scoping: Restricting Meeting Access and Revoking Public Anon Fallback | **Approved** | Erva Savaliya |

---

## Detailed Decisions

### DEC-001: Primary Transcription Engine Selection (Whisper vs. MeetingBaaS vs. ElevenLabs)

- **Date:** September 2026 – October 5, 2026
- **Topic & Context:** Speech-to-Text (STT) provider for meeting recordings across Google Meet, Zoom, and MS Teams.
- **Problem:** Accurate transcription with diarization and low hallucination was proving extremely difficult. Initial prototype transcripts were noisy and attributed improperly.
- **AI Recommendation:** Initially recommended leveraging Whisper Large v3 or built-in MeetingBaaS transcriptions.
- **My Actual Response (Erva Savaliya):** Explicitly tested `whisper-large-v3` for transcription, but rejected it because it produced messy and inaccurate transcripts in testing. Returned to MeetingBaaS, and subsequently migrated to ElevenLabs Scribe v2.
  > *Direct Evidence (`Report_revora.txt`):* `"Erva Savaliya - once tried using whisper-large-v3 for transcript but switched back to meetingbaas because it washnt providing proper transcript... proper & accurate transcript and recording is very difficult."*
- **Final Agreed Decision:** Revora uses **ElevenLabs Scribe v2** (`scribe_v2`) as the default batch transcription engine. MeetingBaaS captures call audio/video, and the audio artifact is routed to ElevenLabs.
- **Alternatives Considered:**
  1. *OpenAI Whisper Large v3:* Rejected after testing due to poor formatting, messy diarization, and hallucination on meeting audio.
  2. *MeetingBaaS Native Managed Transcription (Gladia/Deepgram):* Held as fallback; bypassed in favor of Scribe v2 for improved diarization accuracy.
- **Status:** **Approved** (Implemented in [supabase/functions/_shared/meetingbaas.ts](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/supabase/functions/_shared/meetingbaas.ts), [supabase/functions/elevenlabs-webhook/index.ts](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/supabase/functions/elevenlabs-webhook/index.ts)).
- **Related Files:** [ELEVENLABS_TRANSCRIPTION.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/ELEVENLABS_TRANSCRIPTION.md), [TRANSCRIPT_QUALITY.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/TRANSCRIPT_QUALITY.md).

---

### DEC-002: Managed MeetingBaaS ElevenLabs vs. Direct Asynchronous Batch Scribe v2

- **Date:** 2026-10-05
- **Topic & Context:** Integration protocol between MeetingBaaS recording output and ElevenLabs STT API.
- **Problem:** MeetingBaaS offers a managed ElevenLabs integration, but it operates **streaming-only** and requires a persistent public WebSocket endpoint. Supabase Edge Functions run serverless on Deno and do not maintain long-running WebSocket connections.
- **AI Recommendation:** Do not use MeetingBaaS's managed ElevenLabs streaming configuration. Instead, configure MeetingBaaS to disable native transcription (`transcription_enabled: false`), take the completed audio MP4/FLAC URL from MeetingBaaS webhook completion, and submit it asynchronously to ElevenLabs's batch API (`POST https://api.elevenlabs.io/v1/speech-to-text`) with `webhook=true` pointing to `elevenlabs-webhook`.
- **My Actual Response:** Approved and implemented. Code deployed into Edge Functions.
- **Final Agreed Decision:** MeetingBaaS acts strictly as meeting bot and recorder (`recording_mode: "speaker_view"`). Post-meeting audio URL is pushed to ElevenLabs batch API with HMAC signature verification on webhook completion.
- **Alternatives Considered:**
  1. *MeetingBaaS Managed Streaming:* Rejected because hosting a 24/7 WebSocket receiver contradicts the serverless Supabase Edge Function architecture.
  2. *Synchronous Edge Function Processing:* Rejected due to Supabase Edge Function timeout limits (150s) on long meeting recordings.
- **Status:** **Approved** (Implemented in [supabase/functions/deploy-bot/index.ts](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/supabase/functions/deploy-bot/index.ts), [supabase/functions/meetingbaas-webhook/index.ts](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/supabase/functions/meetingbaas-webhook/index.ts)).
- **Related Files:** [ELEVENLABS_TRANSCRIPTION.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/ELEVENLABS_TRANSCRIPTION.md).

---

### DEC-003: Backend Architecture Migration: Express/SQLite to Supabase Edge Functions

- **Date:** 2026-09-02 (Init) – Ongoing
- **Topic & Context:** Server runtime and database architecture for Revora.
- **Problem:** The initial project contained a legacy Node.js Express server with SQLite and Sequelize (`server/`), featuring local hardcoded admin credentials and local cron schedulers. It did not scale for real-time client updates, multi-tenant auth, or cloud bot webhooks.
- **AI Recommendation:** Migrate core backend functionality to **Supabase** (Postgres, Row Level Security, Supabase Auth, Realtime, and Deno Edge Functions).
- **My Actual Response:** Approved and largely executed for bot deployment, meeting management, transcription webhooks, and AI analysis. However, the Express/SQLite folder was preserved under `server/` to retain Rudri Kakadiya's email scheduler and test briefing routes.
- **Final Agreed Decision:** **Dual State**:
  - The *production operational architecture* is Supabase (Vite React frontend communicating directly with Supabase Postgres and Edge Functions).
  - The *legacy prototype* under `server/` remains in the codebase for local email testing (Nodemailer + Ethereal), but is NOT used in the primary live bot flow.
- **Status:** **Approved** (Production on Supabase, Legacy intact).
- **Related Files:** [README.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/README.md#L20-L34), [server/index.js](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/server/index.js), [src/lib/supabaseClient.js](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/src/lib/supabaseClient.js).

---

### DEC-004: Transcription Pipeline Repair, Speaker Attribution, and Removal of Gemini STT Remapping

- **Date:** 2026-10-08
- **Topic & Context:** Erroneous speaker labeling, cut utterances, duplicate segments, and Gemini hallucinations in meeting transcripts.
- **Problem:** Previous pipeline passes passed transcript segments to Google Gemini to "re-attribute" or infer who was speaking. Gemini hallucinated identities, reassigned real quotes, and scrambled turn order. Furthermore, segment cuts were arbitrary (every 45 words or 4 seconds), breaking natural speech.
- **AI Recommendation:**
  1. Completely remove the Gemini attribution pass. Gemini must NEVER edit or reassign transcript speech or speaker identities.
  2. Treat provider (Scribe v2) speaker IDs as authoritative.
  3. Enforce strict acoustic voting: a participant timeline name is only attached to a Scribe speaker cluster if there is $\ge 2$ seconds of evidence, $\ge 90\%$ agreement, and $\ge 70\%$ speech coverage. Otherwise, preserve stable labels like `Speaker 1`, `Speaker 2`.
  4. Enforce atomic persistence via database RPC `persist_meeting_transcript` with a 10-minute completion lease to prevent race conditions.
  5. Gemini is strictly restricted to downstream summarization and action-item extraction.
- **My Actual Response:** Confirmed and applied in migration `20261008000000_meeting_pipeline_integrity.sql` and shared pipeline code.
- **Final Agreed Decision:** Deterministic assembly only; no LLM rewriting of raw transcripts. Atomic persistence to `transcript_segments` and `transcripts`.
- **Status:** **Approved** (Implemented in [supabase/migrations/20261008000000_meeting_pipeline_integrity.sql](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/supabase/migrations/20261008000000_meeting_pipeline_integrity.sql), [supabase/functions/_shared/pipeline-assembly.ts](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/supabase/functions/_shared/pipeline-assembly.ts)).
- **Related Files:** [MEETING_PIPELINE_FIXES.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/MEETING_PIPELINE_FIXES.md), [TRANSCRIPT_QUALITY.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/TRANSCRIPT_QUALITY.md).

---

### DEC-005: Recording Access, Playback, and Streaming Download Architecture

- **Date:** 2026-10-05 – 2026-10-08
- **Topic & Context:** In-app video playback and video file downloading.
- **Problem:** The dashboard recording button failed with generic error messages ("Could not reach the recording service"). Cached provider S3/CloudFront URLs expired after 4 hours (`X-Amz-Expires=14400`). Furthermore, HEAD requests on signed GET URLs returned 403, and video storage lacked browser-fetch CORS headers, preventing client-side `fetch()` / blob downloads.
- **AI Recommendation:**
  1. Build `get-meeting-recording` Edge Function to check caller auth, verify ownership/admin role, fetch fresh bot details from MeetingBaaS, probe the MP4 header with a small byte-range GET (`Range: bytes=0-31`), and return an active playback URL.
  2. Build `download-meeting-recording` Edge Function to stream actual MP4 bytes with `Content-Disposition: attachment` via a short-lived (2-minute) HMAC-signed grant token, avoiding any client-side CORS dependencies or whole-file memory buffering.
- **My Actual Response:** Approved and implemented in `supabase/functions/get-meeting-recording` and `download-meeting-recording`.
- **Final Agreed Decision:** Dynamic URL refresh with server-proxied streaming download; no persistent storage of raw presigned links.
- **Status:** **Approved** (Implemented in [supabase/functions/get-meeting-recording/index.ts](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/supabase/functions/get-meeting-recording/index.ts), [supabase/functions/download-meeting-recording/index.ts](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/supabase/functions/download-meeting-recording/index.ts), [src/components/MeetingRecordingLink.jsx](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/src/components/MeetingRecordingLink.jsx)).
- **Related Files:** [RECORDING_PIPELINE.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/RECORDING_PIPELINE.md), [MEETING_PIPELINE_FIXES.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/MEETING_PIPELINE_FIXES.md).

---

### DEC-006: Context Management: pgvector Chunks, Token Budgets & Bounded Briefings

- **Date:** 2026-10-03
- **Topic & Context:** Cross-meeting project context, RAG embeddings, and automated pre-meeting briefing generation.
- **Problem:** When preparing for upcoming meetings, users lacked context from prior discussions on the same project. Naive prompt injection risked exceeding context windows or mixing cross-client data.
- **AI Recommendation:**
  1. Install `pgvector` in Supabase Postgres under schema `extensions`.
  2. Use Google `gemini-embedding-001` with fixed 768 dimensions (`EMBEDDING_DIMS=768`).
  3. Pre-filter candidate chunks strictly by project and owner before running cosine distance sorting, preventing approximate vector search under-fill.
  4. Chunk transcripts to $\le 500$ estimated tokens with 1-turn overlap.
  5. Enforce strict prompt token budget (`CONTEXT_TOKEN_BUDGET=7000`).
  6. Atomic action-item carryover guarded by partial index and exact transcript citations.
- **My Actual Response:** Approved and checked in as migration `20261003000000_context_management.sql` and Edge Function `generate-briefing`.
- **Final Agreed Decision:** Project-scoped, owner-filtered RAG pipeline with deterministic input hashing and caching.
- **Status:** **Approved** (Implemented in [supabase/migrations/20261003000000_context_management.sql](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/supabase/migrations/20261003000000_context_management.sql), [supabase/functions/generate-briefing/index.ts](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/supabase/functions/generate-briefing/index.ts)).
- **Related Files:** [CONTEXT_MANAGEMENT.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/CONTEXT_MANAGEMENT.md).

---

### DEC-007: Pre-Meeting Briefing Email and Reminder Pipeline (Dual Implementation)

- **Date:** September – October 2026
- **Topic & Context:** Sending scheduled pre-meeting emails and reminder notifications to attendees.
- **Problem:** Rudri Kakadiya built a local Node.js scheduler (`server/scheduler.js`) using `node-cron` (every minute check for meetings within 1 hour) and `nodemailer` with Ethereal test accounts. However, this required running a dedicated Node server alongside Supabase.
- **AI Recommendation:** Consolidate automated briefing generation and email reminders into Supabase scheduled functions (pg_cron or edge invocations) and integrate a production transactional email provider (e.g., Resend or SendGrid) using attendee profiles stored in Supabase.
- **My Actual Response:** **Pending Confirmation / Dual State:**
  - Rudri's implementation remains in `server/scheduler.js` and `server/mailer.js`.
  - Supabase-native email dispatch is not yet wired to a live email provider.
- **Final Agreed Decision:** Documented as an unresolved architectural divergence. The Node.js Express scheduler represents the prototype implementation, while Supabase Edge Functions represent the target platform architecture.
- **Alternatives Considered:**
  1. *Host Node Express server continuously on Render/Railway:* Keeps Rudri's code unchanged, but adds hosting complexity.
  2. *Supabase pg_cron + Edge Function + Resend:* Unified serverless architecture.
- **Status:** **Pending My Approval** (Awaiting decision on whether to retire `server/` or deploy it).
- **Related Files:** [server/scheduler.js](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/server/scheduler.js), [server/mailer.js](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/server/mailer.js).

---

### DEC-008: Planned Meetings and Pre-Call Bot Dispatch Linkage

- **Date:** 2026-10-13
- **Topic & Context:** Allowing users and admins to schedule upcoming meetings in advance, generate briefings prior to the call, and seamlessly link the planned row when deploying the MeetingBaaS bot.
- **Problem:** Previously, meetings only existed in the database after a bot was dispatched or an ad-hoc meeting ID was created. Users could not plan agendas in advance or view briefings for unstarted calls.
- **AI Recommendation (Astra):**
  1. Add `planned_meetings` table with RLS, project references, agenda, and scheduled time.
  2. Extend `deploy-bot` Edge Function to accept `planned_meeting_id`, link it atomically via RPC `link_planned_meeting`, and prevent double-dispatch.
  3. Add `PlannedMeetingsPanel.jsx` to the Admin Dashboard and an upcoming meetings feed to `UserDashboard.jsx`.
- **My Actual Response:** Approved; Astra implemented the frontend panels and Edge Function updates, and created migration `20261013000000_planned_meetings.sql`.
- **Final Agreed Decision:** Planned meetings are first-class entities with dedicated pre-meeting briefings that link directly to live meeting records upon bot dispatch.
- **Status:** **Approved (Code Complete, Migration Pending Live Execution)**.
- **Related Files:** [supabase/migrations/20261013000000_planned_meetings.sql](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/supabase/migrations/20261013000000_planned_meetings.sql), [src/components/PlannedMeetingsPanel.jsx](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/src/components/PlannedMeetingsPanel.jsx), [supabase/functions/deploy-bot/index.ts](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/supabase/functions/deploy-bot/index.ts).

---

### DEC-009: Database Storage for Project Decisions and Context (`project_documents`)

- **Date:** 2026-10-14
- **Topic & Context:** Storing and synchronizing `decisions.md` and `context.md` inside PostgreSQL for AI assistants and edge functions.
- **Problem:** Edge Functions and frontend clients cannot read local workspace Markdown files in deployed environments.
- **AI Recommendation (GPT-6 Astra):** Created migration `supabase/migrations/20261014000000_project_documents.sql` introducing `public.project_documents` and `public.project_document_revisions` with CAS RPC `update_project_document`.
- **My Actual Response:** **Pending My Confirmation / Interrupted**:
  Astra was interrupted immediately after drafting `20261014000000_project_documents.sql`. The user specifically instructed to maintain canonical `decisions.md` and `context.md` in the Revora project folder.
- **Final Agreed Decision:** The canonical source of truth for developer and AI collaboration is stored directly in the repository filesystem as [decisions.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/decisions.md) and [context.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/context.md). The `project_documents` SQL migration is preserved as an optional database feature for project-scoped UI syncing, but local files remain authoritative for code pair-programming.
- **Status:** **Pending My Approval** (Schema drafted, local markdown canonical).
- **Related Files:** [supabase/migrations/20261014000000_project_documents.sql](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/supabase/migrations/20261014000000_project_documents.sql).

---

### DEC-010: Row Level Security and Elimination of NULL-Owner Meetings

- **Date:** 2026-09-02
- **Topic & Context:** Multi-tenant meeting privacy and access control.
- **Problem:** Early database schema allowed `meetings.user_id` to be NULL and granted wide read permissions to the `anon` role, exposing transcripts and recordings across users.
- **AI Recommendation:** Enforce strict RLS policies:
  1. `meetings.user_id = auth.uid()` for read access by regular users.
  2. Admins (`profiles.role = 'admin'`) can view and manage all meetings.
  3. Revoke insert/update/delete from `anon` and `public`.
  4. Require `deploy-bot` to resolve a valid owner UUID before dispatching a bot.
- **My Actual Response:** Approved and applied in `20260902000000_admin_bot_authorization.sql`.
- **Final Agreed Decision:** Zero anonymous access. Owner-scoped reading enforced at the database layer.
- **Status:** **Approved** (Implemented in [supabase/migrations/20260902000000_admin_bot_authorization.sql](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/supabase/migrations/20260902000000_admin_bot_authorization.sql)).
- **Related Files:** [README.md](file:///e:/OneDrive/Desktop/revora_cooking/futurrizon/README.md#L126-L134).

---

## Maintenance Guidelines for Future AI Assistants

1. **Verify Before Recording**: Always confirm whether a decision was explicitly agreed upon by the user (Erva Savaliya / Rudri Kakadiya) or proposed by an AI assistant.
2. **Never Overwrite Historical Records**: When a decision changes, do not erase the previous entry. Set its status to **Superseded**, reference the new Decision ID, and record the rationale for the change.
3. **Format Standard**: Every decision must include:
   - Unique ID (`DEC-XXX`) and Date.
   - Topic & Context.
   - Problem / Question.
   - AI Recommendation.
   - Actual User Response.
   - Final Agreed Decision & Rationale.
   - Alternatives Considered.
   - Status & Related Files.
