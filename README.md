# Arabic task assistant — Node.js + Groq + PostgreSQL

Server for the supplied AI engineer exercise. `POST /chat` creates and updates tasks, handles employee requests and approvals, and answers from the six company policy clauses in Arabic. Data persists in PostgreSQL and can be hosted in the cloud. Telegram is the conversational interface; no web frontend is required.

**All current rules:** [قواعد النظام المعتمدة](docs/business-rules.md). **Capabilities and delivery scope:** [capabilities](docs/capabilities.md). **Evidence against the grading criteria:** [assessment](docs/assessment-report.md).

## Run

### Docker (recommended)

Requires Docker Desktop and a valid Groq key. Configure secrets, without editing source code:

```bash
cp .env.example .env
# Set GROQ_API_KEY in .env, then:
docker compose up -d --build
curl http://localhost:3000/health
docker compose exec server npm run demo
```

This starts PostgreSQL, initializes tables and six fictional employees, and runs Node.js 22. PostgreSQL is exposed only on localhost:5433, and the API on localhost:3000. SERVER_PORT and POSTGRES_PORT can change host ports without modifying Compose. Demo creates test tasks; use a dedicated evaluation stack/database.

### Native Node.js alternative

Requires Node.js 22, PostgreSQL and a valid Groq key:

```bash
cp .env.example .env
# Set GROQ_API_KEY and DATABASE_URL in .env.
docker compose up -d db
npm ci
npm start
# In a second terminal:
npm run demo
```

A cloud PostgreSQL URL works with the same code. For verified TLS set DATABASE_SSL=true; optionally set DATABASE_CA_FILE. Avoid conflicting sslmode URL parameters and never disable certificate verification. Compose credentials are local evaluation defaults, not public database credentials.

Default AI settings:

```dotenv
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=qwen/qwen3.8-27b
GROQ_API_KEY=your-key
```

The adapter uses the [Groq-compatible endpoint](https://console.groq.com/docs/openai) and [structured outputs](https://console.groq.com/docs/structured-outputs). Supported Groq models (including the configured Qwen model) use strict JSON Schema; other compatible models use JSON object mode. The server separately validates extracted fields in both modes. You can change the base URL and model, using `AI_API_KEY` for another compatible provider; clear `GROQ_API_KEY` first because it takes precedence. No fallback provider or offline intent parser is silently used.

## API

```bash
curl http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"user_id":2,"message":"سجّل مهمة لخالد بكرة الساعة 10 يراجع عرض السعر"}'
```

Response shape (IDs and dates depend on the database and current day):

```json
{
  "action": "create_task",
  "action_type": "execution",
  "task_id": 1,
  "task": { "id": 1, "assignee_id": 4, "description": "يراجع عرض السعر", "due_at": "2026-10-15T07:00:00.000Z" },
  "rescheduled": false,
  "message": "تم تسجيل المهمة لخالد بتاريخ 2026-10-15 الساعة 10:00."
}
```

Actions include `create_task`, `list_tasks`, `policy_answer`, `create_request`, `list_requests`, `list_approvals`, `list_reports`, `decide_request`, `submit_report`, `update_task`, `edit_task`, `view_report`, `review_report`, and `list_audit`; unrecognized actions use `unknown`. Every JSON response includes `action`, `action_type`, `message` and `reply` (identical to `message`, kept for the brief's R1 contract). Outcomes are `execution`, `rejection`, `postpone`, `inquiry`, and `exception`. The API omits the internal `response_type` and request metadata. `/chat` accepts `prompt` or the existing `message`, with a positive integer `user_id` matching the bearer identity. `GET /health` checks PostgreSQL. Requests are limited to 16 KiB, messages to 4000 characters, and AI requests to 20 seconds. See [the integration contract](docs/integration-contract.md) for Telegram verification, sessions and CI/CD.

## Identity and permissions

`AUTH_MODE=demo` implements the exercise's caller-supplied `user_id` contract and is for local evaluation. On public deployment, use `AUTH_MODE=token` and map unique random secrets of at least 32 characters to employee IDs:

```dotenv
AUTH_MODE=token
AUTH_TOKENS_JSON={"2":"replace-with-a-unique-random-secret-of-at-least-32-characters"}
```

Send `Authorization: Bearer <employee-token>`. `user_id` must match that identity. Generate tokens using `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Store keys/tokens only in `.env` or cloud secrets, never in Git. For a real employee system, replace this token mapping with your identity provider's verified JWT subject.

Roles are loaded from PostgreSQL, never from messages or model output:

- Employees create/read their own tasks.
- Supervisors create/read tasks within their department.
- Managers create/read tasks for everyone.

`src/chat.js` checks requests and `src/store.js` checks again at the database boundary. Task creation and its audit entry share a transaction. Scoped reads query only authorized rows. The model receives employee names and policy clauses, never existing task contents, roles, credentials or database access. Audit entries omit raw chat messages.

## Dates and policy

The server resolves dates in `Asia/Riyadh`, stores timestamps as PostgreSQL `TIMESTAMPTZ`, and displays Riyadh time. `بكرة`, `بعد بكرة`, next weekdays and ISO dates are supported. A weekday means its next occurrence strictly after today, including “الجاي”. Unqualified hours 1–7 use the afternoon/evening work context (13:00–19:00); 8–11 mean morning and 12 means noon. Explicit periods and zero-padded 03:00 are respected. “العصر” alone means 16:00; “1 الظهر” means 13:00. Missing or ambiguous details trigger clarification. Friday tasks move to Saturday at the same hour. Task appointments may be outside company working hours, including after noon on Saturday. Friday still shifts to Saturday at the same hour. Status updates execute on the task’s due day at or after its scheduled time, using the server clock, with no office-hours restriction. New appointments and schedule edits cannot be earlier than the server time.

Groq extracts an intent and selects policy clause IDs. The application returns the exact selected source clauses; it does not use free-form generated policy answers. Unknown information returns “هذه المعلومة غير متوفرة في نص سياسة الشركة.” Relevance depends on model classification and is checked by the live demo. Unsupported details must be marked unknown in the extraction prompt.

## Verification and demo

Automated coverage includes PostgreSQL permissions, all six policy answers, office-hour boundaries, request routing, supervisor/manager approvals, medical-report deadlines, status updates, concurrent remote-work approvals and Telegram retries. See [request workflows](docs/workflows.md) for commands and policy assumptions.

```bash
npm test
npm run demo

# Docker-only alternative; no host Node.js needed for the live demo:
docker compose exec server npm run demo
```

Tests use a PostgreSQL emulator and mock AI results by default; they cover all ten supplied scenarios in order, date resolution, SQL permissions, prompt-role injection, HTTP authentication and provider failure. They do **not** establish live model accuracy. `npm run demo` sends the actual ten Arabic messages to the running server and calls Groq with your key. It creates real demo tasks on each run; use a separate evaluation database.

For real PostgreSQL workflow/Telegram tests, create a disposable `assistant_test` database and run:

```bash
WORKFLOW_TEST_DATABASE_URL=postgresql://assistant:assistant@localhost:5433/assistant_test \
TELEGRAM_TEST_DATABASE_URL=postgresql://assistant:assistant@localhost:5433/assistant_test npm test
```

These tests create/drop isolated temporary schemas. The optional legacy `TEST_DATABASE_URL` tests drop application tables: never point any test setting at production.

See [صفحة القرارات بالعربية — ملف التسليم 03](docs/03-decisions-ar.md) and [detailed design decisions](docs/decisions.md) for assumptions, cost calculation and next steps. The assignment requires a 3–5 minute walkthrough video in your own voice, which you should record yourself; `npm run demo` provides the ten-message walkthrough.

## Vercel and Neon deployment

See [deployment instructions](docs/deployment.md). Cloud routes use the same chat and authorization implementation as the local server. Vercel deployments require token mode, and Neon schema initialization runs once before serving traffic.

Protected cloud health, API authentication and Telegram configuration are smoke-tested after deployment. The current ten-message model evidence is recorded in the assessment report; historical checks are dated in deployment documentation.

See [Telegram setup](docs/telegram.md) and [request workflows](docs/workflows.md).

## Provider limits and cost

Groq rate limits return HTTP 429 with Retry-After before any business write. The live demo waits and retries those responses up to three times, but never retries successful mutations or unknown failures. A finite quota remains an external limit. Optional `AI_USAGE_LOG=true` writes only numeric input/output token counts; no message, identity or key is logged. See [cost and design decisions](docs/decisions.md) for current cited rates, measured/assumed volumes, hosting allowances and an extra-week plan.
