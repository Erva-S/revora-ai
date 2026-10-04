# Revora context management

## Implementation and Phase 0 reconciliation

This adds project history, transcript chunking/embeddings, owner-scoped retrieval,
briefings, and persistent action items to the existing Supabase pipeline.
No live database was accessed or deployed to during implementation. The requested
schema queries were provided before editing. The subsequent instruction to
continue supplied no results, so the migration uses defensive preflight checks.
The repeatable read-only inventory is `supabase/context_preflight.sql`.

Confirmed from all six existing migrations, both functions, and the requested UI:

- `meetings.id` is UUID; `bot_id` has a unique index. The two historical CREATE
  statements disagree about bot nullability and `scheduled` status.
- The latest authorization migration makes `meetings.user_id` the assigned reader,
  with an admin override. Meeting/task writes are admin-only. Earlier null-owner
  and anon policies are superseded by that migration.
- `transcripts.timestamp` is insertion time. Existing rows have no turn index.
  `transcript_segments` supplies ordered speaker/text/second-based times.
- The webhook already guards duplicate completions, transcript length, and status
  ordering. These guards, assembly and `callGemini` are unchanged.
- Summaries are deleted/reinserted. Previously, tasks were deleted/reinserted
  only for a nonempty new analysis; an empty result left old tasks behind.
- `key_topics` was generated but discarded; `open_questions` was absent.
- There is no checked-in client/project/organization schema. Existing briefings
  are templated Express/SQLite records with missing Sequelize model fields.
- User/admin result modals display the existing `meetings.action_items` mirror;
  `ActionItemCard` provides no editor. The Express flows remain intact.

### Database prerequisites and defensive behavior

The migration must run after the existing schema and admin authorization migration.
It requires `due_day`, `transcript_segments`, `started_at`, existing UUID keys,
`is_admin(uuid)`, and `set_updated_at()`. It verifies additive column types.
It refuses unrelated same-named clients/projects/briefings/chunks or context RPCs,
and refuses a vector installation outside `extensions`. Reconcile such a failure
with the inventory before adapting the file; it does not overwrite those objects.
Its own new tables/functions are marked with a migration comment for safe replay.

**`supabase db reset` is already broken on an empty database:** lexical replay hits
`0004_transcript_segments_and_due_day.sql` before `action_items` is created by
`20260608000000_init_schema.sql`. The new last-sorting migration cannot fix that.
Also, the CHECK created in 0002 excludes `scheduled`; the later CREATE IF NOT EXISTS
does not replace it. Neither existing migration nor constraint was changed.
The isolated database test deliberately creates its empty fixture with init before
0004, and separately proves the unmodified lexical replay failure.

## Behavior and intentional adaptations

1. **Atomic task RPC:** `context_persist_action_items` uses the partial unique index
   with `ON CONFLICT (...) WHERE fingerprint IS NOT NULL`. A plain PostgREST upsert
   cannot supply that predicate. The SQL guard prevents overwriting manual rows
   even during concurrent edits. It adopts matching legacy row IDs, removes only
   absent AI rows (including on empty analysis), and never creates another task table.
2. **Lease-fenced chunk RPC:** `context_commit_chunks` atomically commits changed
   chunks, removes excess indexes, and marks ready only for the current lease.
   Stale workers cannot write or mark a newer run failed. Both helper RPCs are
   SECURITY INVOKER, service-role-only, with a fixed search path.
3. **Exact retrieval:** the HNSW index exists, but retrieval deliberately materializes
   the project/owner-filtered candidate set before exact cosine sorting. This avoids
   approximate post-filter under-fill without depending on a pgvector version.
   An extra `embedding_model` result field prevents mixing model spaces.
4. **Null-owner targets:** the retrieval RPC additionally derives ownership from
   the excluded target, including `user_id IS NULL`. A null owner on a target never
   means all project owners. Only explicit admin project-level briefings use all owners.
5. **Cache/race protection:** hashes include the requested source versions, task
   IDs/status, and agenda, plus target/project/owner/title/date and the bounded context.
   A unique scope/hash index and compare-and-set claims prevent duplicate generation.
   Refresh regenerates the same input row; different inputs create another history row.
   Ownership/project changes hide stale saved briefings through RLS; access is checked
   again before returning generated or cached content.
6. **Chunk hash:** includes text/model/dimensions/version plus header, attribution,
   and timing metadata, so changed meeting titles or timestamps do not retain stale
   embeddings. A ready unchanged index is a true no-op (no writes or API calls).
7. **Chunk boundaries:** consecutive turns are packed to at most 500 estimated tokens
   with one-turn overlap where it fits alongside new content. Over-cap turns split
   by sentence; an over-cap sentence falls back to words/characters. Sub-parts retain
   original timing ranges rather than fabricated timestamps. Chunks under 40 chars
   are skipped. More than 400 chunks fails explicitly and preserves the previous
   index instead of silently truncating history.
8. **Bounded backfill:** `{backfill:true}` processes up to two meetings concurrently
   and returns `has_more`/`next_cursor`. Repeat with `cursor` to finish the dataset.
   This avoids an unbounded edge invocation. Individual failures are returned per ID.
9. **Fixed database dimensions:** `EMBEDDING_DIMS` is configurable but must equal 768
   for this migration. Other values fail clearly; they do not silently alter vector
   storage. Reindex all meetings when changing embedding models.
10. **Briefing citations:** narrative arrays use `{text, meeting_ids}` objects.
    Unknown meeting/task IDs are removed. Task names, assignees, dates and statuses
    are hydrated from the bounded database context, not trusted from model output.
11. **Carryover:** optional and disabled by default. At most 30 owner/project-scoped
    open AI tasks are supplied to the existing Pass 2 call. Updates require known IDs
    and a substantive verbatim quote from the current transcript. SQL repeats scope
    and manual-write checks. Older meeting mirrors are updated for applied statuses;
    the current meeting's mirror remains the same freshly extracted array as before.
12. **Missing migration:** optional transcript/summary writes retry the legacy shape.
    Task persistence falls back to the original path only after confirming the new
    columns are absent; other failures preserve task rows. Deployment without a
    project remains the original path. A requested project is validated before
    dispatch, with a clear error if assignment is not installed.
13. **No automatic historical re-analysis:** backfill indexes existing transcripts.
    Old `key_topics`/`open_questions` default to empty, and existing duplicate summary
    rows remain. Briefings choose the latest summary deterministically. The explicit
    transcript row backfill is separate and reports mismatches; it refuses incoming
    foreign keys to transcript IDs before rebuilding rows.

New context errors are logged as generic messages/codes, without prompts, provider
bodies, signed URLs, or keys. Index dispatch is inside a background promise registered
with `EdgeRuntime.waitUntil`; its failure cannot change the meeting lifecycle status.

## Configuration

Use Supabase Edge secrets, **not VITE-prefixed variables**:

| Variable | Default / meaning |
| --- | --- |
| `GEMINI_API_KEY` | Existing secret, reused |
| `GEMINI_MODEL` | Existing override; same valid model chain as webhook |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` |
| `EMBEDDING_DIMS` | `768`; must match the database |
| `CONTEXT_TOKEN_BUDGET` | `7000`; 1000–32000 allowed; chars/4 estimate includes prompt |
| `ENABLE_TASK_CARRYOVER` | `false`; only literal `true` enables it |

The new functions require Supabase's built-in URL, anon key and service-role key.
Gateway JWT verification is enabled for both. The indexer accepts the actual
service-role bearer or a verified admin user JWT; backfill requires the admin user
JWT. Briefing generation requires a verified user, reads the target under that
user's RLS, and limits project-only requests to admins.

Google's official [embeddings documentation](https://ai.google.dev/gemini-api/docs/embeddings)
was checked on 2026-10-03 and still documents `gemini-embedding-001`, 768-dimensional
output, retrieval task types and normalization of truncated embedding-001 vectors.
The transport uses `v1beta/models/...:batchEmbedContents`, at most 100 requests per
batch and two concurrent batches. 429/network/5xx errors retry with bounded backoff.
Text generation uses the copied webhook model chain with JSON responses at 0.2.
Index embedding work has a 100-second budget; briefing query embedding has 20 seconds
before relational fallback, leaving 100 seconds for text-model attempts.

## Deployment commands (provided, not executed)

Run from the repository root. Set database URLs/project refs explicitly for the
environment being deployed. First inspect the live inventory and migration history:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/context_preflight.sql
supabase migration list --db-url "$DATABASE_URL"
```

For an existing database with the prerequisites already applied, apply **only the
new migration**. On a disposable/staging database, run it twice to confirm replay:

```bash
psql "$STAGING_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261003000000_context_management.sql
psql "$STAGING_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261003000000_context_management.sql
```

After reconciling any preflight failure, use the same single-file command for the
intended deployed database. If applying SQL directly rather than through the CLI,
record it in Supabase's migration history **after successful application**:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261003000000_context_management.sql
supabase migration repair 20261003000000 --status applied --db-url "$DATABASE_URL"

supabase secrets set GEMINI_EMBEDDING_MODEL=gemini-embedding-001 EMBEDDING_DIMS=768 CONTEXT_TOKEN_BUDGET=7000 ENABLE_TASK_CARRYOVER=false --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy index-meeting-context --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy generate-briefing --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy deploy-bot --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy meetingbaas-webhook --no-verify-jwt --project-ref "$SUPABASE_PROJECT_REF"
npm run build
```

Deploy the built frontend through the existing hosting process. No auth or routing
configuration changes are required. The existing Gemini secret is reused.

### Backfill and manual requests

Optional transcript-row ordering backfill (rebuilds IDs only for matching counts;
transactional locks block writes while it runs, so use a low-activity window):

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/context_transcript_backfill.sql
```

Index existing meetings using an administrator's access token:

```bash
curl --fail-with-body "$SUPABASE_URL/functions/v1/index-meeting-context" \
  -H "Authorization: Bearer $ADMIN_JWT" -H "apikey: $SUPABASE_ANON_KEY" \
  -H 'Content-Type: application/json' --data '{"backfill":true}'
```

While `has_more` is true, send `{"backfill":true,"cursor":"RETURNED_NEXT_CURSOR"}`.
Retry reported failures by ID after resolving their error. Meetings need not have
a project to be indexed; assign a project before generating their briefing.

```bash
curl --fail-with-body "$SUPABASE_URL/functions/v1/index-meeting-context" \
  -H "Authorization: Bearer $ADMIN_JWT" -H "apikey: $SUPABASE_ANON_KEY" \
  -H 'Content-Type: application/json' --data '{"meeting_id":"MEETING_UUID"}'

curl --fail-with-body "$SUPABASE_URL/functions/v1/generate-briefing" \
  -H "Authorization: Bearer $USER_JWT" -H "apikey: $SUPABASE_ANON_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"meeting_id":"MEETING_UUID","agenda":"Release readiness","refresh":false}'
```

The UI provides project/client creation and assignment in admin meeting details,
an optional deployment project, and Generate/Refresh/history/source links in both
meeting detail views. Project-only briefings are an admin API capability.

## Local verification

No Docker, psql or Supabase database instance was available in the implementation
environment. Database tests used **PGlite PostgreSQL 17.5 with actual pgvector**, not
a SQL mock. Supabase Auth identity is emulated with SQL roles/`auth.uid()`; gateway
and provider calls are mocked in the Deno tests. Run these from the repository root:

```bash
npm run build
npm run lint
deno check --no-lock supabase/functions/index-meeting-context/index.ts supabase/functions/generate-briefing/index.ts supabase/functions/meetingbaas-webhook/index.ts supabase/functions/deploy-bot/index.ts
deno test --no-lock --node-modules-dir=none --allow-env --import-map=supabase/tests/import_map.json supabase/tests/context.test.ts supabase/tests/webhook.test.ts
```

The test-only import map captures `serve` callbacks; never use it for deployment.
For database tests, install the isolated test dependency outside the workspace
(the harness used `/tmp/omnirush`, which already existed):

```bash
npm install --prefix /tmp/omnirush --no-save --package-lock=false --no-audit --no-fund @electric-sql/pglite@0.3.14
PGLITE_MODULE=file:///tmp/omnirush/node_modules/@electric-sql/pglite/dist/index.js \
PGLITE_VECTOR_MODULE=file:///tmp/omnirush/node_modules/@electric-sql/pglite/dist/vector/index.js \
node --test supabase/tests/context_database.test.mjs
```

### Verification report

Final local run: **12 Deno tests and 11 PostgreSQL tests passed**, all four Edge
Functions passed `deno check`, and build/lint exited successfully. No package manifest
or lockfile changes were required; missing Linux native tooling was installed locally
to make the existing Windows-origin dependency checkout executable in this environment.

“FAIL / unverified” below means no live evidence was available, not an observed
production failure. Nothing was run against production.

| Requested verification | Result and evidence |
| --- | --- |
| Phase 0 findings and reconciliation documented | **PASS** for repository inspection/defensive preflight; **FAIL / unverified** for live-schema reconciliation because no query output was supplied |
| Existing behavior preserved; limited webhook diff | **PASS**: reviewed diff; actual-handler tests exercise migrated and unmigrated completion, failed indexing, and both duplicate guards. Assembly, `callGemini`, status mapping and length guard unchanged |
| No new table conflicts | **PASS** against repository/PG17 fixture; migration refuses unrecognized existing names. Live schema remains unverified |
| RLS enabled/tested on every new table; no anon | **PASS** on PG17: owner/admin access, cross-owner/client filtering, no anon reads, no authenticated briefing writes/TRUNCATE, service-only retrieval |
| New functions configured and securely authenticated | **PASS**: config entries, Deno typecheck, verified-user/service-secret tests, target RLS and admin-only project/backfill branches |
| No secrets added/logged by new code; env documented | **PASS**: diff review; placeholder-only tests; generic transport errors; variables above and in `.env.example` |
| `npm run build` and `npm run lint` | **PASS** (lint has pre-existing warnings; build has bundle-size notice) |
| Deployment commands and rollback notes | **PASS**: provided here |
| Migration twice/existing rows intact | **PASS**: PG17 database suite, including pre-existing duplicate summaries |
| Segment ordering / topics / unresolved questions | **PASS**: actual webhook with mocked transports; transaction backfill tests |
| Three-hour transcript and rerun | **PASS** locally: 1,080 turns, 216 chunks, maximum 441 estimated tokens; three mocked embedding batches, rerun makes zero writes/API calls. **FAIL / unverified** for real provider latency/hosted edge timeout |
| Embedding outage does not affect meeting completion | **PASS**: worker test preserves transcript/summary/tasks/status; briefing falls back to relational data; webhook dispatch failure remains summarized |
| Empty / one / many history; budget; hallucinated IDs | **PASS**: Deno context tests; prompt-inclusive budget and authoritative task hydration |
| Same-project owner isolation, null owners, non-owner denial | **PASS**: PG17 RLS/RPC tests and Deno query-scope tests |
| Cache hit/hash invalidation/refresh | **PASS**: deterministic hash, task/agenda invalidation, scope uniqueness and stale-claim SQL tests; full hosted HTTP flow unverified |
| Manual task preservation / carryover | **PASS**: PG17 partial-index upsert and legacy identity adoption; unknown IDs/evidence rejected; cross-owner/project updates ignored |
| Frontend loading/error/empty states | Implemented and production build passes; **FAIL / unverified** for interactive browser smoke test (no browser/session available) |

## Rollback / disable

- Set `ENABLE_TASK_CARRYOVER=false` to stop cross-meeting task updates.
- Stop calling the new functions and roll back the frontend/deploy-bot to the prior
  release through the existing deployment process. Additive schema can remain.
- To stop automatic indexing, remove the new webhook `queueContextIndex` call and
  deploy that webhook; retain persistent-task writes if manual task rows now exist.
  Reverting the entire webhook to its old delete/reinsert persistence would discard
  manual edits on future re-analysis, so that is not a data-preserving rollback.
- No down migration or destructive cleanup is supplied. Existing meeting features
  tolerate unused context columns/tables. Failed/stale index jobs can be retried;
  failed/stale briefings can be refreshed. A failed migration rolls back its transaction.

## Files touched

Modified existing files:

- `.env.example` — optional context secrets/defaults.
- `supabase/config.toml` — two JWT-verified function entries.
- `supabase/functions/deploy-bot/index.ts` — optional project validation/persistence.
- `supabase/functions/meetingbaas-webhook/index.ts` — requested Pass 2 metadata,
  ordered row persistence, persistent tasks/carryover, nonblocking index dispatch.
- `src/components/AdminMeetingsPanel.jsx` — project and briefing sections.
- `src/components/MeetingBotDeployer.jsx` — optional project dropdown/payload.
- `src/pages/UserDashboard.jsx` — briefing component import/mount in meeting details.

Added files:

- `supabase/migrations/20261003000000_context_management.sql` — schema, RLS, indexes, RPCs.
- `supabase/context_preflight.sql` — read-only schema inventory.
- `supabase/context_transcript_backfill.sql` — separate ordered transcript rebuild.
- `supabase/functions/index-meeting-context/index.ts` — indexing/admin backfill endpoint.
- `supabase/functions/generate-briefing/index.ts` — scoped generation/cache endpoint.
- `supabase/functions/_shared/context-utils.ts` — hashes, token estimate, safe errors.
- `supabase/functions/_shared/context-http.ts` — new endpoints' HTTP/auth helpers.
- `supabase/functions/_shared/chunker.ts` — deterministic turn-aware chunking.
- `supabase/functions/_shared/gemini.ts` — new-only text/embedding REST transport.
- `supabase/functions/_shared/indexer.ts` — index planning, leases, safe commits.
- `supabase/functions/_shared/briefing-context.ts` — scoped queries, budget, ranking, validation.
- `supabase/functions/_shared/context-tasks.ts` — fingerprints, assignees, carryover validation.
- `supabase/functions/_shared/context-dispatch.ts` — fail-safe background dispatch.
- `src/components/ContextBriefingSection.jsx` — briefing controls/history/sources/states.
- `src/components/MeetingProjectAssignment.jsx` — admin project/client controls.
- `supabase/tests/context_database.test.mjs` — real PG17/pgvector integration tests.
- `supabase/tests/context.test.ts` — Deno chunking, transport, auth, isolation, failure tests.
- `supabase/tests/context-fakes.ts` — in-memory PostgREST-shaped test transport.
- `supabase/tests/webhook.test.ts` — actual webhook handler regression tests.
- `supabase/tests/capture-server.ts` — test-only Edge handler capture.
- `supabase/tests/import_map.json` — test-only `serve` replacement.
- `CONTEXT_MANAGEMENT.md` — this implementation/deployment/verification report.
