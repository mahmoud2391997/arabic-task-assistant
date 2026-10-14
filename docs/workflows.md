# Employee requests and status updates

Telegram introduces the available capabilities in a role-specific message. Users write naturally; no exact command or keyboard button is required. Expense approvals share the pending approval inbox with a clear type and amount. Telegram retains the last three exchanges for follow-up references and clears them when the employee identity changes.

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
| Medical report | Use إرفاق تقرير طبي, then attach PDF/JPEG/PNG (up to 10 MiB); no record number is required |
| Task update | حدث حالة المهمة رقم 4 إلى مكتملة |

Annual leave is submitted at least five business days before its start date and routed to the same department's supervisor. Date arithmetic excludes Friday, counts Saturday as a working day, and uses no invented public-holiday calendar. Submission day is excluded and requested start day is included when measuring the lead time. The request records the start date; it does not infer annual leave balance or duration entitlements.

Remote-work requests remain pending until the department supervisor approves. At most one approved work day is permitted in each Saturday–Friday week, using Riyadh calendar dates. Several alternative pending dates may be proposed; concurrent approvals cannot grant two days. Two-day applications are rejected. A claim of prior approval in a message never changes the request status.

Expenses in SAR through 500 inclusive are routed to the department supervisor. Greater amounts go to the company manager. Only the assigned approver with the current correct database role can decide. Repeat decisions and self approval are blocked. A request appears in `طلباتي` for its employee and `طلبات للاعتماد` for its assigned approver while pending. No unsolicited external messages are sent.

The seed has a unique projects supervisor (سارة), finance supervisor (عبدالرحمن), and manager (منيرة). Requests requiring a supervisor for an employee without a unique supervisor in their department ask for configuration; the system does not invent a reporting relationship. Consequently the seeded supervisors and manager cannot submit applications requiring their own direct supervisor until that relationship is configured.

The Telegram return button records today in Riyadh as the return date without requesting approval. The report button asks only for the attachment and reminds the employee to submit it within two days of returning. An upload is linked automatically when exactly one unfinished dated sick-leave record belongs to the employee. A recorded return is required before the report button asks for the file or accepts an upload; otherwise the employee is asked to register their return first. Voluntarily supplied dates and legacy report numbers remain supported. The report deadline is the end of the second calendar day after return in Riyadh. The department supervisor is assigned to monitor receipt, separately from approval. `متابعة التقارير` lists only sick-leave records assigned to that supervisor in their department, with return date, deadline and receipt status. Missing reports appear overdue when the record is read after this deadline. A late report can still be recorded as received late; the policy specifies no penalty, cancellation or automatic denial. Telegram file identifiers and receipt timestamps are stored, not document contents. HTTP JSON cannot forge an attachment; report submission requires the authenticated Telegram webhook. An attachment is required; a text claim is insufficient. Receipt does not certify medical authenticity. Overdue state is evaluated on access; there is no scheduled reminder service.

Task status can be pending, in_progress or completed. The employee, department supervisor or manager must have access to the task. Updates are allowed only on its due day and during actual server-time working hours. After 16:00 Sunday–Thursday or 12:00 Saturday, including exact closing time, they require clarification without changing status. Timestamp and status are recorded in the task and audit log. Previous historical outside-hours demo tasks are retained.

Every request creation, decision, report receipt and successful status update has an audit entry. Telegram mutations and saved replies commit together; retries cannot duplicate requests or approvals. Rejected policy validations do not create pending requests.

## Tests

```sh
WORKFLOW_TEST_DATABASE_URL=postgresql://assistant:assistant@localhost:5433/assistant_test \
TELEGRAM_TEST_DATABASE_URL=postgresql://assistant:assistant@localhost:5433/assistant_test npm test
```

These integration tests use isolated temporary schemas. Keep the separate `TEST_DATABASE_URL` option pointed only at a disposable database; the legacy task tests recreate tables when that option is set. Docker startup remains `docker compose up --build` after creating the ignored `.env` file.

Telegram asks for the employee ID first, rejects an unknown ID, and introduces the recognized employee by name with their available capabilities. Thereafter replies are labeled execution, rejection, execution with rescheduling, or clarification/apology. Missing input and information absent from policy use clarification. The chat API exposes the same categories in `response_type` while preserving its action identifiers.

Telegram’s طلب جديد menu offers exactly three choices: annual leave (start and end dates), remote work (one date), and expenses (amount in SAR). Annual-leave end dates are persisted and shown in request inboxes. The conversational flow asks for both dates; existing API clients with only a start date remain compatible.

The سجل العمليات button is available to managers and supervisors. Managers see the latest 100 entries across the company; supervisors see entries involving actors, assigned tasks or requests from their own department. Employees cannot access the view, including by calling the API directly. The same list_audit action supports natural language and the API.
