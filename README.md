# Shan-Deep Tender Portal (procure-brain.com)

A tender intelligence platform and company website for Shan-Deep Management Advisory, built to the signed proposal (modules A to G).

| | Module | Where to find it |
|---|---|---|
| A | Email alerts: profiles, ranked and capped daily digests, closing-soon block, plan limits | Portal → Alert Profiles |
| B | Search and web access: multi-keyword with exclusions, filters, saved searches, watchlist and reminders, Excel export | Portal → Search Tenders, Watchlist |
| C | Monday analytical bundle: 7 charted sections, India map, PDF and Excel, released by staff | Portal → Reports; Admin → Weekly Reports |
| D | Tender results and rate analysis: winners, L1 vs estimate, bid band, unit rates, bidder profiles | Portal → Tender Results |
| E | Email through the client's own Microsoft 365 mailbox (Graph `sendMail`), throttle-safe queue, bounce tracking | Admin → Mail Queue |
| F | Submission assistance desk: 9 stages, checklists, document vault, pre-bid, EMD, follow-ups, client tracker, dashboard | Portal → Submission Desk |
| G | Public website in English and Hindi: 8 service groups, 81 service pages, enquiry forms, WhatsApp and call buttons | `/` |

Data honesty is a design rule: a figure the source did not publish is shown as "Not disclosed" or "Rate not published", never as zero or an estimate, and statistics on fewer than 5 records are withheld.

## Run it on your machine

Needs **Node 20.12 or later** (Node 22 recommended). No database to install: development uses an embedded PostgreSQL (PGlite) with the same SQL as production.

```bash
npm install              # installs the website and the API
cp .env.example .env     # defaults are fine; every integration is off
npm run dev              # API on :4000, website on :5173
```

Open http://localhost:5173. With `SEED_DEMO=on` (the default in `.env.example`) these accounts exist, all with password `Demo-Pass-2026`:

| Email | Role |
|---|---|
| `owner@demo.test` | Client account admin |
| `subscriber@demo.test` | Client subscriber |
| `admin@demo.test` | Platform admin |
| `manager@demo.test` | Case manager |
| `analyst@demo.test` | Analyst |

Demo accounts and sample data are **refused in production**.

Email is in **dry-run** mode: messages are saved as HTML files in `backend/var/outbox/` and shown as such, never as sent. Tender data comes from the sample set until a Tenderbook key is configured.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API and website with reload |
| `npm run build` | Builds the website into `dist/` (and regenerates `sitemap.xml` and `robots.txt`) |
| `npm test` | The API's test suite (see below) |
| `npm run migrate` | Applies database migrations |
| `npm run seed` | Master lists and the first admin from `BOOTSTRAP_ADMIN_*` (`npm run seed:demo --prefix backend` adds sample data) |

## Tests

```bash
npm test                                   # 300+ tests on the embedded database
TEST_PG_URL=postgres://postgres:pw@localhost:5432/postgres npm test   # the same tests on a real PostgreSQL server
```

The tests cover the things that matter most for a multi-client system: row-level security (one client can never read another's data, and cannot see internal desk notes), authentication and lockout, tender ingestion and de-duplication, search, alert ranking and plan caps, the Graph client (token, 429 and `Retry-After`, throttling), the results and weekly-report calculations, PDF and Excel generation, and the submission desk including document uploads.

## How it is built

```
src/            React 18 + Vite website and portal (EN/HI), pages split by area
backend/src/    Express 4 API: routes, services, background jobs
backend/migrations/   forward-only SQL (checksummed), identical on PGlite and PostgreSQL
backend/test/   node:test + supertest
deploy/         Caddy (HTTPS), backup script, production environment template
docs/           deployment, Microsoft 365, DNS, admin, operations, client inputs
```

- **Tenant isolation lives in the database.** Every request runs as the restricted `app_api_user` role with row-level security forced on every table; the API only chooses a scope (client, staff, system).
- **Secrets stay on the server.** The Tenderbook key is read from the environment and used only by the server; the browser never sees it.
- **Sessions** are opaque cookies (hash stored), with a CSRF token on every state-changing request, scrypt password hashing and lockout after repeated failures.
- **Background jobs** (feed sync, digests, mail queue, reminders, weekly reports) run inside the API process on India time.

## Documentation

- [Deploying to a server](docs/DEPLOYMENT.md)
- [Sending email through Microsoft 365](docs/AZURE_M365_SETUP.md)
- [DNS: website, SPF, DKIM, DMARC](docs/DNS_SPF_DKIM_DMARC.md)
- [Administrator guide](docs/ADMIN_GUIDE.md)
- [Operations: monitoring, backups, restore, rotating secrets](docs/OPERATIONS.md)
- [What we need from Shan-Deep to go live](docs/CLIENT_INPUTS_CHECKLIST.md)
- [Test report](docs/TEST_REPORT.md)
