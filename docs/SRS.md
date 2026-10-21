# Software Requirements Specification

**Product:** Shan-Deep Tender Portal and company website (`procure-brain.com`)
**Client:** Shan-Deep Management Advisory, Bhopal
**Developer:** Synquic
**Basis:** the signed proposal (modules A to G, 8 weeks, "Internal, No Pricing" copy)
**Version:** 1.0, 21 October 2026, written against the delivered system

This document states what the system must do and the limits it works within. Each requirement has an identifier so it can be traced to the tests that prove it (section 9). Where the delivered behaviour is more specific than the proposal, the specific value is stated; where a decision was taken in the proposal's silence, it is listed in section 8.

---

## 1. Introduction

### 1.1 Purpose
To specify a tender-intelligence platform and a public company website for Shan-Deep: filtered daily email alerts, search, weekly analytical reports, tender results and rate analysis, a submission assistance desk, and a bilingual company website.

### 1.2 Scope
In scope: modules A to G of the proposal, the staff administration needed to run them, and deployment material. Out of scope are listed in 1.5.

### 1.3 Definitions

| Term | Meaning |
|---|---|
| Client / subscriber | A business that subscribes to the portal. One *organization* with up to three *logins* |
| Staff | Shan-Deep employees: Analyst, Case Manager, Platform Admin |
| Tender | A government procurement notice from the licensed data feed |
| Result / award | A published outcome of a tender: winner, amounts, bidders |
| L1 / L2 | Lowest / second-lowest qualified bid |
| EMD | Earnest money deposit |
| Spread | (L1 amount minus estimate) divided by estimate; negative means below the estimate |
| Bid band | The middle half (25th to 75th percentile) of historical spreads, applied to an estimate |
| Digest | One alert email for one alert profile |
| Case | A submission-desk request for one tender |
| Bundle | The weekly analytical report for one client |
| Dry run | A mode in which an integration does everything except contact the outside service |
| RLS | PostgreSQL row-level security |

### 1.4 Overview of the document
Section 2 describes the system and its users. Section 3 lists functional requirements by module. Sections 4 to 6 give interfaces, data and non-functional requirements. Section 7 gives constraints and assumptions; section 8 records decisions; section 9 traces requirements to tests.

### 1.5 Out of scope
- Scraping CPPP, GeM or state e-procurement portals (data comes only from the licensed feed and Excel uploads).
- WhatsApp or SMS alerts (the website has a plain WhatsApp link and a call link only).
- GeM API integration and automated bidding.
- Payment collection or subscription billing (plans are assigned by an administrator).
- Native mobile applications (the web application is responsive).

---

## 2. Overall description

### 2.1 Product perspective
A single web application: a React single-page application (website and portal) and a Node.js (Express) REST API in one deployable image, backed by PostgreSQL 15 or later. External services: the Tenderbook (Metalbook) tender data API, and Microsoft Graph for sending mail from the client's own Microsoft 365 mailbox.

### 2.2 Users

| Role | Description | Capabilities |
|---|---|---|
| Visitor | Anyone on the public site | Read the website; send an enquiry |
| Subscriber | Client user | Alerts, search, watchlist, results, reports, desk requests for the own organization |
| Account Admin | Client administrator | As Subscriber, plus invite and deactivate people in the own organization |
| Analyst | Staff | Work submission-desk cases; read website enquiries |
| Case Manager | Staff | As Analyst, plus assign and reopen cases, release weekly reports |
| Platform Admin | Staff | Everything, including organizations, plans, master lists, data feeds, mail, jobs, report generation, audit log |

### 2.3 Operating environment
Linux server (container) with Docker, PostgreSQL 15+ with a UTF-8 database, ports 80 and 443. Browsers: current Chrome, Edge, Firefox and Safari, desktop and mobile. Node.js 20.12 or later.

### 2.4 Design and implementation constraints
- Tender data is sourced only from the data API licensed in the client's own name; its key lives only on the server.
- All subscriber email is sent through the client's own Microsoft 365 mailbox.
- Weekly and daily schedules run on India Standard Time (UTC+5:30).
- Content is available in English and Hindi.

---

## 3. Functional requirements

Priority: **M** must (in the proposal), **S** supporting (needed to deliver a "must").

### 3.1 Identity, access and tenancy (FR-AUTH)

| ID | Requirement | P |
|---|---|---|
| FR-AUTH-01 | Users sign in with email and password. A wrong password and an unknown email give the same answer. | M |
| FR-AUTH-02 | Passwords are stored only as salted scrypt hashes; at least 10 characters with a letter and a digit. | S |
| FR-AUTH-03 | After 5 consecutive failures an account is locked for 15 minutes. | S |
| FR-AUTH-04 | A session is an opaque random token in an HttpOnly, SameSite cookie (Secure in production); only its hash is stored. Sessions last 7 days by default. | S |
| FR-AUTH-05 | Every state-changing request from a signed-in browser must carry the session's CSRF token. | S |
| FR-AUTH-06 | The role and organization of a request are taken only from the stored session; role or organization headers sent by a client are ignored. | S |
| FR-AUTH-07 | Password reset by an emailed single-use link valid for one hour; the response never reveals whether an address has an account. Changing a password ends the user's other sessions. | S |
| FR-AUTH-08 | Suspending an organization or deactivating a user ends their sessions and blocks sign-in. | S |
| FR-AUTH-09 | An organization has at most 3 active logins (plan default; overridable per organization by a Platform Admin). Simultaneous invitations must never exceed the limit. | M |
| FR-AUTH-10 | A client can read and write only its own organization's data. This is enforced inside the database by forced row-level security on every table, using a restricted database role that cannot bypass it. | M |
| FR-AUTH-11 | Staff-only data (credentials, sessions, mail queue, enquiries, internal case strategy, analyst notes, activity log) is unreadable by any client context, whatever the application code does. | M |
| FR-AUTH-12 | The audit log and the report-release log are append-only, even for the database owner. | S |
| FR-AUTH-13 | Rate limits: sign-in 20 per 15 minutes per address; password reset 10 per 15 minutes; public enquiries 5 per 15 minutes; test emails 10 per hour per user; the whole API 3000 per 15 minutes per address in production. | S |

### 3.2 Tender data ingestion (FR-ING)

| ID | Requirement | P |
|---|---|---|
| FR-ING-01 | Tenders and results are pulled from the licensed API on a schedule (default every 120 minutes) and on demand by a Platform Admin. | M |
| FR-ING-02 | Records are de-duplicated on (provider, source id); an unchanged record is left alone and a changed one is updated. | M |
| FR-ING-03 | Each source value is normalised to master lists (state, city, department, category). A name not in the master lists is queued as a suggestion for an administrator to map, create or ignore; it is never silently replaced by a default. | M |
| FR-ING-04 | Each run records its outcome and warns when the feed fails, returns fewer records than expected, or its format has changed; the failure is shown to administrators and emailed to the operations address. | M |
| FR-ING-05 | An administrator can back-fill a date range. | M |
| FR-ING-06 | Tenders and results can be loaded from an Excel file using a downloadable template; invalid rows are reported with the reason and valid rows are still loaded; impossible dates are rejected. | M |
| FR-ING-07 | A value the source did not publish is stored as NULL and never as zero. | M |
| FR-ING-08 | A warning email is sent to the operations address 7 days before the data-feed key expires. | S |

### 3.3 Search and web access (module B, FR-SRC)

| ID | Requirement | P |
|---|---|---|
| FR-SRC-01 | Multi-keyword search with prefix matching; `-word` and an exclusion field remove matches; scope selectable among title, description and BOQ items. | M |
| FR-SRC-02 | Filters: department, state (several), city, category, value range, publish, submission and opening dates, tender type, status (open, closing within 72 hours, closed). | M |
| FR-SRC-03 | Sorting by best match, closing soonest, newest, highest value (tenders with no published value last). Paging. | M |
| FR-SRC-04 | Facet counts that respect the other active filters. | M |
| FR-SRC-05 | A tender dossier shows all published fields: value, dates, EMD, fee, eligibility, BOQ, payment, delivery and penalty terms when present, source link, documents listed by the source, corrigenda. A missing figure reads "Not disclosed by department". | M |
| FR-SRC-06 | Saved searches (name, re-run, convert to an alert profile). | M |
| FR-SRC-07 | A personal watchlist with private notes. Reminders by email: submission deadline in 24 to 72 hours, within 24 hours, and pre-bid meeting within 48 hours; each sent once. | M |
| FR-SRC-08 | Any filtered list can be exported to Excel. | M |
| FR-SRC-09 | A dashboard of open tenders by department, state, value band and month, closing-soon list and match counts; every figure computed from the data. | M |
| FR-SRC-10 | Tenders that appeared in the person's alert emails, or were held back, are flagged. | S |

### 3.4 Email alerts (module A, FR-ALT)

| ID | Requirement | P |
|---|---|---|
| FR-ALT-01 | An alert profile holds name, business categories, keywords, exclusions, states, departments, value band, tender type, recipients, frequency, and a flag for including tenders of unknown value. Editable by the subscriber or an administrator. | M |
| FR-ALT-02 | An organization may have several profiles, up to the plan limit (Basic 2, Standard 5, Premium 10), including under simultaneous requests. | M |
| FR-ALT-03 | Every candidate tender gets a deterministic score out of 100: title keyword 30, category 25, description or BOQ keyword 15, department 15, freshness 15. An unspecified dimension counts as a full match. A profile with keywords must match at least one. | M |
| FR-ALT-04 | Each digest carries at most the plan ceiling of tenders (Basic 50, Standard 100, Premium 150), best score first. The ceiling is per email. | M |
| FR-ALT-05 | Matches beyond the ceiling are stored and shown in the portal as "held back"; they are not lost. | M |
| FR-ALT-06 | Tenders from earlier digests closing within 72 hours are pinned at the top once. | M |
| FR-ALT-07 | The email is grouped by department and state and shows title, department, state, value, EMD, due date and a direct portal link. | M |
| FR-ALT-08 | Digests are built from 08:00 India time (retried every 15 minutes until done) with one digest per profile per India day; frequency daily, alternate-day or weekly; profiles can be paused and resumed. | M |
| FR-ALT-09 | A subscriber can preview the next digest without recording anything and send themselves a test email. | S |
| FR-ALT-10 | A digest history records what was emailed and what was held back. | S |

### 3.5 Microsoft 365 email (module E, FR-MAIL)

| ID | Requirement | P |
|---|---|---|
| FR-MAIL-01 | Email is sent through Microsoft Graph `sendMail` using client-credentials from the client's mailbox, saved to Sent Items. | M |
| FR-MAIL-02 | A queue sends within configured limits (default 25 per minute, 10,000 per day); excess waits for the next window and nothing is dropped. | M |
| FR-MAIL-03 | On HTTP 429 the sender honours `Retry-After` and pauses; transient errors retry with back-off up to a maximum; permanent refusals mark only that message failed. | M |
| FR-MAIL-04 | On 401 or 403 (permission problem) sending pauses for 15 minutes, messages are kept, and the operations address is alerted once. | M |
| FR-MAIL-05 | Account emails (password reset, invitations) are sent ahead of bulk digests. Two workers never send the same message twice; a message stuck "sending" after a crash is recovered. | S |
| FR-MAIL-06 | Dry-run mode (the default) renders each message to an HTML file and records it as `dry_run`; it is never reported as sent. Live mode will not start without full Azure configuration. | M |
| FR-MAIL-07 | Delivery failures read from the mailbox are recorded; an address with a permanent failure is not mailed until an administrator clears it. | S |
| FR-MAIL-08 | An administrator console shows mode, limits, daily count, queue, per-message status and bounces, and can send now, retry or cancel. | M |

### 3.6 Weekly analytical bundle (module C, FR-RPT)

| ID | Requirement | P |
|---|---|---|
| FR-RPT-01 | Every Monday at 06:00 India time a bundle is generated for each active client for the week just ended. | M |
| FR-RPT-02 | The bundle covers the client's own scope: categories, states and departments from its active alert profiles (a dimension no profile restricts is unrestricted; no profiles means the whole market). | M |
| FR-RPT-03 | Seven sections: volume and value against the previous four weeks; state map; department opportunity with movement; value bands (under ₹10 lakh, ₹10 lakh to ₹1 crore, above ₹1 crore, and "not published"); demand and pricing by category; competition density; critical dates for the next two weeks. | M |
| FR-RPT-04 | Tenders without a published value are counted but excluded from every value total; medians on fewer than 3 values and competition on fewer than 3 results are withheld. | M |
| FR-RPT-05 | The bundle is stored as a snapshot; the on-screen charts, the PDF and the Excel workbook are all rendered from it. | M |
| FR-RPT-06 | A bundle is **not visible to the client and not emailed** until staff release it, to one client or in bulk to a plan; the database enforces the visibility. Optional email notice on release. | M |
| FR-RPT-07 | Every release is appended to an immutable log. Staff can preview any bundle before releasing it. | M |
| FR-RPT-08 | Clients keep a locker of released reports and can download each as PDF and Excel; downloads are recorded. | M |

### 3.7 Tender results and rate analysis (module D, FR-RES)

| ID | Requirement | P |
|---|---|---|
| FR-RES-01 | Results are searchable by text, department, state, category, date, value and winner, sortable, and exportable to Excel. | M |
| FR-RES-02 | Each result shows winner, L1 and L2 where published, the spread against the estimate, the number of bidders and qualified bidders, award date and work order. | M |
| FR-RES-03 | A rate or winner the source did not publish is shown as "Rate not published" or "Winner not published"; it is never estimated or shown as zero. | M |
| FR-RES-04 | Rate analysis: median, average and range of spreads, grouped by department, category or state, with a month-by-month trend. | M |
| FR-RES-05 | The bid band gives the 25th to 75th percentile of historical spreads and, for an entered estimate, the corresponding range in rupees. It is presented as historical guidance, not a recommendation. | M |
| FR-RES-06 | Statistics are withheld when fewer than 5 records support them, and every aggregate states how many records it uses. | M |
| FR-RES-07 | Rate per unit can be compared across departments and states for one item and unit, only where unit rates exist. | M |
| FR-RES-08 | Tender analysis: department award patterns (volume, average award, variance, average bidders) and bidder profiles (participations, wins, win rate, value won, departments won, repeat winners). | M |

### 3.8 Submission assistance desk (module F, FR-CASE)

| ID | Requirement | P |
|---|---|---|
| FR-CASE-01 | A client raises a request from any tender (or by naming a tender not in the feed); a case opens, filled from the tender. One open case per client per tender. Staff may raise one on a client's behalf. All case managers are emailed. | M |
| FR-CASE-02 | Nine stages: request received, detail study, eligibility and compliance, technical bid preparation, financial bid strategy, pre-bid queries, submission, opening and result, follow-up; then closed. Every move is recorded; the client is emailed at each stage. | M |
| FR-CASE-03 | Stage rules: no submission straight from intake or study; no follow-up before a result is recorded; no closing without an outcome (a result, or cancelled or withdrawn); only a case manager reopens a closed case. | M |
| FR-CASE-04 | A case manager or administrator assigns an owner who must be an active staff member. | M |
| FR-CASE-05 | A plain-language summary written by staff is shared with the client. | M |
| FR-CASE-06 | Eligibility and compliance checks (met, not met, not applicable, pending, with notes) and a technical-bid checklist, from a starter set and editable per case; the client sees them. | M |
| FR-CASE-07 | Financial strategy, margin notes and a snapshot of historical rate analysis for the tender's department and category are internal and never reach the client. | M |
| FR-CASE-08 | Pre-bid queries raised and the department's responses recorded; visible to the client. | M |
| FR-CASE-09 | Submission recorded as online (portal reference required) or offline (courier and tracking number required). | M |
| FR-CASE-10 | Result recorded with technical and financial status, won (L1) or not, both amounts and date. Recording it creates follow-ups: EMD refund if not L1; purchase order and payment if L1. EMD instrument details and refund status are tracked. | M |
| FR-CASE-11 | Document vault with typed slots (tender document, compliance checklist, technical bid, BOQ, proof of submission, EMD receipt, work order, other) and per-document visibility, internal or shared. Clients see only shared documents and may add documents only in client slots. | M |
| FR-CASE-12 | Uploads: maximum 15 MB; extensions pdf, doc, docx, xls, xlsx, png, jpg, jpeg, zip, txt, csv; file content must match its extension; names are sanitised; files are stored outside the web root and delivered only through an authorised endpoint as attachments. No uploads to a closed case. | M |
| FR-CASE-13 | Client tracker: the client sees stage, timeline, summary, checklists, pre-bid, submission, result, EMD, follow-ups and shared documents, and never internal notes, strategy, activity log or internal documents. | M |
| FR-CASE-14 | Desk dashboard: open cases by stage, cases at deadline risk (within 72 hours, not submitted), unassigned cases, follow-ups due, EMD outstanding, and win/loss by client and department. | M |
| FR-CASE-15 | Reminder emails to the assignee (or the case managers if unassigned): deadline within 72 hours and within 24 hours, follow-ups due, requests unowned for four hours; each sent once; none after submission. | S |

### 3.9 Company website (module G, FR-WEB)

| ID | Requirement | P |
|---|---|---|
| FR-WEB-01 | A public website in English and Hindi, switchable at any time and remembered. | M |
| FR-WEB-02 | Eight service groups from the proposal: Tender Information and Bidding Support (11), GeM Portal Specialist (12), Business Setup Solutions (11), Compliance and ROC Filings (6), ISO and Certifications (23), Funding Assistance (4), Legal Drafting (8), Business Licences, IPR and Advisory (6). | M |
| FR-WEB-03 | Every service has its own page and address with description, an enquiry form, a WhatsApp button and a call button. Every group has a page. A service search is provided. | M |
| FR-WEB-04 | Every enquiry lands in the staff inbox with the service named, requires consent (DPDP Act 2023) and a valid email, is protected by a honeypot and rate limit, and is readable only by staff. Staff move it through New, Contacted, Qualified, Closed. | M |
| FR-WEB-05 | Trust content: business registration BHOP260407SE000586 and GST 23APSPT2592R1ZR; an interactive nine-step flow chart of how a tender is handled; a list of departments covered (names only, no logos until supplied, with a note that no association is implied). | M |
| FR-WEB-06 | Search-engine basics: a title, description and canonical address per page, a sitemap of every page, robots.txt excluding the portal. | S |
| FR-WEB-07 | Contact details (phone, email, WhatsApp number) are configuration, not code. | S |

### 3.10 Administration (FR-ADM)

| ID | Requirement | P |
|---|---|---|
| FR-ADM-01 | Organizations: create with plan and first administrator, edit, suspend; invite, deactivate, reset password for members. | M |
| FR-ADM-02 | Plans: limits on alert ceiling, alert profiles and logins editable without code. | M |
| FR-ADM-03 | Master lists (states, cities, departments, categories) editable; 36 states and union territories and a starter set of departments and categories are provided. | M |
| FR-ADM-04 | Background jobs listed with schedule and last result; each can be run on demand; failures recorded with their reason. | M |
| FR-ADM-05 | An audit log records sign-ins, administrative changes, releases, case stage changes and uploads. | M |
| FR-ADM-06 | First administrator created from the environment on first start; demo accounts and data are refused in production. | S |

---

## 4. External interface requirements

### 4.1 User interface
Responsive layouts from 360 px width without horizontal page scroll; keyboard-operable dialogs; Hindi and English for the whole website and the client portal (staff administration screens are English). Amounts in Indian units (lakh, crore); dates in India time.

### 4.2 Tenderbook (Metalbook) API
Server-side HTTPS calls with the key in an `Authorization` header; paged retrieval of tenders and results; a filter body may be passed for back-fill. The key, its expiry date and the refresh limits are supplied by the client. The browser never contacts this API.

### 4.3 Microsoft Graph
`POST /users/{mailbox}/sendMail` with application permission `Mail.Send`; optional `Mail.ReadWrite` for reading delivery-failure notices. The application is restricted to the single sending mailbox by an Exchange application access policy.

### 4.4 Database
PostgreSQL 15 or later, UTF-8. Migrations run as the owner; the application connects as `app_api_user`, which has no ability to bypass row-level security.

### 4.5 HTTP API
JSON over HTTPS under `/api/v1`; cookie session; CSRF header on changes; file download endpoints for reports, results exports and case documents.

---

## 5. Data requirements

52 tables in these groups: organizations, plans, users and sessions; tenders, documents, BOQ items, corrigenda and raw payloads; master lists and mapping suggestions; saved searches and watchlist; alert profiles, digests and items; mail queue, delivery log and bounces; historical awards and bidders; report bundles, releases and downloads; submission cases with checklists, stages, documents, pre-bid queries, submission, result, EMD, follow-ups, internal strategy, analyst notes and activity log; enquiries; audit events; job runs.

Data rules: a missing published value is NULL; money is stored in rupees as numeric; timestamps are timestamptz and shown in India time; the audit and release logs cannot be altered; schema changes only through new numbered migrations.

---

## 6. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-SEC-01 | All traffic over HTTPS in production (automatic certificate); security headers including a content security policy that allows only the site's own scripts, `X-Content-Type-Options`, frame denial. |
| NFR-SEC-02 | No secret is stored in the repository or sent to a browser; configuration comes from the environment; the application refuses unsafe combinations (live mail without credentials, embedded database or demo data in production). |
| NFR-SEC-03 | All request bodies are validated by schema; database access is by parameterised queries only. |
| NFR-SEC-04 | The database encoding must be UTF-8; the application refuses to start otherwise. |
| NFR-PRIV-01 | Personal data is limited to what is needed; enquiry consent is recorded; data stays in India when hosted there. |
| NFR-REL-01 | A failing integration never loses data: queued mail waits, a failed feed run keeps what arrived, and jobs record their failures. |
| NFR-REL-02 | Daily database dump and copy of uploaded files, retained 14 days by default; a documented restore procedure. |
| NFR-PERF-01 | Designed for a pilot of tens of clients and tens of thousands of tenders on a 2 vCPU, 4 GB server. Search and dashboards use indexed full-text and aggregate queries. No formal load target was set. |
| NFR-USA-01 | Honest data presentation: figures not published are labelled, never zero or estimated; every statistic states its sample size. |
| NFR-MNT-01 | Forward-only, checksummed migrations; an automated test suite runs on both the embedded and a real PostgreSQL server. |
| NFR-OPS-01 | A health endpoint reports database availability; administrators see feed, mail and job status in the portal. |
| NFR-I18N-01 | All user-facing strings live in dictionaries; a missing Hindi string falls back to English. |

---

## 7. Assumptions and dependencies

- The client supplies, in its own name: the Tenderbook key and licence terms, the Microsoft 365 tenant and mailbox, DNS access, a server, brochure content, a Hindi review, logos and contact details ([CLIENT_INPUTS_CHECKLIST.md](CLIENT_INPUTS_CHECKLIST.md)).
- The data feed provides tenders with the documented fields and, for results, an awards feed with bidder lists. Result analysis is limited to what the source publishes.
- Subscribers have an email address that can receive from the client's domain.
- Plans: Basic, Standard and Premium with the limits in FR-ALT-02, FR-ALT-04 and FR-AUTH-09, subject to client confirmation.

---

## 8. Decisions taken where the proposal was silent

1. The alert ceiling applies **per digest email**, not per account per day.
2. A plan limits the number of alert profiles (2, 5, 10) as well as logins (3).
3. The weekly bundle's scope is derived from alert profiles (FR-RPT-02).
4. The bundle is not auto-emailed; email on release is optional per release.
5. Vendor document downloads are shown as names and links only when the feed provides them, because the download endpoint needs a key and is unconfirmed.
6. Hindi text is a draft pending the client's review.
7. Staff administration screens are English only.
8. Departments are listed on the website by name only; no client or department logos are shown without supplied artwork.
9. Dry run is the default for mail and the data feed so a new installation cannot send mail or call a paid API by accident.

---

## 9. Traceability to tests

Counts are from [TEST_REPORT.md](TEST_REPORT.md): 308 API tests (embedded database and real PostgreSQL) and 189 browser checks.

| Requirements | API tests (`backend/test/`) | Browser checks (`e2e/`) |
|---|---|---|
| FR-AUTH | `auth`, `rls`, `schema`, `orgs`, `public` (rate limit) | 01, 07 |
| FR-ING | `ingestion` | 02 |
| FR-SRC | `search`, `alerts-api` (flags) | 02 |
| FR-ALT | `alerts`, `alerts-api` | 03 |
| FR-MAIL | `mail` | 03 |
| FR-RPT | `bundle` | 04 |
| FR-RES | `results` | 04 |
| FR-CASE | `cases`, `rls` | 05 |
| FR-WEB | `public`, `frontend` | 06, 07 |
| FR-ADM | `orgs`, `masters`, `schema` | 01, 07 |
| NFR-SEC | `frontend`, `schema`, `rls` | 07 |
