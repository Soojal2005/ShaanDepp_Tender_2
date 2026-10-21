# Test report

Produced from real runs on 21 October 2026, against the code in this repository. Nothing here is hand-written from memory: the numbers are what the test runners printed.

## Summary

| Layer | What ran | Result |
|---|---|---|
| API tests, embedded database (PGlite) | 308 tests in 15 files | **308 passed, 0 failed** |
| The same API tests, **real PostgreSQL** | 308 tests, a fresh UTF-8 database per file | **308 passed, 0 failed** |
| Browser tests, development mode | 6 scripts, 158 checks | **158 passed, 0 failed** |
| Browser smoke test, production mode on real PostgreSQL | 1 script, 31 checks | **31 passed, 0 failed** |
| Website build | `npm run build` | passes |
| Dependency audit (`npm audit --omit=dev`) | website packages: 0 findings. API packages: 2 moderate (see below) | accepted, explained below |

## API tests (308)

Run with `npm test`, or `TEST_PG_URL=postgres://... npm test` for a real PostgreSQL server.

| File | Tests | What it proves |
|---|---|---|
| `schema.test.js` | 9 | Row-level security is forced on every table and every table has a policy; the runtime role cannot bypass it; migrations are idempotent, checksummed (an edited migration is refused) and roll back whole on failure; plans are seeded; search vectors fill automatically |
| `rls.test.js` | 13 | A client cannot read, insert, update or delete another client's rows; staff-only data (credentials, sessions, mail queue, internal case notes) is invisible to clients; a missing, malformed or injected tenant setting denies everything; the audit and release logs are append-only even for the database owner |
| `auth.test.js` | 14 | HttpOnly SameSite session cookie and no credential material returned; the same answer for a wrong password and an unknown email; lockout after repeated failures and unlock; CSRF header required on every change; forged role and organization headers ignored; suspended organizations and deactivated users lose their sessions; password reset by single-use link, expired links refused, no way to tell whether an email has an account; password change; sign-ins audited without passwords |
| `orgs.test.js` | 15 | Organization and member management, plan seat limits (including **six simultaneous invitations for three seats**), per-organization overrides, suspension |
| `masters.test.js`, `public.test.js` | 15 | Master lists; public enquiry form (validation, honeypot, rate limit, consent) readable only by staff |
| `ingestion.test.js` | 35 | Tender normalisation, de-duplication and update-on-change, unknown departments queued for review, feed health warnings (failure, short count, format drift), Excel import with row-level errors and strict date checks, back-fill |
| `search.test.js` | 30 | Multi-keyword, exclusions, title/description/BOQ scope, every filter, facets that respect the other filters, sorting, paging, hostile input |
| `alerts.test.js`, `alerts-api.test.js` | 62 | The 100-point ranking, plan caps of 50/100/150 per email, closing-soon pinned once, held-back matches flagged, one digest per profile per India day, profile limits per plan (including simultaneous requests), preview/test/history, alert flags shown in search |
| `mail.test.js` | 26 | Microsoft Graph client (token caching, `sendMail` body, `saveToSentItems`), per-minute and per-day windows, HTTP 429 with `Retry-After`, 401/403 pause with ops alert, dry-run writes files and is **never** reported as sent, bounce handling |
| `results.test.js` | 20 | Awards search and export, spread and bid band, withheld statistics under 5 records, "rate not published" never turned into a number, unit-rate comparison, bidder profiles |
| `bundle.test.js` | 28 | India-time week boundaries, the seven report sections reconciling to the data, scope taken from each client's own profiles, valid PDF and Excel output, release required before a client can see a report |
| `cases.test.js` | 35 | The submission desk end to end: raising and refusing duplicates, assignment rules, stage rules, checklists, pre-bid, submission and result, follow-ups created from the outcome, **what a client can and cannot see (also at database level)**, document upload checks (fake PDFs, wrong types, hostile names, closed cases), download authorisation, desk dashboard, reminders sent once |
| `frontend.test.js` | 6 | The built website is served on one address with correct caching; unknown addresses give a real 404; the API is untouched |

### What running on real PostgreSQL found

The embedded database runs one transaction at a time, so it can hide timing problems that real PostgreSQL exposes. The first run against real PostgreSQL passed 301 of 302 tests and found a genuine defect:

> **Six simultaneous invitations for a three-seat account all succeeded.** The seat count was read in the same statement that took the row lock; PostgreSQL decides what a statement can see before it waits for a lock, so every request counted the seats as they were before anyone else committed.

Fixed by taking the lock in its own statement first (`backend/src/services/orgs.js`). The regression test was already in the suite; it now passes on both engines. Real PostgreSQL also confirmed:

- the migrations apply cleanly as the database owner while the application runs as the restricted `app_api_user` login;
- the application refuses a database that is not UTF-8 (a Windows-locale cluster was rejected this way during testing, which is exactly the protection intended, because Hindi text would be damaged).

**Version note:** the PostgreSQL used for this verification was 18 (the only real server binary available in the build environment), not 15. The SQL uses no features newer than 15, but run the suite once against your production version before go-live: `TEST_PG_URL=postgres://postgres:...@host:5432/postgres npm test` (it creates and drops its own databases).

## Browser tests (158 + 31)

Real Chromium, real clicks, screenshots reviewed. `e2e/README.md` explains how to run them.

| Script | Checks | Covers |
|---|---|---|
| `01-sign-in-and-admin` | 23 | Sign-in and redirect to the page first asked for, wrong password, role-based navigation (a client sees no Administration), creating an organization and inviting its admin, the 3-login seat limit, master lists (32 starter departments), plans, audit log, Hindi, mobile layout |
| `02-search-and-watchlist` | 31 | Dashboard figures and charts, search filters and exclusions, sorting (undisclosed values last), tender dossier, watchlist, saved searches, Excel export, Hindi and mobile, data-feeds page, Excel import with row errors, unknown departments queued for review rather than guessed |
| `03-alerts-and-mail` | 22 | Alert profiles (create, edit, pause, delete), preview and test send in dry-run, alert flags in search, mail queue and jobs consoles |
| `04-results-and-reports` | 25 | Results (awards, rate analysis with bid band, tender analysis, bidder profile), Excel export, weekly report with India map, PDF and Excel downloads, Hindi, staff generate/preview/release, case manager cannot generate, mobile |
| `05-submission-desk` | 25 | Client sees only their requests and tracker; internal strategy never on the client page; uploads and downloads; a fake PDF refused; raising a request from a tender and the duplicate refusal; staff dashboard and workflow; the client sees the summary but not an internal document; Hindi; mobile |
| `06-website` | 32 | Home, 8 groups, 12 GeM services, service pages with their own address, enquiry with required consent reaching the admin inbox, WhatsApp link naming the service, site search, not-found pages, Hindi pages and titles, sitemap (93 URLs) and robots.txt, mobile menu, no horizontal scroll |
| `07-production-smoke` | 31 | Production mode on real PostgreSQL with the restricted runtime login: security headers and content policy, caching, real 404s, cookie flags (HttpOnly, Secure, SameSite), nine admin pages and five portal pages load, a public enquiry arrives, a client organization is created, no browser console or policy errors |

## Dependency audit

`npm audit --omit=dev`: website, 0 findings. API, 2 moderate findings, both the same: `uuid` (used inside `exceljs`) lacks a bounds check in the v3/v5/v6 functions **when the caller passes an output buffer**. The Excel library only generates random v4 identifiers without a buffer, so the flaw cannot be reached. The only automatic fix is a downgrade of `exceljs` to an old, unmaintained major version, which is worse. Re-check when `exceljs` publishes an update.

## Not tested, and why

- **Real Microsoft 365 sending and real Tenderbook calls.** No credentials exist yet. Both are exercised against faithful fakes (token handling, request bodies, throttling, 429 handling, schema drift); the first live send and first live pull are the go-live checks in `docs/DEPLOYMENT.md` steps 5 and 6.
- **Docker image build and the Caddy certificate.** Docker is not installed in the build environment. The Dockerfile, compose file and Caddyfile are straightforward, but build them once on the server and confirm HTTPS before announcing the site.
- **Load.** Sized for a pilot (tens of clients). No load test was run.
- **Backup restore.** The restore steps are written in `docs/OPERATIONS.md`; rehearse them once on the server.
