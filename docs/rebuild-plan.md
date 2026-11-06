# Rebuild plan: Flutter client + Helidon server

Branch: `rebuild/flutter-helidon`. Scope: the same app (LumiEther Research leave management + payslips), same
Postgres schema, same rules, same tests. Nothing here changes behaviour. The current Next.js code stays in
place as the reference until the rebuild is accepted; the new code goes in two new folders.

## 0. Ground rules

- **Source of truth is the code and its tests, not CLAUDE.md.** Where they differ, the plan follows the code
  and lists the difference in section 6 so you can decide.
- **Schema and migrations are untouched.** `db/migrations/001..004` are reused as they are, including the
  `schema_migrations` bookkeeping table and the `-- split` convention.
- **PDF service and cron secret check are ported, not redesigned.** `pdf-service/` is untouched. The bearer
  check keeps its rules: exact match, 16+ char secret, unauthorised callers get a bare 404.
- **No dependency is added without your approval** (CLAUDE.md rule). Section 5 lists what I would ask for.
- **Employees never see their allowance, total or remaining days.** This was easy in Next (the page just
  didn't render it). With a JSON API it is a leak risk, so employee endpoints get their own response types
  and a test that the fields are absent.

## 1. Target architecture

```
backend/    Helidon SE 4 (Java 21, virtual threads), Maven. REST/JSON under /api.
client/     Flutter app (one codebase, role-based navigation: admin / employee).
db/         unchanged migrations.      pdf-service/   unchanged.
docs/       this file.
```

- Server components + server actions become REST endpoints. All validation, all rules and all messages stay
  on the server, so the Flutter client only renders what the server says (same error strings as today).
- Session: the same signed token (`base64url(JSON{sub,role,exp,v}).HMAC-SHA256`, 7 days, `v` = first 16 hex
  of SHA-256 of the stored password hash). The server re-reads the user on every request, so removing an
  account or changing a password signs sessions out immediately, as now. Delivered as an
  `Authorization: Bearer` header instead of a cookie (decision 1, section 7).
- DB: plain JDBC with a single pool (max 5, reading `DATABASE_URL`, converted to a JDBC URL), same SQL as
  `store.ts`. Reads retry on network errors (2 retries, 200 ms growing pause); writes never retry.
- "Today" is the calendar day in `Asia/Kolkata` (`java.time`, not the server's zone).

## 2. Feature checklist and equivalents

### 2.1 Auth and accounts

| # | Feature (current app) | Server (Helidon) | Flutter |
|---|---|---|---|
| A1 | Sign in; one generic "Incorrect email or password." for every failure; real reason only in the server log | `POST /api/auth/login`; `Authenticator` ports `authenticate()` incl. one scrypt check on every path (DUMMY_HASH for unknown email) | Login screen, keeps typed email on failure |
| A2 | Bootstrap admin from `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` while there are zero admins, saved as a normal admin; race-safe via unique index | same logic, same failure reasons | none |
| A3 | Session lookup on every request, role from the account not the token, password-fingerprint check | `AuthFilter` + `requireRole` (401 signed out, 403 wrong role) | Token store; role-based home (`/admin` or `/employee`); 401 sends to login |
| A4 | Sign out | `POST /api/auth/logout` (client discards token; server stateless as today) | Sign-out action |
| A5 | Change own password (current/new/confirm rules, 8..128 chars, must differ); re-issues a session on this device, other sessions die | `POST /api/account/password` returns a fresh token | Change-password screen (both roles) |
| A6 | Add admin (any email, temp password), remove admin (not yourself, not the last; DB trigger `last_admin` backs it up) | `/api/admin/admins` | Admins screen |
| A7 | Password hashing `scrypt:<salt>:<hash>` | see hard part H1 | none |

### 2.2 Employees and policy (admin)

| # | Feature | Server | Flutter |
|---|---|---|---|
| E1 | Add employee: Gmail only, joining date (>= 2000-01-01), category, temp password, optional salary and designation; name derived from the email; email unique across admins + employees + bootstrap email, any case; `HR-EMP-nnnnn` code from the DB sequence | `POST /api/admin/employees` | Employees screen + add form |
| E2 | Change category | `PATCH .../{id}/category` | row action |
| E3 | Edit salary and designation (blank clears) | `PATCH .../{id}/payroll` | dialog |
| E4 | Delete employee (cascades requests, claims, permissions, payslips) | `DELETE .../{id}` | confirm dialog |
| E5 | Leave policy: whole days 0..366 for each of the 4 categories, applies to everyone in the category at once | `PUT /api/admin/leave-policy` | Leave policy screen |
| E6 | Holidays: the 4 seeded national holidays, read only | `GET /api/holidays` | Holidays screen (employee), timeline widget (dashboards) |

### 2.3 Leave, comp-off, permissions

| # | Feature | Server | Flutter |
|---|---|---|---|
| L1 | Apply casual/sick leave: full days, range, or half day (single day; `to` ignored); validation order and every message as in `requests.ts` (this year .. end of next year, max 90 days, nothing-to-take-off, overlap with live leave) | `POST /api/employee/leave` | My leave: request form with native date pickers + list |
| L2 | Block a request that would take the balance below zero in any year it touches; message never says by how much | same `checkLeaveRequest` | inline form error |
| L3 | Cancel: pending is withdrawn at once; approved and not yet started becomes a cancellation request; started or already requested is refused | `POST /api/employee/leave/{id}/cancel` | row action |
| L4 | Claim comp-off for a past weekend/national holiday (1 day, 0.5 for half); not before this year or joining date; no duplicate live claim (rejected can be re-claimed; unique index backs it) | `POST /api/employee/comp-off` | Comp-off screen |
| L5 | Admin approves/rejects pending leave and comp-off; for a cancellation request approve = cancelled, reject = stays approved | `POST /api/admin/requests/{id}/decision` (same single-statement SQL) | Pending card on dashboard |
| L6 | Log a permission (a few hours, one working day, <= 8h, reason <= 200, no overlap with a permission or live leave); never deducted | `POST /api/employee/permissions`; `GET` for the employee and for the admin | Permissions screens (employee: form + list; admin: list) |
| L7 | Balance engine: weekends and holidays not deducted; sick counts; comp-off lots expire on the first joining anniversary after the day earned (usable up to the day before); spend soonest-expiring first (ties: earliest earned), a lot can't cover days before it was earned; half days | `LeaveEngine` (port of `leave.ts`, `dates.ts`) | none (server computes) |
| L8 | Employee dashboard: only "Leave applied" (approved / waiting), comp-off available + waiting, upcoming holidays | `GET /api/employee/dashboard` | Dashboard |
| L9 | Admin dashboard: awaiting-decision list (pending + cancellation requests), on leave today, next holiday, leave-by-month bars (approved vs pending), who's out this week (Mon-Sun), balance table for all employees | `GET /api/admin/dashboard` | Dashboard; bars drawn with plain widgets, no chart package |

### 2.4 Payslips

| # | Feature | Server | Flutter |
|---|---|---|---|
| P1 | Admin generates a payslip: basic > 0, optional deduction (blank = 0, <= basic), paise arithmetic, month >= 2000-01; nothing is saved unless the PDF rendered | `POST /api/admin/payslips` | Payslips screen + form |
| P2 | Existing published payslip for that month: ask first (`confirm`), overwrite only with `replace`; a draft is overwritten without asking and published; a failed re-render keeps the old one | same states | confirm dialog |
| P3 | PDF through the WeasyPrint service: template + logo inlined, `POST /render`, 30 s timeout, must start with `%PDF`, messages "PDF service is not running" etc. | `PdfClient` (Java `HttpClient`), template filled with the same regexes and escaping | none |
| P4 | Monthly drafts (zero LOP) for everyone with a salary who had joined by month end and has no payslip; never overwrites; stops at once if PDF service is down | `GET /api/cron/payslips` + same guard | none |
| P5 | Publish a draft | `POST /api/admin/payslips/{id}/publish` | row action |
| P6 | Lists: admin sees the chosen month (default current IST month); employee sees only own **published** payslips, newest first | `GET` endpoints | Payslips screens |
| P7 | Download: admin any, employee own and published only, everyone else 404; `Cache-Control: private, no-store`; filename `Payslip_<code>_<yyyy-mm>.pdf` | `GET /api/payslips/{id}/pdf` | download/open action |

### 2.5 App chrome (from CLAUDE.md's visual direction, carried over)

Violet-600 accent on a zinc palette, light and dark theme with a toggle, grouped sidebar (drawer under 768 px),
sticky header with avatar + role badge, status badges (amber/emerald/rose with dot + text), stat cards, empty
state, inline error with retry, SnackBar in place of sonner toasts, running-figure loader on every route
change, tabular figures, reduced-motion respected. Tables become stacked cards on narrow screens. Design
tokens live in one `ThemeData` file; no hard-coded colours in widgets.

## 3. Hard parts

**H1. Password compatibility (needs a decision).** Stored hashes are Node `scrypt` (N=16384, r=8, p=1,
64-byte key, NFKC-normalised password, `scrypt:<salt>:<hash>` base64url). The JDK has no scrypt. To keep
existing logins and the unchanged schema working I need either Bouncy Castle (`bcprov`, one dependency) or
a hand-written scrypt (not recommended for a security primitive). Verified with fixtures generated by the
existing `scripts/hash-password.mjs`, so Java is proven against Node's output, not just against itself.

**H2. Employees must not learn their allowance.** Separate DTOs per role; a test serialises every employee
endpoint and asserts that `leaveAllowance`, `total`, `remaining` and similar keys are absent.

**H3. Date semantics.** The TS code uses local-midnight `Date`s. Java uses `LocalDate`. Must match: Mon-Sun
weeks, 29 Feb joiners (anniversary on 28 Feb in non-leap years), holidays repeat yearly by month/day,
a holiday on a weekend isn't double-removed, ranges crossing a year boundary count only days in that year,
`today` is IST.

**H4. Half days.** Weights are 1 or 0.5, so `double` sums are exact; kept as `double` to mirror the TS maths.
Comp-off lots and the soonest-expiry ordering use ISO-date string comparison today; `LocalDate` ordering is
equivalent.

**H5. Faithful quirks.** Ported as they are, and flagged if they look wrong, not silently fixed: comp-off
consumption is computed per year (only that year's leave days are spent against lots); `pastLeaveDays` is an
empty map and the dashboard trend snapshot is all zeros; the admin-email check includes the bootstrap
`ADMIN_EMAIL`; `resolveRequest` is a single guarded UPDATE.

**H6. Database details through JDBC.** `numeric` as text/`BigDecimal` for money (then paise `long`),
`bytea` for the PDF, `uuid` params, `date`/`time` to ISO strings, `unique_violation` = SQLState `23505`,
the `last_admin` trigger error surfaced from SQLState `P0001`, the `xmax <> 0` insert-vs-overwrite trick in
`savePayslip` (works unchanged), Neon `postgres://` URL to a JDBC URL with SSL.

**H7. Migrations without Node.** A small Java runner reads the same `db/migrations/*.sql`, splits on
`-- split`, runs each file in one transaction and records it in the same `schema_migrations` table. Running it
over a database already migrated by `scripts/migrate.mjs` must do nothing.

**H8. The monthly job has no scheduler any more.** Vercel Cron is gone with Vercel. The endpoint and its
secret check are ported unchanged, and a host cron job on the VM calls it on the 1st (decision 3, section 7).

**H9. Payslip download in Flutter.** The PDF needs the auth header, so it can't be a plain link. The client
fetches bytes and starts a browser download from a Blob. Web only, so no platform differences (decision 1).

**H10. DB-backed tests.** They truncate tables, so they run only against `DATABASE_URL_TEST`, with the same
guard that refuses to run when it points at the real database (including same-host). Concurrency tests (two
admins deleting each other, double claim, double bootstrap) need real parallel connections.

## 4. Phases

Each phase ends with: tests run and output shown, commit `phase N: <name>` on `rebuild/flutter-helidon`,
then stop for your review. Nothing is pushed.

**Phase 1: Foundation + auth.** Maven and Flutter scaffolds, config, pool, migration runner, health route,
error format, auth filter. Scrypt, tokens, login/logout/me, bootstrap admin, change password, admin add/remove
with the last-admin rule. Flutter: theme tokens, shell, login, role routing, change password, loader.
Tests ported: `auth.test.ts` (hashing, tokens, password-change validation, new-admin validation, employee
validation), `store.test.ts` groups "signing in", "changing a password", "admins", `retry.test.ts`, migration
idempotency. Needs: H1, H6, H7, H10.

**Phase 2: Employees, categories, holidays.** E1-E6 on server and client, plus the rest of
`store.test.ts` "employees and holidays" and "leave categories" (less the leave-blocking cases, which need
phase 3), and the payroll-validation tests from `payslip.test.ts` ("salary and designation").

**Phase 3: Leave engine and requests.** Pure engine first (`dates.test.ts`, `leave.test.ts`,
`requests.test.ts` ported 1:1), then the database parts: leave, cancellation, comp-off, permissions,
approve/reject, both dashboards, plus the category-days-limit tests from phase 2. Includes H2's
no-allowance-leak test.

**Phase 4: Payslips, PDF, cron.** Money and words, template, PDF client, generate/replace/confirm, drafts,
publish, access rules, download, cron endpoint. All of `payslip.test.ts` ported, using a fake renderer where
the TS tests do, and one end-to-end run against the real `pdf-service` container.

**Phase 5: Parity audit and hardening.** Run the Next.js app and the Helidon server against the same test
branch with the same inputs and compare responses for the rules that matter (balances, comp-off, access).
Final full test run, README for the new layout, list of any behavioural differences found.

### Test mapping

| TypeScript | Java (`backend/src/test`) | Needs DB |
|---|---|---|
| `dates.test.ts` | `DatesTest` | no |
| `leave.test.ts` | `LeaveEngineTest` | no |
| `requests.test.ts` | `RequestsTest` | no |
| `retry.test.ts` | `RetryTest` | no |
| `auth/auth.test.ts` | `AuthTest` (+ Node-generated hash fixtures) | no |
| `store.test.ts` | `StoreTest*` (employees, signing in, passwords, admins, leave, cancel, comp-off, categories, permissions) | yes |
| `payslip/payslip.test.ts` | `PayslipMoneyTest`, `PayslipTemplateTest`, `PdfClientTest`, `PayslipStoreTest`, `PayslipDraftTest` | partly |

The count per file is checked against the TS test names (listed by `grep` of `test(`) so none are dropped.
Flutter gets widget tests for the screens and form states (loading, empty, error); it does not re-test rules.

## 5. Dependencies (nothing is added yet)

Approved: Bouncy Castle (scrypt, H1).
Still to be approved before use. Backend: Helidon SE (webserver, config-yaml, http-media jackson or jsonp),
PostgreSQL JDBC driver, HikariCP (Helidon has no pool of its own), JUnit 5. Client (web only): `http` and
`shared_preferences` (token). State management with the SDK's own `ChangeNotifier`, navigation with the SDK's
`Navigator`, PDF download with the SDK's web interop, date and time pickers with `showDatePicker` and
`showTimePicker`, so no `go_router`, `flutter_secure_storage`, `share_plus` or `open_filex`.

## 6. Where CLAUDE.md and the code disagree (plan follows the code)

1. Admin "applies leave for anyone", "manages the national holidays" and "sets joining dates": the code has
   no admin apply-leave action, no holiday editing (the 4 are seeded and read-only), and joining date is set
   only when adding an employee. Nav entries for admin Leave requests, Comp-off and Holidays are `ready: false`.
2. Approve/reject lives on the admin dashboard card, not on separate pages.
3. CLAUDE.md's stack rules (shadcn, Tailwind, next-themes, sonner, lucide, framer-motion) don't apply to
   Flutter. Only the visual direction and the state rules carry over.
4. CLAUDE.md says "stop after each screen"; your message says stop after each phase. I'll stop per phase
   and send screenshots for all screens in it.

## 7. Decisions (answered)

1. **Target: Flutter web only for now.** Token is kept in browser storage (`shared_preferences` on web, i.e.
   localStorage) and sent as `Authorization: Bearer`. No `flutter_secure_storage`, no `go_router` unless
   needed for deep links (to be asked then). Payslip download: fetch bytes with the header, then trigger a
   browser download from a Blob (needs `package:web`/`dart:js_interop`, SDK-side, no extra package).
2. **Hosting: the Oracle VM, Docker containers, behind the existing Traefik.** Containers: `backend`
   (Helidon), `client` (Flutter web build served by a static server such as nginx), `pdf` (the existing
   `pdf-service`, unchanged, internal network only). Postgres stays on Neon via `DATABASE_URL`. Traefik routes
   `/api` to the backend and everything else to the client on one hostname, so the browser sees one origin
   and no CORS is needed. Secrets (`DATABASE_URL`, `SESSION_SECRET`, `CRON_SECRET`, `ADMIN_*`) come from an
   env file on the VM, never baked into images. The Traefik labels need the VM's existing entrypoint, network
   and cert-resolver names; I will ask for them in phase 1 rather than guess.
3. **Cron: a host cron job on the VM** on the 1st (`30 0 1 * *`; the VM's cron time zone to be confirmed,
   since the schedule was written for UTC) calling `GET /api/cron/payslips` with
   `Authorization: Bearer $CRON_SECRET`. The endpoint is not exposed to the internet more than today: it
   still answers 404 to anyone without the secret. The secret check is ported unchanged. A sample crontab line
   and a wrapper script go in the README.
4. **Bouncy Castle approved** for scrypt (H1). Tested against hashes produced by the existing
   `scripts/hash-password.mjs` (fixtures committed, plus a test that calls Node live when it is installed).
5. **`scripts/hash-password.mjs` and `scripts/migrate.mjs` stay untouched.** The Java migration runner
   (H7) is an addition, used by the backend's tests and container start-up check.
6. **CLAUDE.md vs code: follow the code.** The CLAUDE.md-only features are in section 8, not in phases 1-5.

## 8. CLAUDE.md-only features (not in the phases above)

Not built by the current app, so not part of the parity rebuild. Estimates are working days for one person
including server, Flutter screen, tests and review, and assume the phases above are done. Each changes
behaviour, so none starts without your go-ahead.

| Feature | Extra days | What it involves and what needs deciding |
|---|---|---|
| **Admin applies leave for anyone** | 1.5 to 2 | New endpoint taking an employee id, reusing the same validation and balance check; an admin picker in the leave form. Decide: does it skip the approval step (created as approved) or stay pending; may it override the balance check; does the employee get any notice. |
| **Holiday editing** | 2 to 3 | Add, rename, move or remove holidays on the existing `holidays` table (no schema change; `unique(month, day)` already there). Changes shift past balances, comp-off eligibility and permission rules because holidays are read at calculation time. CLAUDE.md says exactly 4, so decide: edit those 4 only, or allow more; whether past years keep the old dates. |
| **Joining-date editing** | 1 to 1.5 | One field on the employee edit dialog plus validation (same 2000-01-01 floor). Changing it moves the expiry of every existing comp-off lot and the payslip eligibility test, so decide whether it rewrites history, applies only to future claims, or is blocked once the employee has comp-off or payslips. |

Total if all three are wanted: roughly 4.5 to 6.5 days.
