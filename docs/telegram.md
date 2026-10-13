# Telegram

Production bot: https://t.me/MahmoudTasksAI_2026_bot

The bot greets the user and asks for an application employee ID in the same `/start` message. In secure_link mode, access requires a verified account link. The current demo_id mode, explicitly approved by the user, permits ID-only account selection for testing. Authenticated employees request `POST /telegram/link-code` with their employee bearer token and an empty JSON body. It returns a one-use link expiring in ten minutes; only its hash is stored. Opening a valid link grants that Telegram account access to the specified application account. Existing unauthenticated demo bindings do not carry over.

Verified accounts can be changed with “Use User ID 5”, “رقمي التعريفي 5”, or `/employee 5`. A bare ID is accepted only while identification is requested. Invalid or unauthorized switches retain the previous context. Successful switches reset conversation history and pending actions, and invalidate old inline buttons. Each Telegram chat has its own persistent session. Role-specific inline buttons invoke the shared business service; Telegram replies have no classification headings. See [integration contract](integration-contract.md).

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

Task assignments by a supervisor or manager create a persisted recipient notification in the same transaction as the task. It is shown once when the employee identifies their account or next interacts with the bot, with the assigning person’s name. Displaying the notification does not remove or modify the task. Telegram provides no bot event for merely opening a chat without interacting.

API responses also include newly assigned task notifications through the same processor, in the message and a notifications array. A notification shown through API is no longer new in Telegram, and vice versa. Tasks remain available independently of their notification status.
