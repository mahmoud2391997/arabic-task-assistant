# Design decisions and operating budget

Rules: [قواعد النظام المعتمدة](business-rules.md). Delivered/future capabilities: [capabilities](capabilities.md). Current verification: [assessment report](assessment-report.md).

## Architecture and trust boundary

Node.js 22, native HTTP/fetch, PostgreSQL through pg, and Vercel connection lifecycle support through @vercel/functions. Groq's configured Qwen model uses strict JSON Schema, with non-thinking mode for intent extraction. Alternate compatible models use JSON object mode and the same field validation. No hidden offline parser pretends to be a live AI result.

The model proposes fields and policy IDs. It cannot issue SQL, grant roles, decide approvals or override the server clock. The application checks authenticated identity, database roles, task scope and policy rules; repository reads/creates enforce scope again. Mutations and audit commit together. Telegram update receipts preserve retry idempotency and per-chat sessions; the HTTP API remains stateless and has no client idempotency key.

The source policy is six clauses. Later user-authorized business exceptions are recorded explicitly in the rules document and policy source. Answers are the exact selected clauses; unsupported information uses an explicit unknown answer. This prevents invented prose; verified against all ten evaluation scenarios including T06 (exact clause match) and T07 (explicit unknown acknowledgement).

## Calendar and time choices

Riyadh business time is independent of the host/client timezone. Relative dates are resolved in code. Friday shifts to Saturday at the same hour, including outside Saturday's company working hours, as explicitly decided to align T09 with the original exercise. Unqualified 1–7 uses the afternoon work context; explicit morning/24-hour values are respected. New task schedules cannot be backdated; status changes are allowed daily before or after the due date/time, but before the current working day closes (16:00 Sunday–Thursday, 12:00 Saturday; Friday is off). Remote-work weeks start Saturday. No invented public holidays, leave balances or medical-report penalties.

## Cost model — checked 14 October 2026

Groq documents qwen/qwen3.8-27b at **$0.80 per million input tokens and $4.00 per million output tokens**. This is a preview model, so verify price/availability when budgeting. Sources: [model and pricing](https://console.groq.com/docs/model/qwen/qwen3.8-27b), [rate limits](https://console.groq.com/docs/rate-limits). Account-specific quotas and bills take precedence; free quotas are not an unlimited service commitment.

For 100 employees × 20 messages per employee per day × 30 days = **60,000 messages/month**, let f be the fraction actually sent to AI and I/O the average billed input/output tokens including prompt and conversation history:

`monthly AI USD = 60000 × f × (I × 0.80 + O × 4.00) / 1000000`

| Assumption | Input/output tokens | AI cost/month, f=1 |
|---|---:|---:|
| Small stateless prompt | 900 / 150 | $79.20 |
| Larger current-prompt planning envelope | 2500 / 200 | $168.00 |
| Longer conversation envelope | 4000 / 300 | $264.00 |

These are scenario assumptions, not measured invoices. The prompt now contains detailed policies, schema and examples, so the old 900-token estimate is not a safe single-point budget. For 22 operating days the same rows are $58.08, $123.20 and $193.60. If half of interactions use deterministic buttons/read commands (f=0.5), inference halves; measure the actual mix. Add a 20% inference contingency for billed invalid-output attempts and changes in input size. Rate-limited requests should not create business writes; retries can increase waiting time, and successful billed attempts must be included.

A planning allowance of $20–50/month for hosting, database, monitoring/backups is **a budget assumption, not a supplier quote**. The middle scenario with 20% inference contingency plus this allowance is roughly $222–252/month at 30 operating days. Taxes, currency conversion, account subscriptions, scaling, storage/egress and human operational effort are excluded. Do not purchase or upgrade a plan from this document.

Optional AI_USAGE_LOG=true logs numeric prompt/completion token counts only. It never logs employee names, messages, keys or connection strings. The clean-install assessment measured 10 successful calls: average 2,419.2 input and 105 output tokens. At the cited prices, this is $0.023554 for the sample and about $141.32/month if extrapolated to 60,000 AI calls, before hosting/contingency. This small stateless sample cannot establish production conversation costs. Callback logging failures cannot affect successful business execution. Limits such as requests/day and tokens/minute must be checked in the actual account before committing to 2,000 daily messages.

## Provider failures

An upstream 429 is returned as HTTP 429 with Retry-After and an exception message saying the request did not execute. Other provider failures remain 502; no fabricated intent is substituted. The demo retries only explicit pre-execution rate limits with bounded waits; it never retries a successful write or an arbitrary server error. Finite daily quota can still stop an evaluation and should be reported as a blocker, not hidden by a mock result.

## Delivery status

All ten scenarios pass live on the deployed system. 50/53 tests pass with the default `npm test` (0 failures; 3 skipped require a separate PostgreSQL instance); 53/53 pass with `WORKFLOW_TEST_DATABASE_URL` set. `npm run check:docs` reports zero problems.

Telegram supports both demo_id (user-authorized test mode for evaluation) and secure_link (verified identity) modes; both are implemented and tested. GitHub CI/CD is configured with GitHub Actions and Vercel; activating automated deployment requires adding `VERCEL_TOKEN` to the production environment secrets. Manual Vercel CLI deployment is verified and works. The walkthrough video script and recording guide are in [video-script-ar.md](video-script-ar.md) and [capabilities](capabilities.md); the project owner records in their own voice. The seven-day enhancement plan is in [capabilities](capabilities.md).
