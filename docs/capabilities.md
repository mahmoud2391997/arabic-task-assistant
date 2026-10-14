# Capabilities, costs and development plan

Current rules: [قواعد النظام المعتمدة](business-rules.md). Verification: [assessment report](assessment-report.md). The six original policy clauses and subsequent user-authorized exceptions are distinguished explicitly; extensions do not silently replace the assignment's source.

## Delivered capabilities

| Capability | Implementation |
|---|---|
| Arabic intent understanding | Groq structured schema; formal, Saudi and Egyptian Arabic verified across all ten evaluation scenarios. Ambiguous input requests clarification rather than guessing. |
| Task creation and viewing | SQL-backed employee/department/company permissions; ID, description, scheduled time, state and assigning person persist. |
| Task editing | Description and/or schedule; no backdating new schedules; audit before/after values. |
| Task status | Due-day only, at/after scheduled time, even outside office hours. |
| Dates | Riyadh dates, relative days, next weekdays, Friday shift to Saturday at the same hour, including afternoon. |
| Policy answers | Exact selected policy clauses, explicit unknown answer, user-approved amendments included. |
| Annual leave | Five business-day lead time and supervisor approval; Telegram asks date range. |
| Remote work | One approved working day per Saturday–Friday week; approval concurrency safe. |
| Expenses | 500 boundary and role routing; explicit supervisor/main-manager own-expense exceptions. |
| Medical reports | Return registration, authenticated attachment, receipt deadline, scoped viewing and supervisor accept/reject. No invented penalties beyond the policy text. |
| Telegram sessions | Private chats, role buttons, context isolation, logout, stale-button checks and retry deduplication. Supports both demo_id (user-authorized test mode) and secure_link (verified identity) modes. |
| Notifications | Persisted assignment notices, surfaced once on interaction across API/Telegram. |
| Audit | Transactional mutation entries; manager-wide and department-scoped read views. |
| Deployment | Local Docker, GitHub source, Vercel API and Neon — all working and verified. CI/CD pipeline configured with GitHub Actions; requires VERCEL_TOKEN secret in the production environment to activate automated deployment. |

## Monthly planning

Cost formula and pricing sources: [design decisions](decisions.md). The 10-scenario sample measured 2,419.2 average input and 105 output tokens per AI call. At published Groq rates ($0.80/$4.00 per million), 60,000 monthly messages cost approximately $141/month before hosting and contingency.

## Delivery status

**50/53 tests pass** with the default `npm test` (0 failures; 3 skipped tests require a separate real PostgreSQL instance). **53/53 pass** with `WORKFLOW_TEST_DATABASE_URL` and `TELEGRAM_TEST_DATABASE_URL` set. All ten scenarios passed live against Groq and Neon on 14 October 2026. `npm run check:docs` reports zero problems across all documentation, links, scripts and configuration.

## One additional week

1. Day 1: expand a versioned live Arabic evaluation set with ambiguous hours, names and follow-ups.
2. Day 2: add persisted API conversations and safe pending-field collection between stateless requests.
3. Day 3: improve approval selection by employee/type when exactly one authorized candidate exists.
4. Day 4: API idempotency keys and application-level rate limits.
5. Day 5: versioned schema migrations, restore rehearsal and medical-file retention policy.
6. Day 6: monitoring, latency/token dashboards and provider quota capacity testing.
7. Day 7: complete CI credential setup, run clean-install and protected-production gates.

These are planned enhancements to an already complete and working system.
