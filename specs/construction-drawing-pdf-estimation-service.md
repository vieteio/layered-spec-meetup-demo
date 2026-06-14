# Title and scope

Design a service where Google-authenticated users upload construction drawing PDFs, the backend stores the original PDF on disk, runs an LLM-driven parsing and estimation pipeline, persists both intermediate parsed markdown and final estimation markdown in the database, and lets users revisit previously processed PDFs. The scope covers cookie-based sessions, document ownership, asynchronous processing states, retry/history behavior, and markdown rendering in the web UI.

## Planning anchor

- Anchor: `service/README.md`, `service/package.json`, `service/prisma/schema.prisma`, `service/src/app/layout.tsx`, and `service/src/app/page.tsx` are currently empty, so there is no implemented auth, storage, queue, or rendering runtime yet.
- Changed assumption: this service is greenfield and should center the main workflow around persisted document-processing runs rather than a synchronous upload-and-wait HTTP request, so users can leave the page and later review completed or failed PDFs.
- Changed assumption: Google account registration/login uses an HTTP-only cookie session backed by a server-side session record, rather than bearer tokens or browser-stored JWTs.
- Changed assumption: the original PDF is persisted on disk, while the database stores user ownership, processing state, and markdown artifacts for both the PDF parsing stage and the estimation stage.
- Changed assumption: the estimation workflow persists two distinct markdown artifacts for one processing run: `parsed_markdown` and `estimation_markdown`.
- Changed assumption: REST remains the source of truth for upload responses, document hydration, and reconnect recovery, but the frontend should also receive live processing updates and user-visible notifications over WebSocket when one request/response cycle is not enough.
- Why this is non-local: even as a greenfield slice, the workflow spans auth, frontend upload UX, multipart ingestion, filesystem storage, job orchestration, LLM prompting, persistence of intermediate artifacts, and document history rendering.
- Impacted specs already present in `specs/`:
  - `specs/construction-drawing-pdf-estimation-service.md` - this file was an empty placeholder before the current planning update and had no workflow or data contract. Status: `partially outdated`. Action: `replace`.

## Connected groups or observed existing logic

### 1. Service scaffold

- `service/src/app/layout.tsx` is empty.
- `service/src/app/page.tsx` is empty.
- No authenticated routes, upload UI, document list UI, or markdown rendering flow exist yet.

### 2. Backend and package scaffold

- `service/package.json` is empty.
- `service/README.md` is empty.
- No chosen auth library, queue runtime, PDF extraction utility, WebSocket runtime, or LLM integration contract is captured in the repo yet.

### 3. Persistence scaffold

- `service/prisma/schema.prisma` is empty.
- No user, session, document, processing-run, or artifact tables exist yet.

### 4. Specs

- `specs/construction-drawing-pdf-estimation-service.md` is the target artifact for this slice and is now the authoritative workflow spec for the service.

Observed existing logic:
- No implemented runtime currently constrains the design, so this document becomes the first authoritative contract for the service state model, endpoints, and background processing workflow.

## Use cases

### 1. User signs in with Google and receives a cookie session

anonymous visitor --complete Google OAuth sign-in--> authenticated user with a server-backed HTTP cookie session

Execution Logic:
1. Input: unauthenticated browser request to start sign-in.
   Outcome: the browser is redirected to Google OAuth consent.
   Logic: the backend generates OAuth state, stores the anti-forgery state server-side or in a short-lived signed cookie, and redirects the browser to Google with the required scopes (`openid`, `email`, `profile`).
   External state: short-lived OAuth state record or signed state cookie.
   Config parameters: `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`.
   Metrics: sign-in start count.
2. Input: Google callback with authorization code and state.
   Outcome: a user record exists and an active session record is created.
   Logic: validate the OAuth state, exchange the code for Google tokens, fetch the Google profile, upsert the user by Google subject id, create a new session row, hash the session token before persistence, and prepare an HTTP-only session cookie containing the opaque session token.
   External state: `users`, `user_sessions`.
   Config parameters: session TTL, allowed host/base URL.
   Metrics: sign-in success count, callback failure count by reason.
3. Input: successful session creation.
   Outcome: the browser lands on the authenticated workspace with a valid cookie session.
   Logic: return `Set-Cookie` with `HttpOnly`, `Secure`, `SameSite=Lax`, and a bounded expiration; redirect the user to the main document workspace.
   External state: browser cookie jar and `user_sessions.last_seen_at`.
   Config parameters: cookie name, cookie max age.
   Metrics: session cookie issue count.

Events And Endpoints:
- `GET /api/auth/google/start`
- `GET /api/auth/google/callback`
- `GET /api/session`
- `POST /api/logout`

Files And Functions:
- planned: `service/src/app/api/auth/google/start/route.ts#GET` - redirect the browser into Google OAuth
- planned: `service/src/app/api/auth/google/callback/route.ts#GET` - validate callback, upsert user, and issue the cookie session
- planned: `service/src/server/auth/session.ts#createSession` - create and persist hashed session records
- planned: `service/src/server/auth/google.ts#exchangeGoogleCode` - wrap Google code exchange and profile fetch

Tables:
User
 - id: string
 - google_sub: string
 - email: string
 - name: string | null
 - avatar_url: string | null
 - created_at: datetime
 - updated_at: datetime
UserSession
 - id: string
 - user_id: string
 - session_token_hash: string
 - expires_at: datetime
 - last_seen_at: datetime
 - created_at: datetime

Types:
AuthenticatedUser
 - id: string
 - email: string
 - name: string | null
 - avatarUrl: string | null
SessionCookie
 - token: string # opaque session token stored only in the cookie
 - expiresAt: string

Validation:
- Reject the callback if OAuth state is missing, mismatched, expired, or already used.
- Persist only a hashed session token in the database so a database leak does not expose live cookies.
- Reject access to authenticated endpoints when the cookie is absent, expired, or points to a deleted session.

Tests:
auth integration
 - description: first Google sign-in creates a new local user and session
   input: valid Google callback for an email that has never signed in before
   workflow: anonymous visitor --complete Google OAuth sign-in--> authenticated user with a server-backed HTTP cookie session
   expected outcome: one `users` row, one `user_sessions` row, and a `Set-Cookie` response
 - description: repeated Google sign-in reuses the existing user
   input: valid Google callback for an already known Google subject
   workflow: anonymous visitor --complete Google OAuth sign-in--> authenticated user with a server-backed HTTP cookie session
   expected outcome: existing `users` row is reused, a fresh session row is created, and old sessions remain independently revocable

### 1.1 Authenticated browser restores or ends a session

browser request with session cookie --load workspace or logout--> restored authenticated session or cleared session

Execution Logic:
1. Input: browser request with a `session` cookie to any authenticated page or API route.
   Outcome: the request resolves to an authenticated user or to an unauthenticated redirect/error.
   Logic: read the opaque cookie token, hash it, load the matching `user_sessions` row, check expiration, and load the owning user. Update `last_seen_at` on a bounded cadence to avoid a write on every request.
   External state: `user_sessions.last_seen_at`.
   Config parameters: last-seen write throttle interval.
   Metrics: session restore success count, expired-session count.
2. Input: explicit logout request.
   Outcome: the current cookie session is revoked and the browser becomes anonymous.
   Logic: delete or invalidate the matching `user_sessions` row, emit a clearing `Set-Cookie`, and redirect the browser back to the public landing page.
   External state: `user_sessions`.
   Config parameters: none.
   Metrics: logout count.

Validation:
- Workspace pages and document APIs must treat ownership checks as mandatory even when a cookie exists.
- Logout must be idempotent so replayed requests do not error.

Tests:
session integration
 - description: expired session cannot access document APIs
   input: valid-looking cookie whose backing session row is expired
   workflow: browser request with session cookie --load workspace or logout--> cleared session
   expected outcome: authenticated API returns unauthorized and no document data is leaked

### 2. User uploads a construction drawing PDF and starts processing

authenticated user with local PDF --upload and enqueue--> persisted document with queued processing run

Input Validation And Contracts:
- Accept only authenticated uploads with exactly one PDF file per request.
- Reject non-PDF MIME types, empty files, and files larger than the first-release size limit.
- After a successful upload request, downstream processing can rely on this contract: `documents` row exists, original PDF is stored on disk, `document_processing_runs` row exists in `queued` state, and the run references the immutable stored PDF path.

Execution Logic:
1. Input: authenticated multipart upload request containing one local PDF.
   Outcome: the request is accepted for processing or rejected before any persistent work starts.
   Logic: verify the cookie session, inspect MIME type and filename extension, enforce the first-release `32 MB` upload limit, optionally preflight page count for later parse batching, and reject obviously invalid files before disk writes.
   External state: none on rejection.
   Config parameters: `MAX_PDF_SIZE_MB = 32`.
   Metrics: upload rejection count by reason.
2. Input: validated PDF stream.
   Outcome: original PDF is stored on disk and a document record is created.
   Logic: create a document id, create an initial run id, derive a deterministic storage path such as `storage/pdfs/{user_id}/{document_id}/{run_id}/source.pdf`, stream the file to disk, compute a content hash, and insert the `documents` and `document_processing_runs` rows.
   External state: filesystem storage, `documents`, `document_processing_runs`.
   Config parameters: `PDF_STORAGE_ROOT`.
   Metrics: uploaded bytes, disk write duration, hash calculation duration.
3. Input: newly created queued run.
   Outcome: the frontend gets an immediate response and background processing starts asynchronously.
   Logic: enqueue the run id to the worker/runtime responsible for document processing and return a lightweight document summary with `status = queued`.
   External state: job queue or background task runtime.
   Config parameters: queue name, queue retry policy.
   Metrics: queue enqueue latency.

Events And Endpoints:
- `POST /api/documents`

Files And Functions:
- planned: `service/src/app/api/documents/route.ts#POST` - accept multipart upload and create the document/run rows
- planned: `service/src/server/storage/pdfStore.ts#persistUploadedPdf` - stream PDF bytes to disk and return hash/path metadata
- planned: `service/src/server/documents/documentService.ts#createDocumentForUpload` - create document and initial run records
- planned: `service/src/server/jobs/documentQueue.ts#enqueueDocumentRun` - hand the run id to the worker runtime

Tables:
Document
 - id: string
 - user_id: string
 - original_filename: string
 - storage_path: string
 - mime_type: "application/pdf"
 - file_size_bytes: int
 - sha256: string
 - latest_run_id: string | null
 - latest_successful_run_id: string | null
 - created_at: datetime
 - updated_at: datetime
DocumentProcessingRun
 - id: string
 - document_id: string
 - status: "queued" | "parsing" | "parsed" | "estimating" | "completed" | "failed"
 - failure_stage: "upload" | "parsing" | "estimating" | null
 - failure_message: string | null
 - parse_model: string | null
 - estimation_model: string | null
 - started_at: datetime | null
 - finished_at: datetime | null
 - created_at: datetime

Types:
DocumentUploadCommand
 - userId: string
 - originalFilename: string
 - mimeType: "application/pdf"
 - fileSizeBytes: int
DocumentSummary
 - id: string
 - originalFilename: string
 - status: "queued" | "parsing" | "parsed" | "estimating" | "completed" | "failed"
 - createdAt: string
 - updatedAt: string

Validation:
- Store only server-generated storage paths; never trust a client-provided filename as a full path.
- The upload response should not block on LLM work; long processing must move to the worker path before the request returns.
- One user may upload the same source filename multiple times; uniqueness is by document id, not by filename.
- The first release does not enforce a hard page-count rejection limit; PDFs longer than `10` pages are handled through ordered parse batches of up to `10` pages each.

Tests:
document upload integration
 - description: valid PDF upload creates a queued document run
   input: authenticated multipart request with one PDF below configured limits
   workflow: authenticated user with local PDF --upload and enqueue--> persisted document with queued processing run
   expected outcome: stored PDF exists on disk, one `documents` row exists, one `document_processing_runs` row exists in `queued` state, and API responds immediately
 - description: non-PDF upload is rejected early
   input: authenticated multipart request with a PNG file
   workflow: authenticated user with local PDF --upload and enqueue--> rejected upload
   expected outcome: request fails with validation error and no document/run rows are created

### 2.1 Backend parses the stored PDF into page-aware markdown

queued processing run with stored PDF --parse with LLM--> persisted parsed markdown artifact

Execution Logic:
1. Input: queued processing run and stored source PDF path.
   Outcome: the run enters `parsing` state and page extraction inputs are prepared.
   Logic: worker claims the run, marks `status = parsing`, loads the PDF from disk, renders or extracts each page into a page image plus any available machine text, and records page-level extraction warnings without failing the entire run unless no page can be processed.
   External state: `document_processing_runs.status`.
   Config parameters: PDF render DPI, OCR/text extraction timeout.
   Metrics: queue-to-start latency, per-page extraction duration.
2. Input: ordered page extraction bundles.
   Outcome: the service produces deterministic page-aware parsed markdown.
   Logic: group extracted pages into ordered batches of up to `10` pages each, then build one LLM prompt per batch containing the page images, extracted text spans, and page dimensions for that batch. Require the model to emit markdown that preserves page boundaries and captures page headings, text content, image descriptions, and notes about text/image positions and relationships.
   External state: outbound LLM request logs/metrics.
   Config parameters: parse model name, `PARSE_PAGE_BATCH_SIZE = 10`, prompt template version.
   Metrics: parse token usage, parse latency, parse failure count.
3. Input: parsed markdown fragments for all successful pages.
   Outcome: one persisted `parsed_markdown` artifact exists for the run.
   Logic: stitch page markdown in source order, add a document-level header and warning section when needed, persist the markdown artifact in the database, and mark the run `parsed` before advancing to estimation.
   External state: `document_artifacts`, `document_processing_runs.status`.
   Config parameters: parsed markdown template version.
   Metrics: parsed markdown size, parsed page count, warning count.

Implementation Logic:
1. Input: source PDF and page count.
   Outcome: one `ParsedPageBundle` per page.
   Logic: normalize every page into a bounded intermediate structure containing page number, preview image location or bytes, machine-extracted text spans in reading order, bounding boxes, and page dimensions. This decomposition keeps the later prompt shape stable even when PDFs differ in embedded text quality.
2. Input: ordered `ParsedPageBundle` rows.
   Outcome: page-level markdown that stays within model context limits.
   Logic: partition `ParsedPageBundle` rows into stable ordered batches of at most `10` pages. For documents with `10` pages or fewer, the parse stage may use one batch. For longer documents, batch `1..10`, `11..20`, and so on. Persist page warnings in artifact metadata so later estimation can mention low-confidence pages instead of silently ignoring them.
3. Input: page-level markdown fragments.
   Outcome: one stable document markdown representation for downstream estimation.
   Logic: preserve page ordering, use stable page section headings, and keep layout notes attached to the page where they were observed so the estimation stage can reason about spatial relationships such as callouts, legends, dimensions, and cross-page references.

Data:
Parsed markdown template:
```md
# Parsed Construction Drawing

## Document notes
- Source filename: <original filename>
- Parse warnings: <none or warning list>

## Page 1
### Page summary
<short natural-language summary of the page>

### Text blocks
- `[x=<left>, y=<top>, w=<width>, h=<height>]` <recognized text>

### Image descriptions
- `[x=<left>, y=<top>, w=<width>, h=<height>]` <description of symbol/diagram/table/legend>

### Layout and relationships
- <notes about how dimensions, callouts, legends, labels, and images relate on this page>
```

Files And Functions:
- planned: `service/src/server/documents/processDocumentRun.ts#runParseStage` - own the parsing-stage orchestration
- planned: `service/src/server/pdf/extractPdfPages.ts#extractPdfPages` - render pages and collect extracted text metadata
- planned: `service/src/server/llm/parseConstructionPdf.ts#parseConstructionPdfToMarkdown` - call the parse model and compose parsed markdown

Tables:
DocumentArtifact
 - id: string
 - processing_run_id: string
 - kind: "parsed_markdown" | "estimation_markdown"
 - markdown: text
 - metadata_json: json
 - created_at: datetime

Types:
ParsedPageBundle
 - pageNumber: int
 - pageImageRef: string
 - pageWidth: int
 - pageHeight: int
 - extractedTextSpans: list[TextSpan]
   - text: string
   - boundingBox: string
   - readingOrder: int
 - warnings: list[string]
ParsedMarkdownArtifact
 - processingRunId: string
 - kind: "parsed_markdown"
 - markdown: string
 - pageCount: int
 - warnings: list[string]

Validation:
- If some pages fail to parse but at least one page succeeds, persist the warnings and continue to estimation with explicit low-confidence notes.
- If no page can be extracted or parsed, fail the run at the `parsing` stage and preserve the source PDF for later retry/debugging.
- Parsed markdown must remain deterministic in section structure even when the page content varies, so the estimation stage does not need to guess where to find page notes.

Tests:
worker integration
 - description: page-aware parsed markdown is persisted after a successful parse stage
   input: queued processing run pointing to a readable construction drawing PDF
   workflow: queued processing run with stored PDF --parse with LLM--> persisted parsed markdown artifact
   expected outcome: run reaches `parsed`, one `document_artifacts` row with `kind = parsed_markdown` exists, and the markdown contains ordered page sections
 - description: document longer than ten pages is parsed in ordered ten-page batches
   input: queued processing run pointing to a readable `23` page construction drawing PDF
   workflow: queued processing run with stored PDF --parse with LLM--> persisted parsed markdown artifact
   expected outcome: the parse stage emits three ordered batch prompts covering pages `1..10`, `11..20`, and `21..23`, and the persisted markdown still renders pages in source order
 - description: fully unreadable PDF fails the parse stage
   input: queued processing run with a corrupt or unsupported PDF
   workflow: queued processing run with stored PDF --parse with LLM--> failed run
   expected outcome: run ends in `failed` with `failure_stage = parsing` and no estimation stage begins

### 2.2 Backend converts parsed markdown into time and cost estimation markdown

persisted parsed markdown artifact --estimate with LLM--> persisted estimation markdown artifact

Execution Logic:
1. Input: completed `parsed_markdown` artifact for one processing run.
   Outcome: the run enters `estimating` state with a stable estimation input.
   Logic: load the parsed markdown from the database, include document metadata and parse warnings, and prepare the estimation prompt so the model reasons from the persisted markdown rather than directly from the PDF.
   External state: `document_processing_runs.status`.
   Config parameters: estimation prompt version.
   Metrics: parse-to-estimation handoff latency.
2. Input: parsed markdown plus estimation prompt contract.
   Outcome: the model returns estimation markdown for time and cost.
   Logic: instruct the model to produce a structured markdown result with assumptions, itemized work, estimated hours, estimated cost, confidence, and notable risks. The first release uses model-inferred assumptions only, so the model must explicitly state inferred rates, quantities, and missing-detail assumptions when the drawing does not provide enough pricing data for exact inputs.
   External state: outbound LLM request logs/metrics.
   Config parameters: estimation model name, default currency label, estimation prompt version.
   Metrics: estimation token usage, estimation latency, estimation failure count.
3. Input: estimation markdown response.
   Outcome: one persisted `estimation_markdown` artifact exists and the run can transition to `completed`.
   Logic: validate non-empty markdown, persist the artifact, and mark the run `completed` with `finished_at` set.
   External state: `document_artifacts`, `document_processing_runs`.
   Config parameters: none.
   Metrics: estimation markdown size, completed-run count.

Data:
Estimation markdown template:
```md
# Construction Drawing Estimation

## Executive summary
<high-level explanation of the likely work scope>

## Assumptions
- <assumption 1>
- <assumption 2>

## Itemized estimate
| Scope item | Quantity assumption | Estimated time | Estimated cost | Notes |
| --- | --- | --- | --- | --- |
| <item> | <assumption> | <time> | <cost> | <note> |

## Totals
- Total estimated time: <value>
- Total estimated cost: <value>

## Confidence and risks
- Confidence: <low|medium|high with explanation>
- Risks: <list of missing details or ambiguities>
```

Files And Functions:
- planned: `service/src/server/documents/processDocumentRun.ts#runEstimationStage` - own the estimation-stage orchestration
- planned: `service/src/server/llm/generateEstimationMarkdown.ts#generateEstimationMarkdown` - call the estimation model and enforce output template expectations

Types:
EstimationMarkdownArtifact
 - processingRunId: string
 - kind: "estimation_markdown"
 - markdown: string
 - assumptions: list[string] | null
 - totalEstimatedTime: string | null
 - totalEstimatedCost: string | null

Validation:
- The estimation stage must read only persisted parsed markdown, not re-open the PDF as a hidden second source of truth.
- If the model cannot infer exact quantities or pricing inputs, it must state assumptions explicitly rather than present fabricated certainty.
- The first release must not depend on user-uploaded material or labor cost tables; any pricing basis used in the output must be described as an inferred assumption in the markdown.
- A completed run must have both artifact kinds: `parsed_markdown` and `estimation_markdown`.

Tests:
worker integration
 - description: estimation markdown is persisted after a successful estimation stage
   input: parsed markdown artifact describing a valid construction drawing
   workflow: persisted parsed markdown artifact --estimate with LLM--> persisted estimation markdown artifact
   expected outcome: run reaches `completed`, one `estimation_markdown` artifact exists, and the markdown includes assumptions plus totals

### 2.3 Processing completion or failure is persisted and exposed to the UI

active processing run --persist terminal state--> completed result or failed document with visible status

Execution Logic:
1. Input: successful parse and estimation artifacts for a run.
   Outcome: the document points to the latest successful output.
   Logic: update `documents.latest_run_id` and `documents.latest_successful_run_id`, keep the run in `completed`, and expose both markdown artifacts through the document detail API. This persistence step is the authoritative source that later WebSocket events refer to, not a transient in-memory result.
   External state: `documents`, `document_processing_runs`, `document_artifacts`.
   Config parameters: none.
   Metrics: completed-run publish count.
2. Input: worker error at any stage after upload.
   Outcome: the run ends in `failed` with enough context for the user to inspect or retry.
   Logic: capture `failure_stage`, a user-safe `failure_message`, and `finished_at`; keep any successfully persisted earlier artifacts for debugging or partial review, but do not mark the document completed.
   External state: `document_processing_runs`.
   Config parameters: error message sanitization rules.
   Metrics: failure count by stage.
3. Input: frontend refresh, reconnect, missed real-time event, or browser session that does not have an active WebSocket connection.
   Outcome: the UI can recover the latest known processing state from REST without depending on event delivery guarantees.
   Logic: the detail API returns `queued`, `parsing`, `parsed`, `estimating`, `completed`, or `failed`. The UI uses REST for initial page load, manual refresh, reconnect recovery, and fallback synchronization when WebSocket delivery is unavailable or suspected stale.
   External state: read-only document detail API access.
   Config parameters: fallback poll interval while active when no live connection exists.
   Metrics: fallback detail poll count, median time-to-terminal-state.

Events And Endpoints:
- `GET /api/documents/{documentId}`

Types:
DocumentDetailResponse
 - id: string
 - originalFilename: string
 - status: "queued" | "parsing" | "parsed" | "estimating" | "completed" | "failed"
 - failureStage: "upload" | "parsing" | "estimating" | null
 - failureMessage: string | null
 - latestRunId: string
 - parsedMarkdown: string | null
 - estimationMarkdown: string | null
 - createdAt: string
 - updatedAt: string

Validation:
- Return only user-safe failure messages to the browser; internal stack traces stay in server logs.
- Do not expose another user's document detail even if the caller can guess a document id.

Tests:
api integration
 - description: in-progress document detail returns terminal-state fields as null
   input: authenticated request for a document whose run is still `estimating`
   workflow: active processing run --persist terminal state--> visible in-progress document state
   expected outcome: response contains current status, `parsedMarkdown` may exist, and `estimationMarkdown` is null until completion
 - description: failed run exposes retryable failure metadata
   input: authenticated request for a document whose latest run failed in parsing
   workflow: active processing run --persist terminal state--> failed document with visible status
   expected outcome: response contains `status = failed`, `failureStage = parsing`, and a user-safe failure message

### 2.4 Authenticated frontend receives live document updates over WebSocket

authenticated browser with cookie session --open WebSocket and subscribe--> live document run events and frontend notifications

Execution Logic:
1. Input: authenticated browser on the document list page, document detail page, or upload success flow.
   Outcome: the frontend opens a WebSocket connection that reuses the existing cookie session.
   Logic: establish a WebSocket handshake against a user-scoped updates endpoint. Authenticate the connection from the same HTTP-only session cookie used by REST routes, then bind the socket to the current user id so server-pushed events never need client-supplied user identifiers.
   External state: in-memory connection registry or pub/sub subscription keyed by authenticated user id.
   Config parameters: WebSocket endpoint path, ping interval, idle timeout.
   Metrics: socket connect count, auth failure count, reconnect count.
2. Input: established socket connection plus current frontend route context.
   Outcome: the frontend receives only the event scope it needs.
   Logic: allow the client to subscribe either to all document updates for the current user or to one specific `documentId` when the user is on a detail page. The default upload/detail experience should at least subscribe to the just-created document run so the page can update without repeated polling.
   External state: connection subscription map.
   Config parameters: max subscribed document ids per socket.
   Metrics: subscription count per socket, scoped-subscription count.
3. Input: worker state transitions such as `queued -> parsing`, `parsing -> parsed`, `parsed -> estimating`, `estimating -> completed`, or any transition to `failed`.
   Outcome: the frontend receives a live event and can update visible status or show a toast/inline notification.
   Logic: after the database commit for each meaningful state transition, publish a `document.run.updated` event containing the authenticated user-visible payload: `documentId`, `processingRunId`, `status`, timestamps, and optional safe `failureMessage`. Publish `document.run.completed` and `document.run.failed` as explicit terminal notifications so the frontend can show stronger completion/failure feedback than a passive status change.
   External state: pub/sub or in-process event broadcaster.
   Config parameters: which transitions emit events, notification debounce rules.
   Metrics: event publish count by type, publish-to-delivery latency.
4. Input: received WebSocket event on the frontend.
   Outcome: visible UI updates without requiring the user to manually refresh.
   Logic: update the in-memory document list/detail state when the event references a currently rendered document. Show a toast or inline banner for completion/failure events, and trigger a REST re-fetch of `GET /api/documents/{documentId}` if the event arrives out of order or if the frontend needs the full latest artifact payload.
   External state: frontend local cache/state.
   Config parameters: event-to-refetch policy, toast duration.
   Metrics: live UI update count, event-triggered refetch count.

Events And Endpoints:
- `GET /api/updates/ws`

Files And Functions:
- planned: `service/src/app/api/updates/ws/route.ts#GET` - accept authenticated WebSocket connections
- planned: `service/src/server/realtime/documentUpdatesHub.ts#publishDocumentRunEvent` - broadcast committed run updates to subscribed sockets
- planned: `service/src/components/providers/DocumentUpdatesProvider.tsx` - own the frontend socket lifecycle and reconnect logic
- planned: `service/src/hooks/useDocumentUpdates.ts#useDocumentUpdates` - connect route-level UI state to live events

Types:
DocumentRunEvent
 - type: "document.run.updated" | "document.run.completed" | "document.run.failed"
 - documentId: string
 - processingRunId: string
 - status: "queued" | "parsing" | "parsed" | "estimating" | "completed" | "failed"
 - occurredAt: string
 - failureStage: "upload" | "parsing" | "estimating" | null
 - failureMessage: string | null
WebSocketSubscriptionMessage
 - action: "subscribe_all_documents" | "subscribe_document" | "unsubscribe_document"
 - documentId: string | null

Validation:
- WebSocket authentication must rely on the existing session cookie and must reject anonymous or expired sessions.
- The server must authorize document-scoped subscriptions against the authenticated user before attaching them to a socket.
- WebSocket events are delivery hints for live UX, not the only source of truth; REST remains the recovery path after reconnect, tab restore, or missed events.
- Event payloads must not include internal error traces, raw LLM prompts, or document content that the current user is not already authorized to read.

Tests:
realtime integration
 - description: authenticated socket receives completion update for an owned document
   input: active WebSocket connection for the document owner while a run moves from `estimating` to `completed`
   workflow: authenticated browser with cookie session --open WebSocket and subscribe--> live document run events and frontend notifications
   expected outcome: socket receives `document.run.completed` with the owned `documentId`, and a follow-up REST fetch can load the final markdown
 - description: socket subscription cannot observe another user's document
   input: authenticated socket for user A attempting to subscribe to a document owned by user B
   workflow: authenticated browser with cookie session --open WebSocket and subscribe--> rejected unauthorized subscription
   expected outcome: subscription request is rejected or ignored and no user B events are delivered

### 3. User reviews existing processed PDFs and their markdown results

authenticated user --list owned documents and open one--> document history with rendered markdown results

Execution Logic:
1. Input: authenticated browser visit to the document workspace.
   Outcome: the user sees a list of previously uploaded PDFs with their latest status.
   Logic: load only documents owned by the current user, sort by most recent activity, and return summary fields needed for a list view: filename, created time, latest status, and whether a completed result exists. This REST load is the initial hydration step before any live updates are applied.
   External state: read-only `documents` and latest-run joins.
   Config parameters: page size for the list view.
   Metrics: list page load count.
2. Input: user selects one document from the list.
   Outcome: the detail page renders document metadata plus markdown artifacts when available.
   Logic: show document status, source filename, created/updated timestamps, parsed markdown tab, and estimation markdown tab. Render markdown safely with support for headings, lists, tables, and code fences, while stripping raw HTML. When the document has a non-terminal run, the page subscribes to its WebSocket update stream so status and notifications advance live.
   External state: read-only document detail API access.
   Config parameters: markdown renderer allowlist.
   Metrics: detail view count, parsed-tab view count, estimation-tab view count.
3. Input: document detail for a still-running item.
   Outcome: the UI communicates progress clearly without hiding prior successful results from earlier runs.
   Logic: show the current run status and, if `latest_successful_run_id` differs from `latest_run_id`, optionally label the older completed result as the latest available completed output until the new run finishes. Apply WebSocket events immediately when they arrive, and fall back to REST re-fetch or bounded polling only when the live connection is unavailable.
   External state: none beyond API reads.
   Config parameters: whether to surface the previous successful output during reprocessing.
   Metrics: reprocessing detail view count, live-status render count.

Events And Endpoints:
- `GET /api/documents`
- `GET /api/documents/{documentId}`

Files And Functions:
- planned: `service/src/app/documents/page.tsx` - authenticated document list screen
- planned: `service/src/app/documents/[documentId]/page.tsx` - document detail screen with status and markdown tabs
- planned: `service/src/components/MarkdownViewer.tsx` - safe markdown rendering for parsed and estimation artifacts
- planned: `service/src/components/DocumentStatusToast.tsx` - show completion/failure notifications from live events

Types:
DocumentListItem
 - id: string
 - originalFilename: string
 - status: "queued" | "parsing" | "parsed" | "estimating" | "completed" | "failed"
 - hasCompletedResult: boolean
 - createdAt: string
 - updatedAt: string

Validation:
- Document list and detail APIs must always filter by `user_id = current_user.id`.
- Markdown rendering must sanitize raw HTML so stored LLM output cannot inject script content into the browser.
- The list/detail UI must remain usable when WebSocket is disconnected by rehydrating from REST and optionally using bounded fallback polling for active runs.

Tests:
ui integration
 - description: user sees only owned documents in history
   input: authenticated session for user A when users A and B both have stored documents
   workflow: authenticated user --list owned documents and open one--> document history with rendered markdown results
   expected outcome: list contains only user A documents and detail routes for user B documents return not found or forbidden
 - description: completed document detail renders estimation markdown
   input: authenticated request for a completed document
   workflow: authenticated user --list owned documents and open one--> document history with rendered markdown results
   expected outcome: UI renders sanitized markdown with headings, tables, and totals
 - description: active document detail updates when a completion event arrives
   input: authenticated user viewing a document detail page for a run currently in `estimating`
   workflow: authenticated user --list owned documents and open one--> document history with rendered markdown results
   expected outcome: UI updates status to `completed`, shows a completion notification, and displays final estimation markdown after the event-driven refresh

### 3.1 User reprocesses an existing PDF without losing history

owned document with stored PDF --start reprocess--> new processing run while earlier artifacts remain readable

Execution Logic:
1. Input: authenticated reprocess request for an owned document whose source PDF still exists on disk.
   Outcome: a new `queued` run is created for the existing document.
   Logic: verify ownership, verify that the original PDF path is still readable, insert a new `document_processing_runs` row, point `documents.latest_run_id` to the new run, and enqueue it without deleting older runs or artifacts.
   External state: `documents`, `document_processing_runs`, job queue.
   Config parameters: max simultaneous runs per document.
   Metrics: reprocess request count.
2. Input: detail view during reprocessing.
   Outcome: earlier successful artifacts remain visible until the new run completes.
   Logic: keep `latest_successful_run_id` unchanged until the new run reaches `completed`, so users can still inspect the prior result while the fresh run is active. If the document detail page is open, WebSocket events should advance the visible reprocessing state without forcing manual refresh.
   External state: read-only document detail API behavior.
   Config parameters: none.
   Metrics: reprocess completion count, reprocess failure count.

Events And Endpoints:
- `POST /api/documents/{documentId}/reprocess`

Files And Functions:
- planned: `service/src/app/api/documents/[documentId]/reprocess/route.ts#POST` - create a new run for an existing stored PDF

Validation:
- Reprocess must fail if the stored PDF is missing from disk; the API should return a recoverable error rather than creating a broken run.
- Reprocess is owner-only and should be rejected for documents not owned by the current user.

Tests:
api integration
 - description: reprocess keeps earlier successful artifacts readable
   input: completed document with a readable stored source PDF
   workflow: owned document with stored PDF --start reprocess--> new processing run while earlier artifacts remain readable
   expected outcome: a new queued run exists, `latest_run_id` points to it, and `latest_successful_run_id` still points to the previous completed run until the new run finishes

### 3.2 User deletes an owned PDF from history

owned document in terminal state --delete from history--> removed source PDF and removed document history entry

Execution Logic:
1. Input: authenticated delete request for an owned document whose latest run is in a terminal state.
   Outcome: the system accepts the delete and removes the document from the user's history.
   Logic: verify ownership, verify that the latest run is `completed` or `failed`, delete the stored source PDF from disk, delete related `document_artifacts` and `document_processing_runs`, delete the `documents` row, and return a success response that lets the frontend remove the item from its history list immediately.
   External state: filesystem storage, `document_artifacts`, `document_processing_runs`, `documents`.
   Config parameters: none.
   Metrics: deleted-document count, disk-delete failure count.
2. Input: delete request for an actively processing document.
   Outcome: the request is rejected in the first release.
   Logic: if the latest run is `queued`, `parsing`, or `estimating`, return a recoverable validation error and keep the document in history. The delete action stays disabled or hidden for active runs in the UI to avoid implying worker cancellation support that does not yet exist.
   External state: none on rejection.
   Config parameters: none.
   Metrics: rejected active-delete count.

Events And Endpoints:
- `DELETE /api/documents/{documentId}`

Files And Functions:
- planned: `service/src/app/api/documents/[documentId]/route.ts#DELETE` - delete an owned terminal-state document and its stored artifacts

Validation:
- Delete is owner-only and must not disclose whether another user's document exists.
- The first release supports delete only for terminal-state documents; active-run cancellation is out of scope.
- Database deletion and disk deletion should be coordinated so partial cleanup is detectable and retryable if filesystem deletion fails after database work begins.

Tests:
api integration
 - description: terminal-state document can be deleted from history
   input: completed document owned by the authenticated user
   workflow: owned document in terminal state --delete from history--> removed source PDF and removed document history entry
   expected outcome: the source PDF is removed from disk, related rows are deleted, and subsequent list/detail requests no longer return the document
 - description: active document cannot be deleted
   input: queued or estimating document owned by the authenticated user
   workflow: owned active document --attempt delete from history--> rejected delete request
   expected outcome: API returns a validation error, the document remains in history, and no storage rows are deleted

## Implementation checklist

1. [x] Replace the empty placeholder at `specs/construction-drawing-pdf-estimation-service.md` with the initial authoritative workflow spec.
2. [x] Define Prisma models and migrations for `User`, `UserSession`, `Document`, `DocumentProcessingRun`, and `DocumentArtifact`.
3. [x] Implement Google OAuth sign-in, cookie session issuance, session restore, and logout.
4. [x] Implement authenticated PDF upload, disk persistence, and queued processing-run creation.
5. [x] Implement the worker parse stage that turns PDFs into persisted page-aware `parsed_markdown`.
6. [x] Implement the worker estimation stage that turns persisted `parsed_markdown` into persisted `estimation_markdown`.
7. [x] Implement authenticated WebSocket delivery for document run updates and frontend notifications, with REST re-fetch fallback after reconnect or missed events.
8. [x] Implement document history and detail UI with safe markdown rendering, live status updates, fallback polling, delete support, and reprocess support.
9. [x] Implement owner-only terminal-state document deletion across database rows and stored PDF files.
10. [x] Add integration/end-to-end coverage for auth, upload validation, parse/estimate success, realtime delivery, failure handling, owner isolation, delete behavior, and reprocess history behavior.

## Open questions

- None currently.

## Decision log

- Assumption: registration is implicit in the first successful Google sign-in; there is no separate local signup form.
- Assumption: cookie sessions are opaque, server-backed, HTTP-only sessions rather than JWTs stored in browser-accessible state.
- Assumption: processing is asynchronous after upload, and the upload request returns a queued document summary rather than waiting for LLM completion.
- Assumption: REST remains authoritative for initial state, refresh, and reconnect recovery, while WebSocket is used for live document run updates and user-facing completion/failure notifications.
- Assumption: the first release sends only in-app WebSocket notifications; browser-level notification APIs are out of scope.
- Assumption: each document belongs to exactly one authenticated user, and the first slice does not include cross-user sharing.
- Assumption: the original PDF remains on disk, while both `parsed_markdown` and `estimation_markdown` are persisted in the database as run-linked artifacts.
- Assumption: the first release enforces `32 MB` as the maximum accepted PDF size and parses PDFs longer than `10` pages in ordered batches of up to `10` pages.
- Assumption: the first release uses model-inferred material and labor cost assumptions only; user-supplied CSV cost tables are a later extension.
- Assumption: users can delete owned terminal-state documents from history, which removes the stored source PDF and associated persisted artifacts; deleting actively processing documents is out of scope for the first release.
- Assumption: reprocessing creates a new processing run and preserves earlier completed artifacts for history and comparison.
- Spec status change: this document replaces the prior empty placeholder and becomes the authoritative implementation spec for the service.
- Implementation status: checklist items 2 through 10 are implemented in `service/` with SQLite persistence, cookie sessions, async PDF processing, WebSocket updates via `server.ts`, and Vitest coverage for auth, upload, processing, and deletion flows.
