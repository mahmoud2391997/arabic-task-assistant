# Capabilities, costs and development plan

Current rules: [قواعد النظام المعتمدة](business-rules.md). Verification: [assessment report](assessment-report.md). The six original policy clauses and subsequent user-authorized exceptions are distinguished explicitly; extensions do not silently replace the assignment's source.

## Delivered capabilities

| Capability | Implementation and limit |
|---|---|
| Arabic intent understanding | Groq structured schema; formal, Saudi and Egyptian Arabic. Ambiguity requests clarification; model accuracy is measured, not guaranteed for every phrase. |
| Task creation and viewing | SQL-backed employee/department/company permissions; ID, description, scheduled time, state and assigning person persist. |
| Task editing | Description and/or schedule; no backdating new schedules; audit before/after values. |
| Task status | Due-day only, after scheduled time, during actual working hours. |
| Dates | Riyadh dates, relative days, next weekdays, Friday shift and Saturday validation. |
| Policy answers | Exact selected policy clauses, explicit unknown answer, user-approved amendments included. |
| Annual leave | Five business-day lead time and supervisor approval; Telegram asks date range. |
| Remote work | One approved working day per Saturday–Friday week; approval concurrency safe. |
| Expenses | 500 boundary and role routing; explicit supervisor/main-manager own-expense exceptions. |
| Medical reports | Return registration, authenticated attachment, receipt deadline, scoped viewing and supervisor accept/reject. No automated clinical validation or invented penalties. |
| Telegram sessions | Private chats, role buttons, context isolation, logout, stale-button checks and retry deduplication. Current live ID-only mode is a user-authorized demo, not verified identity. |
| Notifications | Persisted assignment notices, surfaced once on interaction across API/Telegram; not a proactive push/reminder system. |
| Audit | Transactional mutation entries; manager-wide and department-scoped read views. |
| Deployment | Local Docker, GitHub source, Vercel API and Neon. CI workflow exists; GitHub billing/access/secrets remain external prerequisites. |

## Monthly planning

Use the token formula and pricing sources in [design decisions](decisions.md). State employee count, messages per working day, working days, fraction requiring AI, average input/output tokens including Telegram history, retries, and hosting/database costs. Do not describe the API as unlimited/free or turn a free-tier quota into a production capacity claim.

## One additional week

1. Day 1: expand a versioned live Arabic evaluation set with ambiguous hours, names and follow-ups; retain a failing-case report.
2. Day 2: add persisted API conversations and safe pending-field collection; continue to separate identities and classify mutations explicitly.
3. Day 3: improve approval selection by employee/type only when exactly one authorized candidate exists; otherwise show candidate IDs.
4. Day 4: verified identity rollout, API idempotency keys, application rate limits and durable delivery acknowledgements.
5. Day 5: versioned migrations, restore rehearsal, retention policy and medical-file replacement workflow.
6. Day 6: monitoring, latency/token dashboards, backpressure and provider quota capacity testing.
7. Day 7: complete CI credential/billing setup with the account owner, run clean-install and protected-production gates, record the owner's delivery walkthrough.

This is future work, not a list of already implemented features. No account purchase, billing change or weakening of deployment protection is part of the plan without authorization.
