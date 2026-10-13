# Arabic task assistant — Node.js + Groq + PostgreSQL

Server for the supplied AI engineer exercise. `POST /chat` creates and updates tasks, handles employee requests and approvals, and answers from the six company policy clauses in Arabic. Data persists in PostgreSQL and can be hosted in the cloud. No frontend is required.

## Run

Requires Node.js 22+, a PostgreSQL database and a Groq API key.

1. `cp .env.example .env` and fill `GROQ_API_KEY` and `DATABASE_URL`.
2. `npm ci && npm start`

Tables and the six fictional employees are initialized automatically. A cloud PostgreSQL connection URL from your provider works with the same code; use the provider's TLS instructions. For verified TLS set `DATABASE_SSL=true`; optionally set `DATABASE_CA_FILE` to a certificate path. Do not disable certificate verification. Avoid conflicting `sslmode` parameters in the URL when using these explicit TLS options.

The local Compose database is exposed on localhost port 5433 to avoid conflicting with an existing PostgreSQL instance. Change POSTGRES_PORT and DATABASE_URL together if needed.

For local PostgreSQL, run `docker compose up -d db` before `npm start`. Alternatively, after creating `.env` with the Groq key, run the complete local stack with `docker compose up --build`. The Compose database credentials are local development defaults. Do not use them on a public database. For cloud deployment, deploy the Dockerfile and configure environment variables in your host's secret settings; Compose is optional and intended for local development.

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
  "task_id": 1,
  "task": { "id": 1, "assignee_id": 4, "description": "يراجع عرض السعر", "due_at": "2026-10-15T07:00:00.000Z" },
  "rescheduled": false,
  "reply": "تم تسجيل المهمة لخالد بتاريخ 2026-10-15 الساعة 10:00."
}
```

Actions: `create_task`, `list_tasks`, `policy_answer`, `create_request`, `list_requests`, `list_approvals`, `list_reports`, `decide_request`, `submit_report`, `update_task`, `clarify`, `reject`, `error`. Every chat result includes `response_type`: `execution`, `rejection`, `execution_rescheduled` or `clarification`. Unknown policy answers use clarification. Business clarification uses HTTP 200; permission denial 403; malformed input 400; missing authentication 401; provider errors 502. `GET /health` checks PostgreSQL. Requests are limited to 16 KiB, messages to 4000 characters, and AI requests to 20 seconds.

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

The server resolves dates in `Asia/Riyadh`, stores timestamps as PostgreSQL `TIMESTAMPTZ`, and displays Riyadh time. `بكرة`, `بعد بكرة`, next weekdays and ISO dates are supported. A weekday means its next occurrence strictly after today, including “الجاي”. An explicit hour without AM/PM uses 24-hour time. “العصر” alone means 16:00; “1 الظهر” means 13:00. Missing or ambiguous details trigger clarification. Friday tasks move to Saturday at the same hour. Task appointments are limited to 08:00–before 16:00 Sunday–Thursday and 08:00–before 12:00 Saturday. Hours are checked again after Friday shifts. Status updates must execute during working hours on the task’s due day, using the server clock.

Groq extracts an intent and selects policy clause IDs. The application returns the exact selected source clauses; it does not use free-form generated policy answers. Unknown information returns “هذه المعلومة غير متوفرة في نص سياسة الشركة.” Relevance depends on model classification and is checked by the live demo. Unsupported details must be marked unknown in the extraction prompt.

## Verification and demo

Automated coverage includes PostgreSQL permissions, all six policy answers, office-hour boundaries, request routing, supervisor/manager approvals, medical-report deadlines, status updates, concurrent remote-work approvals and Telegram retries. See [request workflows](docs/workflows.md) for commands and policy assumptions.

```bash
npm test
npm run demo
```

Tests use a PostgreSQL emulator and mock AI results by default; they cover all ten supplied scenarios in order, date resolution, SQL permissions, prompt-role injection, HTTP authentication and provider failure. They do **not** establish live model accuracy. `npm run demo` sends the actual ten Arabic messages to the running server and calls Groq with your key. It creates real demo tasks on each run; use a separate evaluation database.

To run the tests against actual PostgreSQL, set `TEST_DATABASE_URL` to a **disposable test database** before `npm test`. Tests drop and recreate the three application tables. Never point this variable at production.

See [design decisions](docs/decisions.md) for assumptions, cost calculation and next steps. The assignment's personal voice recording remains something you should record yourself; `npm run demo` provides the ten-message walkthrough.

## Vercel and Neon deployment

See [deployment instructions](docs/deployment.md). Cloud routes use the same chat and authorization implementation as the local server. Vercel deployments require token mode, and Neon schema initialization runs once before serving traffic.

Live cloud verification also passed all ten scenarios. See [cloud deployment and test instructions](docs/deployment.md).

See [Telegram setup](docs/telegram.md) and [request workflows](docs/workflows.md).
