# Handoff

Read this first if you are taking over the project. It says what exists, how it is put together, what has and has not been verified, and what remains. Everything else is linked from here.

## 1. State of delivery

All seven modules of the signed proposal (A to G) are built, tested and documented. The system runs end to end **in safe mode**: email is written to files instead of being sent, and tender data comes from sample data or Excel upload, until the client supplies credentials. Nothing pretends to be live.

| Module | Status | Notes |
|---|---|---|
| A. Email alerts | Done | Profiles, 100-point ranking, plan caps per email (50/100/150), closing-soon block, held-back flags, one digest per profile per India day |
| B. Search and web access | Done | Keywords with exclusions, scopes, filters, saved searches, watchlist and reminders, Excel export |
| C. Monday analytical bundle | Done | 7 sections, India tile map, PDF and Excel; built every Monday, **invisible to the client until staff release it** |
| D. Results and rate analysis | Done | L1 vs estimate, bid band, unit rates, department patterns, bidder profiles. Needs a results feed (see open items) |
| E. Microsoft 365 email | Done, not live | Graph `sendMail`, queue with limits and 429 handling, bounces. Live needs the client's Azure setup |
| F. Submission desk | Done | 9 stages, checklists, vault, pre-bid, EMD, follow-ups, client tracker, dashboard, reminders |
| G. Website (EN/HI) | Done | 8 groups, 81 service pages, enquiries to the admin inbox. Hindi is a draft; contact details are placeholders |

Test status: 319 API tests discovered; 316 pass on the embedded database and three PostgreSQL-only checks are skipped there. The Prisma login, tenant isolation and schema check also pass on disposable real PostgreSQL. The prior 189 browser checks are documented in [TEST_REPORT.md](TEST_REPORT.md); they were not rerun for this database change.

## 2. Where things are

```
src/                 website + portal (React 18, Vite, react-router, recharts)
  pages/public/      company website          pages/portal/   client screens
  pages/admin/       staff screens            pages/desk/     submission desk views
  content/services.js  the whole website catalogue (EN + HI)
  i18n/en.js, hi.js    every portal and website string
backend/src/
  app.js             wiring, security headers, serving the built site
  routes/            thin HTTP layer (validation with zod, permission checks)
  services/          the real logic: ingestion, alerts, mail, results, bundle, cases
  jobs/              scheduler and job definitions
  auth/              sessions, permissions table, middleware
  db/                driver for PGlite and PostgreSQL, migrations runner, seeds
backend/migrations/  forward-only SQL, 001 to 008
backend/test/        308 tests (node:test + supertest)
e2e/                 browser tests (Playwright)
deploy/ + Dockerfile + docker-compose.prod.yml   production stack
docs/                this folder
```

## 3. Decisions that shape the code

Keep these in mind before changing things.

1. **Tenant isolation is enforced by the database.** Every table has row-level security *forced*. Each request runs as the restricted `app_api_user` role with a scope: `tenant` (a client), `staff` or `system` (jobs and pre-login paths). Client writes that must touch staff-only tables (raising a case, adding a shared document) run in system scope **after** an explicit ownership check in the route. Never widen a policy to make a feature easier.
2. **Roles and permissions** live in one table, `backend/src/auth/permissions.js`, mirrored for hiding UI in `src/auth/AuthContext.jsx`. The server is the authority; the mirror is cosmetic.
3. **Honesty rule.** A figure the source did not publish stays `NULL` and is shown as "Not disclosed" or "Rate not published". Never `0`, never estimated. Statistics on fewer than 5 records are withheld (`MIN_SAMPLE` in `services/results.js`).
4. **Migrations are forward-only and checksummed.** Never edit an applied migration; add `008_...sql`. The runner refuses to start if an applied file changed.
5. **Dry-run by default.** `MAIL_MODE=dry_run` and `TENDERBOOK_SYNC=off` unless explicitly enabled; `MAIL_MODE=live` without the four Azure values refuses to start. Demo accounts and sample data are refused in production.
6. **Alert ceiling applies per digest email** (Basic 50, Standard 100, Premium 150), not per account per day. A plan also limits alert profiles (2/5/10) and logins (3).
7. **Weekly bundle scope** comes from the client's active alert profiles: a dimension is unrestricted if any profile leaves it open; no profiles means the whole market. The bundle is stored as a JSON snapshot; the screen, the PDF and the Excel all render from it so they cannot disagree.
8. **The Tenderbook key is server-side only.** The browser never calls Tenderbook. Vendor document download needs an API key and its endpoint is unconfirmed, so documents show names and links only when the feed provides them.
9. **Unknown departments, categories and states** from the feed are queued as master-list suggestions for an administrator to map; cities are created automatically.
10. **Dates and weeks are India time (UTC+5:30)**: digests at 08:00 IST, bundles Monday 06:00 IST, week boundaries in IST.

## 4. Running, testing, deploying

- Develop: `npm install`, `cp .env.example .env`, `npm run dev` (see [README](../README.md)). Demo password `Demo-Pass-2026`.
- Test: `npm test`; on real PostgreSQL `TEST_PG_URL=postgres://... npm test`. Browser tests: [e2e/README.md](../e2e/README.md).
- Deploy: [DEPLOYMENT.md](DEPLOYMENT.md). Operate: [OPERATIONS.md](OPERATIONS.md). Administer: [ADMIN_GUIDE.md](ADMIN_GUIDE.md).
- Go-live order: server and DNS, first start, bootstrap admin, first client, **then** Tenderbook key (`TENDERBOOK_SYNC=on`), **then** Microsoft 365 (`MAIL_MODE=live`), then pilot users.

## 5. Open items (all need the client)

The full list with owners is [CLIENT_INPUTS_CHECKLIST.md](CLIENT_INPUTS_CHECKLIST.md). The ones that block going live:

1. A **new** Tenderbook key, plus confirmation of: refresh rate and limits, whether the licence includes a **results feed**, and whether documents can be fetched through the API. The field mapping for real results (`services/ingestion/normalize.js`) was built from the vendor's documented shape and the sample payloads in the tests; **check it against the first real payload.**
2. Microsoft 365 app registration, consent and access policy ([AZURE_M365_SETUP.md](AZURE_M365_SETUP.md)).
3. DNS access ([DNS_SPF_DKIM_DMARC.md](DNS_SPF_DKIM_DMARC.md)) and a server in India.
4. Shan-Deep's own phone, email and WhatsApp number (the site currently shows Synquic's as placeholders), brochure text, logos, a Hindi review.

## 6. Security housekeeping still owed

- The Tenderbook key that was in the original prototype was exposed in its source and in a shared ZIP. It is **not** in this repository or its history, but treat it as compromised and rotate it at Metalbook.
- `ShanDeep_Tender_Intelligence_FullStack_v2.1.2_FINAL.zip` (the original package) still sits in the working folder of the machine this was built on. Delete it.
- A developer's local `.env` may still hold old placeholder values (WhatsApp, KYB). None of those integrations exist any more. The current variable list is `.env.example` and `deploy/production.env.example`.
- The repository is **public** if it is on GitHub under the account it was pushed to. It contains no secrets and no client documents, but decide whether you want it private.
- Change the bootstrap admin password on first sign-in and create a second Platform Admin.

## 7. Known limits and things not verified

- Real Microsoft 365 sending and real Tenderbook calls were tested only against faithful fakes.
- The Docker image and the Caddy certificate were not built (Docker was not available). Do it once on the server.
- PostgreSQL verification used version 18; production is specified as 15. Re-run the suite against 15 before launch.
- The website is client-rendered. It sets per-page titles, descriptions, canonical links and a sitemap, but search engines see an empty page until they run scripts. If search ranking matters, add pre-rendering later.
- No load test; sized for a pilot of tens of clients.
- `exceljs` carries a moderate `uuid` advisory that is not reachable in how it is used ([TEST_REPORT.md](TEST_REPORT.md)).
- Hindi text is a first draft.

## 8. How to change common things

| To change | Edit |
|---|---|
| A website service, group or its Hindi name | `src/content/services.js`, then `npm run build` (the sitemap regenerates) |
| Any portal or website wording | `src/i18n/en.js` and `hi.js` (a missing Hindi key falls back to English) |
| Plan limits | Admin → Plans (no code); defaults are seeded in `backend/migrations/001_schema.sql` |
| Alert scoring weights | `backend/src/services/alerts/ranking.js` (title keyword 30, category 25, description/BOQ 15, department 15, freshness 15) |
| A schedule | `backend/src/jobs/definitions.js` |
| Default case checklists | `ELIGIBILITY_DEFAULTS` and `TECHNICAL_DEFAULTS` in `backend/src/services/cases.js` |
| Database structure | A new numbered file in `backend/migrations/`, plus a test; never edit an old one. Then run `npm run db:schema --prefix backend` to update `backend/prisma/schema.prisma` (generated; never edit by hand). SQL migrations, roles and row-level security stay authoritative. Model operations use `withPrismaContext()`; SQL uses `withContext()`, both with forced RLS. The schema check runs in the real-PostgreSQL test run (`TEST_PG_URL`). See [Prisma deployment](PRISMA_DEPLOYMENT.md) for AWS/Supabase connections and release steps. |
| Who can do what | `backend/src/auth/permissions.js` and its mirror in `src/auth/AuthContext.jsx`; add a test in `rls.test.js` or the area's file |

## 9. Suggested next steps

1. Go-live steps above, then user-acceptance testing with two or three pilot subscribers on real tenders.
2. Compare the first real Tenderbook tender and result payloads with the field mapping; add them as fixtures in `backend/test/`.
3. Run the test suite on PostgreSQL 15 and rehearse a backup restore.
4. Pre-render the public pages if organic search matters.
5. Possible additions the proposal did not ask for: in-portal messages on a desk case, a client-visible activity feed, frontend unit tests, and an automated off-server backup copy.
