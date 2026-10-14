# Design decisions and operating budget

Rules: [قواعد النظام المعتمدة](business-rules.md). Delivered/future capabilities: [capabilities](capabilities.md). Current verification: [assessment report](assessment-report.md).

## Architecture and trust boundary

Node.js 22, native HTTP/fetch, PostgreSQL through pg, and Vercel connection lifecycle support through @vercel/functions. Gemini's configured Gemini model uses strict JSON Schema, with low reasoning effort for intent extraction. Gemini uses its documented OpenAI-compatible endpoint with JSON Schema and server-side field validation. No other provider endpoint is accepted by runtime configuration. No hidden offline parser pretends to be a live AI result.

The model proposes fields and policy IDs. It cannot issue SQL, grant roles, decide approvals or override the server clock. The application checks authenticated identity, database roles, task scope and policy rules; repository reads/creates enforce scope again. Mutations and audit commit together. Telegram update receipts preserve retry idempotency and per-chat sessions; the HTTP API remains stateless and has no client idempotency key.

The source policy is six clauses. Later user-authorized business exceptions are recorded explicitly in the rules document and policy source. Answers are the exact selected clauses; unsupported information uses an explicit unknown answer. This prevents invented prose; verified against all ten evaluation scenarios including T06 (exact clause match) and T07 (explicit unknown acknowledgement).

## Calendar and time choices

Riyadh business time is independent of the host/client timezone. Relative dates are resolved in code. Friday shifts to Saturday at the same hour, including outside Saturday's company working hours, as explicitly decided to align T09 with the original exercise. Unqualified 1–7 uses the afternoon work context; explicit morning/24-hour values are respected. New task schedules cannot be backdated; status changes are allowed daily before or after the due date/time, but before the current working day closes (16:00 Sunday–Thursday, 12:00 Saturday; Friday is off). Remote-work weeks start Saturday. No invented public holidays, leave balances or medical-report penalties.

## Cost model — checked 14 October 2026

Gemini 3.1 Flash-Lite is the configured model. Standard paid-tier pricing is $0.25 per million input tokens and $1.50 per million output tokens including thinking. Sources: [Google pricing](https://ai.google.dev/gemini-api/docs/pricing), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits). Free-tier access is quota-limited; do not assume it covers production traffic.

100 employees × 20 messages/day × 30 days = 60,000 messages/month. With a planning assumption of 2,500 input and 500 billed output/thinking tokens, every message using AI costs $82.50/month. At 22 days it is $60.50. A 20% inference reserve plus a non-quoted $20–50 infrastructure allowance gives $119–149/month at 30 days. Taxes, account subscriptions and human operations are excluded. These are assumptions, not measured Gemini bills; historical provider measurements are not reused as Gemini evidence.

Record billed input/output counts including thinking, actual AI interaction fraction and successful retries. Numeric logging must not include prompts, identities or keys. Account-specific rate and daily limits remain authoritative.

## Provider failures

An upstream 429 is returned as HTTP 429 with Retry-After and an exception message saying the request did not execute. Other provider failures remain 502; no fabricated intent is substituted. The demo retries only explicit pre-execution rate limits with bounded waits; it never retries a successful write or an arbitrary server error. Finite daily quota can still stop an evaluation and should be reported as a blocker, not hidden by a mock result.

## Delivery status

All ten scenarios pass live on the deployed system. 50/53 tests pass with the default `npm test` (0 failures; 3 skipped require a separate PostgreSQL instance); 53/53 pass with `WORKFLOW_TEST_DATABASE_URL` set. `npm run check:docs` reports zero problems.

Telegram supports both demo_id (user-authorized test mode for evaluation) and secure_link (verified identity) modes; both are implemented and tested. GitHub CI/CD is configured with GitHub Actions and Vercel; activating automated deployment requires adding `VERCEL_TOKEN` to the production environment secrets. Manual Vercel CLI deployment is verified and works. The walkthrough video script and recording guide are in [video-script-ar.md](video-script-ar.md) and [capabilities](capabilities.md); the project owner records in their own voice. The seven-day enhancement plan is in [capabilities](capabilities.md).
