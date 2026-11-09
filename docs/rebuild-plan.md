# Rebuild plan: React (Vite) frontend + Helidon backend

Scope: the same app (LumiEther Research leave management + payslips), same Postgres schema and migrations,
same rules, same tests. Nothing here changes behaviour. The current Next.js code stays in place as the reference
until the rebuild is accepted. The new code lives in `backend/` (done so far) and `frontend/` (not started).

## Status

| Part | State |
|---|---|
| **Backend, Phase 1** (sign-in, sessions, change password, admins, health, migrations) | **Done.** Committed in `dc3e6d6`; since then, uncommitted: a cap on concurrent scrypt hashes, `HEAD /api/health`, the Docker packaging in `deploy/`, and the **cookie session** (`lr_session`, own secret `LR_COOKIE_SECRET`, `Origin` and JSON checks, no Bearer path, no CORS, `SESSION_SECRET` retired). 108 backend tests pass; the stress and correctness suite passes through the cookie flow. |
| **Stress test** (sign-in ladders, 3,400 req/s signed-in traffic, concurrency races, hostile input, burst, 60 s soak) | **Passed** with 0 failed checks and 0 server errors on 2 CPUs / 768 MiB. Results and sizing are in `deploy/README.md`. |
| **Docker** | **Backend image builds and runs.** The web image needs the frontend, which does not exist yet. |
| **Frontend** | **Started.** The Vite + TypeScript project and the shell (sidebar, drawer, header, theme toggle, loader, the shadcn parts it needs) are built, with 25 behaviour tests and a measured layout check against the current app. The login screen is next; the shell is shown to a stand-in user in development only. |
| **Everything after Phase 1** (employees, leave, comp-off, permissions, dashboards, payslips, cron) | Not started. |

## 0. Ground rules

- **Source of truth is the code and its tests, not CLAUDE.md.** Where they differ, the plan follows the code
  and lists the difference in section 6 so you can decide.
- **Schema and migrations are untouched.** `db/migrations/001..004` are reused as they are, including the
  `schema_migrations` bookkeeping table and the `-- split` convention.
- **The WeasyPrint PDF service and the cron secret check are ported, not redesigned.** `pdf-service/` is
  untouched. The bearer check keeps its rules: exact match, 16+ char secret, unauthorised callers get a bare 404.
- **The current app and `~/lumiether-website` are not touched.** The current app is only run, read-only in spirit,
  as the reference for behaviour and for pixel comparison.
- **No dependency is added without your approval** (CLAUDE.md rule). Section 5 gives every package its status.
  Everything on your lists is approved. Nothing is installed until its line says "approved". "Plain React" means React and Vite with only those: no Next.js, no state
  library. Styling is Tailwind CSS, with shadcn components built on Base UI.
- **Employees never see their allowance, total or remaining days.** This was easy in Next (the page just
  didn't render it). With a JSON API it is a leak risk, so employee endpoints get their own response types
  and a test that the fields are absent.

## 1. Target architecture

```
backend/    Helidon SE 4 (Java 21, virtual threads), Maven. REST/JSON under /api.        [Phase 1 built]
frontend/   React + Vite single-page app, one app with admin and employee routes.         [to build]
db/         unchanged migrations.        pdf-service/   unchanged WeasyPrint service.
deploy/     Docker: backend image, web image (nginx + the built frontend), compose, stress harness.
docs/       this file.
```

- **Server components and server actions become REST endpoints.** All validation, all rules and all messages
  stay on the server, so the frontend only renders what the server says (same error strings as today).
- **One origin in production.** The web container (nginx) serves the built frontend and proxies `/api` to the
  backend, so there is no CORS. In development the Vite dev server proxies `/api` to the backend on 8081, which
  also needs no CORS.
- **Real URLs.** The frontend uses client-side routes that mirror the current app's paths (`/login`, `/admin`,
  `/admin/employees`, `/employee/leave`, ...), so the back button, reloads and deep links work. nginx falls back
  to `index.html` for any path that isn't a file or `/api`.
- **Session:** a signed token in the same format as today (`base64url(JSON{sub,role,exp,v}).HMAC-SHA256`, 7 days,
  `v` = first 16 hex of SHA-256 of the stored password hash), delivered in an `httpOnly` cookie named `lr_session`
  (`SameSite=Lax`, `Secure` in production, path `/`, 7 days), so no script on the page can ever read it (decision 9).
  The cookie is signed with its **own secret**, read from a new environment variable, `LR_COOKIE_SECRET`
  (32+ random characters, generated separately). `SESSION_SECRET` is **retired for the rebuild**: the backend no
  longer reads it (decision 19). Because both the name and the secret differ from the current app's, a session from
  the current app is not accepted: **every user signs in again at cutover.** The server re-reads the user on every
  request, so removing an account or changing a password signs sessions out immediately, as now. This replaces the
  Bearer-header token the Phase 1a backend uses today; that change is the first job of Phase 1b. The CSRF defence
  that goes with a cookie is in H11.
- **Data loading:** each route fetches its data when it opens. While waiting it shows the running-figure loader,
  on failure an inline alert with a Retry button, and when there is nothing to show an empty state, as the
  current app's `loading.tsx` / `error.tsx` / empty states do.
- **DB:** plain JDBC with a single pool (max 5, reading `DATABASE_URL`, converted to a JDBC URL), same SQL as
  `store.ts`. Reads retry on network errors (2 retries, 200 ms growing pause); writes never retry.
- **"Today"** is the calendar day in `Asia/Kolkata` (`java.time`, not the server's zone).

## 2. Feature checklist and equivalents

### 2.1 Auth and accounts

| # | Feature (current app) | Server (Helidon) | React frontend |
|---|---|---|---|
| A1 | Sign in; one generic "Incorrect email or password." for every failure; real reason only in the server log | `POST /api/auth/login`; `Auth` ports `authenticate()` incl. one scrypt check on every path (DUMMY_HASH for unknown email); sets the `lr_session` cookie and returns the user, with no token in the body | `/login`: keeps the typed email on failure, "Signing in…" state |
| A2 | Bootstrap admin from `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` while there are zero admins, saved as a normal admin; race-safe via unique index | same logic, same failure reasons | none |
| A3 | Session lookup on every request, role from the account not the token, password-fingerprint check | `Sessions` reads the cookie, plus the role check (401 signed out, 403 wrong role); an `Origin` check on every state-changing request (H11) | Auth provider holding the user only (the cookie is invisible to scripts); `GET /api/auth/me` on load; route guards: signed out goes to `/login`, wrong role goes to your own home; any 401 on a signed-in call clears the session and shows "You were signed out"; `/` redirects by role |
| A4 | Sign out | `POST /api/auth/logout` clears the cookie (`Max-Age=0`); the token itself stays stateless as today | Log out button in the header |
| A5 | Change own password (current/new/confirm rules, 8..128 chars, must differ); re-issues a session on this device, other sessions die | `POST /api/account/password` replaces the cookie with a fresh one | `/admin/password`, `/employee/password`; nothing to swap on the client, the new cookie arrives with the response |
| A6 | Add admin (any email, temp password), remove admin (not yourself, not the last; DB trigger `last_admin` backs it up) | `/api/admin/admins` | `/admin/admins`: list, add form, remove dialog |
| A7 | Password hashing `scrypt:<salt>:<hash>` | see hard part H1 | none |

### 2.2 Employees and policy (admin)

| # | Feature | Server | React frontend |
|---|---|---|---|
| E1 | Add employee: Gmail only, joining date (>= 2000-01-01), category, temp password, optional salary and designation; name derived from the email; email unique across admins + employees + bootstrap email, any case; `HR-EMP-nnnnn` code from the DB sequence | `POST /api/admin/employees` | `/admin/employees`: list + add form (native `<input type="date">`, a `<select>` for category) |
| E2 | Change category | `PATCH .../{id}/category` | row action |
| E3 | Edit salary and designation (blank clears) | `PATCH .../{id}/payroll` | dialog |
| E4 | Delete employee (cascades requests, claims, permissions, payslips) | `DELETE .../{id}` | confirm dialog |
| E5 | Leave policy: whole days 0..366 for each of the 4 categories, applies to everyone in the category at once | `PUT /api/admin/leave-policy` | `/admin/leave-policy` |
| E6 | Holidays: the 4 seeded national holidays, read only | `GET /api/holidays` | `/employee/holidays`; the holiday timeline on both dashboards |

### 2.3 Leave, comp-off, permissions

| # | Feature | Server | React frontend |
|---|---|---|---|
| L1 | Apply casual/sick leave: full days, range, or half day (single day; `to` ignored); validation order and every message as in `requests.ts` (this year .. end of next year, max 90 days, nothing-to-take-off, overlap with live leave) | `POST /api/employee/leave` | `/employee/leave`: request form with native date inputs + the request list (stacked cards on narrow screens) |
| L2 | Block a request that would take the balance below zero in any year it touches; message never says by how much | same `checkLeaveRequest` | inline form error |
| L3 | Cancel: pending is withdrawn at once; approved and not yet started becomes a cancellation request; started or already requested is refused | `POST /api/employee/leave/{id}/cancel` | row action |
| L4 | Claim comp-off for a past weekend/national holiday (1 day, 0.5 for half); not before this year or joining date; no duplicate live claim (rejected can be re-claimed; unique index backs it) | `POST /api/employee/comp-off` | `/employee/comp-off` |
| L5 | Admin approves/rejects pending leave and comp-off; for a cancellation request approve = cancelled, reject = stays approved | `POST /api/admin/requests/{id}/decision` (same single-statement SQL) | pending card on the admin dashboard |
| L6 | Log a permission (a few hours, one working day, <= 8h, reason <= 200, no overlap with a permission or live leave); never deducted | `POST /api/employee/permissions`; `GET` for the employee and for the admin | `/employee/permissions` (form + list; native time inputs), `/admin/permissions` (list) |
| L7 | Balance engine: weekends and holidays not deducted; sick counts; comp-off lots expire on the first joining anniversary after the day earned (usable up to the day before); spend soonest-expiring first (ties: earliest earned), a lot can't cover days before it was earned; half days | `LeaveEngine` (port of `leave.ts`, `dates.ts`) | none (the server computes) |
| L8 | Employee dashboard: only "Leave applied" (approved / waiting), comp-off available + waiting, upcoming holidays | `GET /api/employee/dashboard` | `/employee` |
| L9 | Admin dashboard: awaiting-decision list (pending + cancellation requests), on leave today, next holiday, leave-by-month bars (approved vs pending), who's out this week (Mon-Sun), balance table for all employees | `GET /api/admin/dashboard` | `/admin`; bars drawn with `div`s and CSS, no chart library (CLAUDE.md) |

### 2.4 Payslips

| # | Feature | Server | React frontend |
|---|---|---|---|
| P1 | Admin generates a payslip: basic > 0, optional deduction (blank = 0, <= basic), paise arithmetic, month >= 2000-01; nothing is saved unless the PDF rendered | `POST /api/admin/payslips` | `/admin/payslips`: month picker, list, generate form |
| P2 | Existing published payslip for that month: ask first (`confirm`), overwrite only with `replace`; a draft is overwritten without asking and published; a failed re-render keeps the old one | same states | confirm dialog |
| P3 | PDF through the WeasyPrint service (unchanged): template + logo inlined, `POST /render`, 30 s timeout, must start with `%PDF`, messages "PDF service is not running" etc. | `PdfClient` (Java `HttpClient`), template filled with the same regexes and escaping | none |
| P4 | Monthly drafts (zero LOP) for everyone with a salary who had joined by month end and has no payslip; never overwrites; stops at once if PDF service is down | `GET /api/cron/payslips` + same guard | none |
| P5 | Publish a draft | `POST /api/admin/payslips/{id}/publish` | row action |
| P6 | Lists: admin sees the chosen month (default current IST month); employee sees only own **published** payslips, newest first | `GET` endpoints | `/employee/payslips` |
| P7 | Download: admin any, employee own and published only, everyone else 404; `Cache-Control: private, no-store`; filename `Payslip_<code>_<yyyy-mm>.pdf` | `GET /api/payslips/{id}/pdf` | a plain link, the cookie goes with it (see H9) |

### 2.5 App chrome (the current app's visual direction)

Violet accent on a zinc palette, light and dark theme with a toggle (a `dark` class on `<html>`, as now),
grouped sidebar (a drawer under 768 px) with "Soon" badges on unbuilt items, sticky blurred header with avatar +
role badge, status badges (amber/emerald/rose with dot + text), stat cards, empty state, inline error with
retry, toast for every create/update/approve/reject, the running-figure loader on every route load, reduced
motion respected, tables that become stacked cards on narrow screens. Because the frontend uses Tailwind CSS again, `globals.css` carries over almost
unchanged: the `:root` and `.dark` variable blocks (colour tokens, radii, shadows), `@import "tailwindcss"`,
`@import "tw-animate-css"` (approved), `@custom-variant dark`, `@theme inline`, `@layer base`, the page-in utility and
the loader's keyframes are kept, so colours match by construction and the components' class strings can be copied
from the current app. The one import that changes is `shadcn/tailwind.css`: it comes from the `shadcn` package, which
is not approved, so the handful of `@custom-variant` rules the components use (`data-open`, `data-closed` and
similar) are copied into our own CSS by hand, with no package (decision 21). Tailwind v4 is configured in the CSS file itself, so
there is no `tailwind.config` and no PostCSS setup, only its Vite plugin. The measured sizes and spacings are in
Appendix A.

## 3. Hard parts

**H1. Password compatibility (done).** Stored hashes are Node `scrypt` (N=16384, r=8, p=1, 64-byte key,
NFKC-normalised password, `scrypt:<salt>:<hash>` base64url). The JDK has no scrypt, so the backend uses Bouncy
Castle. Verified with fixtures generated by the existing `scripts/hash-password.mjs`, so Java is proven against
Node's output, not just against itself. Concurrent hashes are capped (2 to 4, like Node's thread pool).

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

**H6. Database details through JDBC (done for Phase 1).** `numeric` as text/`BigDecimal` for money (then paise
`long`), `bytea` for the PDF, `uuid` params, `date`/`time` to ISO strings, `unique_violation` = SQLState
`23505`, the `last_admin` trigger error surfaced from SQLState `P0001`, the `xmax <> 0` insert-vs-overwrite trick
in `savePayslip` (works unchanged), Neon `postgres://` URL to a JDBC URL with SSL.

**H7. Migrations without Node (done).** A small Java runner reads the same `db/migrations/*.sql`, splits on
`-- split`, runs each file in one transaction and records it in the same `schema_migrations` table. Running it
over a database already migrated by `scripts/migrate.mjs` does nothing. The container runs it on start.

**H8. The monthly job has no scheduler any more.** Vercel Cron is gone with Vercel. The endpoint and its
secret check are ported unchanged, and a host cron job on the VM calls it on the 1st (decision 3, section 7).

**H9. Payslip download in the browser.** With the cookie session the download is an ordinary link to
`GET /api/payslips/{id}/pdf`, so no script is involved; the file name comes from `Content-Disposition` and the
response stays `private, no-store`. Links are only shown for payslips the user may have, so the server's bare 404
only appears if something changed underneath them.

**H10. DB-backed tests.** They truncate tables, so they run only against `DATABASE_URL_TEST`, with the same
guard that refuses to run when it points at the real database (including same-host). Concurrency tests (two
admins deleting each other, double claim, double bootstrap) need real parallel connections.

**H11. Session cookie and CSRF (decided: an httpOnly cookie, `lr_session`).** The token lives in an `httpOnly`
cookie, so no script on the page can read or copy it. That matters because this app holds salary data. A cookie is
sent automatically, so state-changing requests need CSRF protection, in layers: `SameSite=Lax` (a cross-site POST,
PUT, PATCH or DELETE does not carry the cookie); the server rejects any POST, PUT, PATCH or DELETE whose `Origin`
(or, failing that, `Referer`) is not in `ALLOWED_ORIGINS`, a config list (the public https address in production,
`http://localhost:5173` in development, set by the developer in their own shell and never in the production env
file); and it requires `Content-Type: application/json`. There is no CORS at
all, so no other site can make credentialed calls, and the old `CORS_ORIGIN` option is removed. `Secure` comes from
a config flag, `COOKIE_SECURE` (on in production behind Traefik's TLS, off on plain `http://localhost`). The cookie
is signed with `LR_COOKIE_SECRET`, a separate secret from `SESSION_SECRET`; if it is unset or shorter than 32
characters nobody can sign in, and that is logged, as it is today for `SESSION_SECRET`. The cron endpoint keeps its
own Bearer secret and ignores cookies. **What a cookie does not do:** a script injected into the page could still
act as the user while the page is open, so the rest stays: React's escaping, no `dangerouslySetInnerHTML`, no
third-party scripts, and a strict Content-Security-Policy (`default-src 'self'`) at nginx. **Cutover:** the cookie
name and secret differ from the current app's, so all users sign in again when the new app replaces it; that is
deliberate. Tests cover the cookie's attributes, rejected cross-origin and non-JSON requests, logout clearing it, a
password change replacing it, and that a Bearer header no longer signs anyone in.

**H12. Routing and guards.** Role redirects must match `requireRole` (signed out to `/login`, wrong role to your
own home), the Soon-badge items must not be links, and a 401 from any call must end the session cleanly. These
are covered by tests, not left to manual clicking.

**H13. Visual parity with the current app.** Achievable exactly, because both are CSS. The method: run the
current app and the new one side by side in Chrome (an iframe of the exact width, since the browser window
can't be resized to 390 or 1280) and compare element rectangles and computed styles. A gotcha seen earlier:
the 1px card, input and badge borders take layout space, which CSS does by default (`box-sizing: border-box`),
so copied class rules keep that.

**H14. Forms without server actions.** Each form posts JSON, shows the server's per-field errors under the
fields, keeps what was typed, disables its button while pending, and toasts on success. Same messages as today.

## 4. Phases

Each phase ends with: tests run and output shown, a commit `phase N: <name>`, then a stop for your review.
Nothing is pushed.

**Phase 1a: Backend foundation + auth. DONE.** Maven scaffold, config, pool, migration runner, health route,
error format, sessions. Scrypt, tokens, login/logout/me, bootstrap admin, change password, admin add/remove with
the last-admin rule. Tests ported: `auth.test.ts` (hashing, tokens, password-change validation, new-admin
validation, employee validation), `store.test.ts` groups "signing in", "changing a password", "admins",
`retry.test.ts`, migration idempotency, plus an HTTP-level suite. Docker image, compose and the stress harness.
(The uncommitted hardening listed under Status is committed with Phase 1b.)

**Phase 1b: Session cookie, then the frontend foundation. IN PROGRESS: the backend step and the frontend project and shell are done; the login, admins and change-password screens are next.**
*Backend first (1 to 1.5 days, section 10) - done, awaiting review:* issue and clear the `lr_session` cookie, signed with
the new `LR_COOKIE_SECRET` (added to `deploy/.env.example` and the compose file). `SESSION_SECRET` stays in the
example env file, marked retired, and is no longer read or required. The `Origin` and content-type checks, drop the
Bearer path for user sessions and the CORS option, update the HTTP tests, switch the stress harness to a cookie jar
and run it again. Then stop for review before any frontend work.
*Then the frontend:* the Vite + TypeScript project in `frontend/` with Tailwind CSS v4 and the tokens from
`globals.css`, Inter as a self-hosted file, the shell (sidebar, drawer, header with theme toggle, avatar, role badge,
log out) with the current components copied in (shadcn on Base UI), `react-router-dom` routes with guards, an API
client with 401 handling, the auth provider, the running-figure loader, toast (`sonner`), dialog and drawer (shadcn
Dialog and Sheet), alert, empty state; and the screens that exist on the backend: login, admins, change password.
Web image and compose wired to the build, with a Content-Security-Policy. Tests: behaviour (loading, empty, error,
form errors, guards, role nav). Screenshots at 1280 and 390 wide, light and dark, side by side with the current app.
Needs: H11, H12, H13, H14.

**Phase 2: Employees, categories, holidays.** E1-E6 on backend and frontend, plus the rest of
`store.test.ts` "employees and holidays" and "leave categories" (less the leave-blocking cases, which need
phase 3), and the payroll-validation tests from `payslip.test.ts` ("salary and designation").

**Phase 3: Leave engine and requests.** Pure engine first (`dates.test.ts`, `leave.test.ts`,
`requests.test.ts` ported 1:1), then the database parts: leave, cancellation, comp-off, permissions,
approve/reject, both dashboards, plus the category-days-limit tests from phase 2. Includes H2's
no-allowance-leak test.

**Phase 4: Payslips, PDF, cron.** Money and words, template, PDF client, generate/replace/confirm, drafts,
publish, access rules, download, cron endpoint. All of `payslip.test.ts` ported, using a fake renderer where
the TS tests do, and one end-to-end run against the real `pdf-service` container, which joins the compose file.

**Phase 5: Parity audit and hardening.** Run the Next.js app and the Helidon server against the same test
database with the same inputs and compare responses for the rules that matter (balances, comp-off, access); compare
pages pixel for pixel (H13). Extend the stress harness to the new endpoints. Final full test run, README, list of
any behavioural differences found.

### Test mapping

| TypeScript | Java (`backend/src/test`) | Needs DB |
|---|---|---|
| `dates.test.ts` | `DatesTest` | no |
| `leave.test.ts` | `LeaveEngineTest` | no |
| `requests.test.ts` | `RequestsTest` | no |
| `retry.test.ts` | `RetryTest` (done) | no |
| `auth/auth.test.ts` | `PasswordTest`, `TokenTest`, `EmployeesTest` (done, with Node-generated hash fixtures) | no |
| `store.test.ts` | `StoreAuthTest` (done), later `StoreTest*` (employees, leave, cancel, comp-off, categories, permissions) | yes |
| `payslip/payslip.test.ts` | `PayslipMoneyTest`, `PayslipTemplateTest`, `PdfClientTest`, `PayslipStoreTest`, `PayslipDraftTest` | partly |
| (new) HTTP layer | `ApiTest`, `MigratorTest` (done) | yes |

The count per file is checked against the TS test names (listed by `grep` of `test(`) so none are dropped.
The frontend gets behaviour tests for the screens and form states (loading, empty, error, guards); it does not
re-test rules, which live on the server. Layout is checked in a real browser, not in a simulated DOM.

## 5. Dependencies

**Backend, approved and in use:** Helidon SE 4.5.6 (webserver), `jackson-databind`, PostgreSQL JDBC driver,
HikariCP (Helidon has no pool of its own), Bouncy Castle (scrypt, H1), JUnit 5.

**Frontend. Nothing is installed yet; exact versions are pinned when it is.**

*Approved by you:*

| Package | Why | Status |
|---|---|---|
| `typescript` | types for the API shapes | approved |
| `vite`, `@vitejs/plugin-react` | dev server, build, React support | approved |
| `react`, `react-dom` | the library itself | approved |
| `@types/react`, `@types/react-dom` (dev only) | React's types for TypeScript | approved |
| `react-router-dom` | client-side routes, guards, nested layouts | approved |
| `tailwindcss` and `@tailwindcss/vite` | Tailwind CSS v4 and its Vite plugin | approved |
| `@base-ui/react` | the behaviour behind shadcn's dialog, drawer, avatar, button and select parts | approved |
| `class-variance-authority` | the variants in shadcn components | approved |
| `tw-animate-css` | the enter and exit animation classes the dialog and drawer use | approved |
| `clsx` and `tailwind-merge` | joined in a three-line local `cn()` helper (`twMerge(clsx(...))`), so a component's own classes and the `className` passed to it resolve the way shadcn expects | approved |
| `lucide-react` | the same icons as the current app, imported one by one | approved |
| `sonner` | the same toasts as the current app | approved |
| `vitest` | test runner | approved |
| `@testing-library/react` | behaviour tests (Testing Library) | approved |
| `@testing-library/user-event` (dev only) | simulates typing and clicking in tests | approved |
| `@testing-library/dom` (dev only) | the DOM core that `@testing-library/react` requires as a peer; npm installs it automatically | approved |
| `jsdom` (dev only) | the browser-like environment Vitest uses for component tests | approved |

*Not a package:* the current app's `cn` package (shadcn's class-name merger) is not used; `cn()` is a small local
helper built from the approved `clsx` and `tailwind-merge`. Likewise `shadcn/tailwind.css` is not imported: the
current app takes it from the `shadcn` package, but it is a small CSS file of `@custom-variant` rules (`data-open`,
`data-closed`, `data-checked`, and so on) that the dialog and drawer classes rely on. The variants the components
actually use are copied by hand into our `globals.css` (with a comment crediting where they came from); no package.

Inter is a self-hosted file under `frontend/public/fonts` with its OFL licence next to it, not a package. If the tests
turn out to need `@testing-library/jest-dom` (extra matchers) I will ask first.

Not used: the `shadcn` CLI package, any chart library, date or date-picker library, UI kit, state-management library,
CSS-in-JS, other animation libraries (`tw-animate-css` and CSS cover the motion), `next-themes` (the theme toggle is
about 20 lines). Dialogs, the mobile drawer and the other building blocks come from shadcn components, as CLAUDE.md
requires, not from hand-rolled code or the native `<dialog>`; pickers use the native `<select>` (decision 15).

## 6. Where CLAUDE.md and the code disagree (plan follows the code)

1. Admin "applies leave for anyone", "manages the national holidays" and "sets joining dates": the code has
   no admin apply-leave action, no holiday editing (the 4 are seeded and read-only), and joining date is set
   only when adding an employee. Nav entries for admin Leave requests, Comp-off and Holidays are `ready: false`.
2. Approve/reject lives on the admin dashboard card, not on separate pages.
3. **Which of CLAUDE.md's stack rules carry over to a Vite single-page app:**
   - *Carry over:* Tailwind CSS; shadcn components, and the rule against hand-rolling tables, dialogs, badges, inputs
     and toasts; Inter; lucide icons only (`lucide-react`); sonner toasts for every
     create/update/approve/reject; no chart libraries; native `<input type="date">`, no date-picker libraries;
     components small and grouped by feature (`leave/`, `holidays/`, `employees/`, `layout/`); design tokens in one
     place (`globals.css`); loading, empty and error states on every screen; dark mode via a class on `<html>`;
     reduced motion.
   - *Don't apply:* "fetch data in server components", "client components only for buttons...", server actions,
     per-route `loading.tsx`/`error.tsx` (replaced by per-route loading and error states), `next-themes`,
     `framer-motion` (never approved).
   - *shadcn (resolved):* CLAUDE.md said "shadcn/ui for all components". shadcn components are now allowed with the
     three approved packages (`@base-ui/react`, `class-variance-authority`, `tw-animate-css`), and CLAUDE.md says so,
     keeping its rule against hand-rolling dialogs and the rest. The `cn` helper and the
     `shadcn/tailwind.css` are resolved (decisions 20 and 21).
4. CLAUDE.md says "stop after each screen"; your message says stop after each phase. I'll stop per phase
   and send screenshots for all screens in it.
5. **Accent colour (resolved).** CLAUDE.md named violet-600 `#7C3AED`, but the live app renders `#7F22FE` (light)
   and `#8E51FF` (dark) from `globals.css`. The rebuild uses the live app's colour, `#7F22FE`, and CLAUDE.md now says so.

## 7. Decisions (answered)

1. **Frontend: a React single-page app built with Vite, plain React, in TypeScript, with `react-router-dom`,
   calling the Helidon JSON API.** The other choices are decisions 9 to 21.
2. **Hosting: the Oracle VM, Docker containers, behind the existing Traefik.** Containers: `web` (nginx serving
   the built frontend and proxying `/api`), `backend` (Helidon), later `pdf` (the existing `pdf-service`, unchanged,
   internal network only). Postgres, with the same schema and migrations, stays on Neon via `DATABASE_URL` (any
   Postgres works). Traefik routes one hostname to `web`, so the browser sees one origin. Secrets (`DATABASE_URL`,
   `SESSION_SECRET`, `CRON_SECRET`, `ADMIN_*`) come from an env file on the VM, never baked into images. Two
   images today; a single combined image is possible if a cloud needs one container. The Traefik labels need the
   VM's existing entrypoint, network and cert-resolver names, which I still need.
3. **Cron: a host cron job on the VM** on the 1st (`30 0 1 * *`; the VM's cron time zone to be confirmed,
   since the schedule was written for UTC) calling `GET /api/cron/payslips` with
   `Authorization: Bearer $CRON_SECRET`. The endpoint still answers 404 to anyone without the secret. The secret
   check is ported unchanged. A sample crontab line and a wrapper script go in the README.
4. **Bouncy Castle approved** for scrypt (H1), and tested against hashes produced by the existing
   `scripts/hash-password.mjs` (fixtures committed, plus a test that calls Node live when it is installed).
5. **`scripts/hash-password.mjs` and `scripts/migrate.mjs` stay untouched.** The Java migration runner
   (H7) is an addition, used by the backend's tests and the container start-up.
6. **CLAUDE.md vs code: follow the code.** The CLAUDE.md-only features are in section 8, not in the phases.
7. **The WeasyPrint service is unchanged**: same container, same `POST /render`, same limits. The backend calls
   it over HTTP in Phase 4.
8. **Development setup:** the backend on 8081, the Vite dev server proxying `/api` to it. Docker only for the
   built images and the stress test.
9. **Session: an `httpOnly` cookie named `lr_session`, not local storage** (your decision, because the app holds
   salary data). It is signed with its own secret from a new environment variable, `LR_COOKIE_SECRET`. All users sign
   in again at cutover. Design, CSRF defence and config in H11. The variable name is my proposal; say if you want a
   different one.
10. **Styling: Tailwind CSS v4 with its Vite plugin, and shadcn components** (on Base UI) copied from the current app.
11. **Icons and toasts: `lucide-react` and `sonner`,** so they match the current app.
12. **Tests: Vitest and Testing Library.** Layout is checked in a real browser, not in a simulated DOM.
13. **Fonts: Inter, a self-hosted file.**
14. **Branch: `rebuild/react-helidon`** (renamed; it had never been pushed, so no remote branch or pull request
    existed under the old name).
15. **Pickers: the browser's native `<select>`.** The popup list looks like the operating system's, not the current
    app's styled one.
16. **Accent colour: `#7F22FE`,** to match the live app. CLAUDE.md is updated.
17. **Companion packages approved:** `react`, `react-dom`, `@types/react`, `@types/react-dom`, `jsdom`,
    `@testing-library/user-event`, and `@testing-library/dom` (the required peer of `@testing-library/react`).
18. **shadcn components are allowed** with `@base-ui/react`, `class-variance-authority` and `tw-animate-css`. The
    CLAUDE.md rule against hand-rolling tables, dialogs, badges, inputs and toasts stays; CLAUDE.md is updated.
19. **`SESSION_SECRET` is retired for the rebuild.** It stays in `deploy/.env.example`, marked retired; the backend
    does not read it and the compose file neither requires nor passes it. The current app, which still uses it, is
    unaffected.
20. **Class merging: `clsx` and `tailwind-merge`,** approved, behind a local `cn()` helper. The `cn` package is not used.
21. **`shadcn/tailwind.css`: its variants are copied by hand into our CSS,** no `shadcn` package.

## 8. CLAUDE.md-only features (not in the phases above)

Not built by the current app, so not part of the parity rebuild. Estimates are working days for one person
including server, React screen, tests and review, and assume the phases above are done. They were written
before the switch to React and not re-estimated; the screens are comparable work. Each changes behaviour, so
none starts without your go-ahead.

| Feature | Extra days | What it involves and what needs deciding |
|---|---|---|
| **Admin applies leave for anyone** | 1.5 to 2 | New endpoint taking an employee id, reusing the same validation and balance check; an admin picker in the leave form. Decide: does it skip the approval step (created as approved) or stay pending; may it override the balance check; does the employee get any notice. |
| **Holiday editing** | 2 to 3 | Add, rename, move or remove holidays on the existing `holidays` table (no schema change; `unique(month, day)` already there). Changes shift past balances, comp-off eligibility and permission rules because holidays are read at calculation time. CLAUDE.md says exactly 4, so decide: edit those 4 only, or allow more; whether past years keep the old dates. |
| **Joining-date editing** | 1 to 1.5 | One field on the employee edit dialog plus validation (same 2000-01-01 floor). Changing it moves the expiry of every existing comp-off lot and the payslip eligibility test, so decide whether it rewrites history, applies only to future claims, or is blocked once the employee has comp-off or payslips. |

Total if all three are wanted: roughly 4.5 to 6.5 days.

## 9. Still open

1. **Deployment details (from you, when you have them):** the Traefik entrypoint, network and cert-resolver names, the
   domain, the container registry (or building on the VM), and the VM's time zone for the cron job. Nothing in
   Phase 1b waits on these.
2. **Native `<select>` or the styled one?** Decision 15 keeps the native one. Now that Base UI is approved, copying the
   current styled Select (five places) is cheap, about a quarter of a day. Tell me if you want it.

## 10. Effort budget (work the decisions add)

Working days for one person, including tests, visual checks against the current app, and review. The backend and
section 8 estimates are unchanged.

| Item | Days |
|---|---|
| Session cookie on the backend: `lr_session` with its own secret, the `Origin` and content-type checks, dropping the Bearer path and the CORS option, the new variable in the env file and compose, the HTTP tests updated, the stress harness switched to a cookie jar and re-run | 1 to 1.5 |
| Frontend styling with Tailwind and shadcn, across all phases | 3 to 4 |
| **Total** | **4 to 5.5** |

The styling figure assumes the shadcn components (`components/ui`, 15 files, three never used) and the feature
components are copied from the current app with their class strings, and checked screen by screen against it using the
numbers in Appendix A. It covers Tailwind and token setup, the hand-copied custom variants, the page-in transition, and
the final pixel pass. It also assumes the `cn()` helper from the approved `clsx` and `tailwind-merge`. These days are for styling and sit alongside the logic work each phase already covers.

If all three section 8 features are wanted as well, the total becomes 8.5 to 12 days.

## Appendix A. UI measurements from the current app

So the React frontend can match the current app without guessing. The sidebar, header, cards, forms and the admin
list were **measured** on the running current app in Chrome (light theme, `/admin/admins`, a 1920 px window).
Alert, dialog, toast and drawer values come from the current app's source (its Tailwind classes) and sonner's
defaults, and were only compared by eye, so check them in Phase 1b. Colours need no conversion: use the
`globals.css` variables as they are. All sizes are CSS pixels; borders are 1px and count toward an element's size.

| Area | Measurement |
|---|---|
| Sidebar | 240 wide (includes its right border); the logo strip is 64 tall with a bottom border, 20 side padding, logo 40 high (153 wide). Nav area padding 12 sides, 24 top and bottom. |
| Sidebar sections | Label: 12/16, medium, 0.05em letter spacing, uppercase, muted; 12 side padding, 4 below. Sections 24 apart; items 4 apart; label to first item 4. |
| Sidebar items | 36 tall (px 12, py 8), gap 12, icon 16, 14 medium, radius 10. Active: primary-subtle background, primary text, a 2x20 bar on the left edge. Unbuilt: muted, not a link, "Soon" badge (16 tall, px 6, 10px uppercase). |
| Header | 64 tall including the bottom border; background `background` at 80% with a 12px blur; side padding 32 (16 under 768). Title 24/32, semibold, -0.6px letter spacing. |
| Header right side | Theme button 32 square (sun in light, moon in dark); then avatar 32; then name (14, medium, line height 14) over the role badge (16 tall, px 6, 11px); then "Log out" as a small ghost button (28 tall, 12.8px text, 14px icon), icon only under 640. Gaps 12 (16 before the avatar). |
| Page area | Padding 32 (16 sides and 24 top under 768). No maximum width. |
| Cards | Radius 14, 1px border, shadow token, padding 24, 24 between the header and the content. Title 16/22 medium, description 14/20 muted, 4 apart. |
| Admins page | From 1280 up: three columns with a 24 gap, the list spanning two; below that the cards stack, 24 apart. List rows: padding 12, avatar 32, text 12 away; name 14 medium, email 12 muted. |
| Buttons | Default 32 tall, radius 10, px 10, 14 medium, icon 16, gap 6. Small: 28 tall, radius 8, 12.8px, icon 14, gap 4. Icon buttons 32 and 28 square. Hover 150 ms; pressed moves 1px down; focus ring 3px at 50%. |
| Inputs | 32 tall, radius 10, 1px `input` border, transparent (dark: `input` at 30%), 14px (16px under 768). Label 14 medium, 8 above the field. Hint and error 12/16, 8 below. Fields 20 apart. |
| Badge | 20 tall, px 8, 12px, secondary colours; a transparent 1px border adds 2px to the width. |
| Alert | Card colour with a 1px border, radius 10, px 10, py 8, text 14; the destructive variant only turns the text and icon red. A Retry button sits 8 from the top right and the text keeps 72 clear on the right. |
| Dialog | Max 384 wide, radius 14, padding 16, gap 16, a 1px ring at 10% of the foreground. Title 16 medium, description 14 muted. Footer strip with a top border and `muted` at 50%. Overlay black at 10% with a 4px blur. |
| Toast | Bottom right, 356 wide, 24 from the edges (full width with 16 margins on a phone); popover colours, 1px border, radius 10, padding 16, a soft shadow; title 13 medium, description 13. |
| Mobile drawer | 288 wide, same header strip as the sidebar, a ghost close button 12 from the top right; overlay black at 10% with a blur. |
| Loader | A 160x107 running figure and "Loading…" (14, muted), 12 apart, centred on the full screen; the route-level loader replaces the whole screen, shell included. The SVG and its CSS in `globals.css` can be reused as they are. |
| Login | Logo 56 high, 32 above a card of at most 384; card title 18/28; the form has a 16 gap; the button is 36 tall and full width. |
| Motion | Page-in: 200 ms ease-out, 6px rise. Hover and focus transitions 150 ms. All of it off with reduced motion. |
| Type | Inter (variable). Tabular figures only where the current app asks for them (the `tabular-nums` class), not globally. |
