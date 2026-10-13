# Telegram

Production bot: https://t.me/MahmoudTasksAI_2026_bot

The current deployment uses the requested **demo_id** flow. Anyone may start a private chat; the bot asks for an employee ID. Send `2` to choose سارة, then a task request. IDs: 1 منيرة (manager), 2 سارة (projects supervisor), 3 فهد (projects employee), 4 خالد (projects employee), 5 نورة (finance employee), 6 عبدالرحمن (finance supervisor). `/employee 3` changes the selected identity. Roles are always loaded from PostgreSQL. Selecting an ID is intentionally a demo and does not prove identity; use fictional data.

`TELEGRAM_IDENTITY_MODE=secure_link` enables the stronger flow. Authenticated employees request `POST /telegram/link-code` with their existing employee bearer token and an empty JSON body. It returns a one-use Telegram start link expiring after ten minutes. Only hashed codes are stored. Bindings are separated by identity mode, so previous unauthenticated demo selections cannot carry over into secure mode.

`POST /telegram/webhook` requires `X-Telegram-Bot-Api-Secret-Token` matching the deployment secret, validates private-chat identities, and ignores unsupported updates. Task creation and update receipts commit in one PostgreSQL transaction. Retries and concurrent deliveries of the same Telegram update reuse the saved reply without repeating task creation. A retry after a failed reply delivery may resend a reply. This does not deduplicate distinct user messages.

Vercel Authentication remains enabled. Telegram delivers webhooks using the project's existing automation bypass as a private URL parameter, and the application separately validates Telegram's secret header. Keep the complete webhook URL private. Configure all Telegram environment variables before deployment, initialize the schema using the direct Neon URL, deploy, then register:

```sh
SERVER_URL=https://arabic-task-assistant-iti1.vercel.app \
TELEGRAM_BYPASS_FILE=.tools/telegram-bypass \
node --env-file=.env.production.local scripts/telegram-webhook.js
```

The script verifies the bot account and registered webhook, configures commands, and reports only sanitized results. It does not discard pending messages. Credentials never belong in Git.

Tests:

```sh
TELEGRAM_TEST_DATABASE_URL=postgresql://assistant:assistant@localhost:5433/assistant_test npm test
```

The integration test creates and drops its own temporary schema. It covers one-use linking, authentication, private chats, public policy access in secure mode, demo ID selection, failed delivery retries, and concurrent idempotency on real PostgreSQL.

Task appointments must be inside Riyadh working hours: Sunday–Thursday 08:00 <= time < 16:00, Saturday 08:00 <= time < 12:00. Friday moves to Saturday at the same time, then Saturday hours are checked; a Friday afternoon appointment therefore requires a new time. Validation runs in the chat service and repository. Existing historical test tasks are retained.

Policy answers quote the six source clauses. Leave applications, medical-report receipt, remote-work approvals, expense approvals and task status updates now share the chat API. Requests appear in the assigned approver’s inbox; this version does not push unsolicited notifications to separate Telegram accounts. See [workflow commands](workflows.md). Missing-report penalties are not specified in the supplied policy.
