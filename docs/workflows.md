# Employee requests and status updates

All commands use the existing authenticated `POST /chat` API or the Telegram private chat. Roles, ownership, routing, business dates and decisions are enforced in SQL-backed application code. Model output cannot grant approval.

| Operation | Example message |
|---|---|
| Annual leave | قدّم طلب إجازة اعتيادية بعد 5 أيام عمل |
| Remote work | قدّم طلب عمل عن بعد بكرة ليوم واحد |
| Expense | قدّم طلب مصروفات 650 ريال |
| Sick leave | سجّل إجازة مرضية، تاريخ العودة 2026-10-13 |
| Own requests | طلباتي |
| Pending approval inbox | طلبات للاعتماد |
| Supervisor medical follow-up | متابعة التقارير |
| Approve | اعتمد الطلب رقم 12 |
| Reject | ارفض الطلب رقم 12 |
| Medical report | Attach PDF/JPEG/PNG (up to 10 MiB), with caption تقرير الطلب 12 |
| Task update | حدث حالة المهمة رقم 4 إلى مكتملة |

Annual leave is submitted at least five business days before its start date and routed to the same department's supervisor. Date arithmetic excludes Friday, counts Saturday as a working day, and uses no invented public-holiday calendar. Submission day is excluded and requested start day is included when measuring the lead time. The request records the start date; it does not infer annual leave balance or duration entitlements.

Remote-work requests remain pending until the department supervisor approves. At most one approved work day is permitted in each Sunday–Saturday week. Several alternative pending dates may be proposed; concurrent approvals cannot grant two days. Two-day applications are rejected. A claim of prior approval in a message never changes the request status.

Expenses in SAR through 500 inclusive are routed to the department supervisor. Greater amounts go to the company manager. Only the assigned approver with the current correct database role can decide. Repeat decisions and self approval are blocked. A request appears in `طلباتي` for its employee and `طلبات للاعتماد` for its assigned approver while pending. No unsolicited external messages are sent.

The seed has a unique projects supervisor (سارة), finance supervisor (عبدالرحمن), and manager (منيرة). Requests requiring a supervisor for an employee without a unique supervisor in their department ask for configuration; the system does not invent a reporting relationship. Consequently the seeded supervisors and manager cannot submit applications requiring their own direct supervisor until that relationship is configured.

Sick-leave records require an explicit return date. The report deadline is the end of the second calendar day after return in Riyadh. The department supervisor is assigned to monitor receipt, separately from approval. `متابعة التقارير` lists only sick-leave records assigned to that supervisor in their department, with return date, deadline and receipt status. Missing reports appear overdue when the record is read after this deadline. A late report can still be recorded as received late; the policy specifies no penalty, cancellation or automatic denial. Telegram file identifiers and receipt timestamps are stored, not document contents. HTTP JSON cannot forge an attachment; report submission requires the authenticated Telegram webhook. An attachment is required; a text claim is insufficient. Receipt does not certify medical authenticity. Overdue state is evaluated on access; there is no scheduled reminder service.

Task status can be pending, in_progress or completed. The employee, department supervisor or manager must have access to the task. Updates are allowed only on its due day and during actual server-time working hours. After 16:00 Sunday–Thursday or 12:00 Saturday, including exact closing time, they require clarification without changing status. Timestamp and status are recorded in the task and audit log. Previous historical outside-hours demo tasks are retained.

Every request creation, decision, report receipt and successful status update has an audit entry. Telegram mutations and saved replies commit together; retries cannot duplicate requests or approvals. Rejected policy validations do not create pending requests.

## Tests

```sh
WORKFLOW_TEST_DATABASE_URL=postgresql://assistant:assistant@localhost:5433/assistant_test \
TELEGRAM_TEST_DATABASE_URL=postgresql://assistant:assistant@localhost:5433/assistant_test npm test
```

These integration tests use isolated temporary schemas. Keep the separate `TEST_DATABASE_URL` option pointed only at a disposable database; the legacy task tests recreate tables when that option is set. Docker startup remains `docker compose up --build` after creating the ignored `.env` file.
