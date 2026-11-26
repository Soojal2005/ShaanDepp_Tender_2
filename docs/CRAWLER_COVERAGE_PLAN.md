# Crawler Coverage — Implementation Plan

**Created:** 21 November 2026
**Companion to:** [`PORTAL_COVERAGE_RESEARCH.md`](PORTAL_COVERAGE_RESEARCH.md) (the full directory-vs-crawler analysis)
**Goal:** Cover **every publicly accessible portal** in the SHAN-DEEP NCB directory, and **capture every field the frontend displays** that is available without a login/DSC — while never crawling anything blocked by robots.txt, Terms of Use, login, DSC or captcha.

This is a living plan. Phase A is **implemented in this session**; Phases B–C are scoped for execution.

---

## Guardrails (apply to all phases)
- **Public data only.** No login/DSC/captcha circumvention, no robots.txt violation, no scraping of competitor aggregators. (GeM: crawled since 26 Nov 2026 by a business decision — see [GeM](#gem--crawled-by-business-decision-26-nov-2026) below.)
- **Data honesty.** A figure the source did not publish stays `NULL` and shows as "Not Disclosed by Department" — never zero, never estimated. (See the placeholder note in §4.)
- **Shared production DB.** The backend points at the production Supabase project, and crawling writes to it. Enabling `CRAWLER_ENABLED` is an operational decision — first runs should target one portal via `run({ only: '<id>' })` to sanity-check before full enablement.

---

## Phase A — Accessible GePNIC portals + full field capture  ✅ DONE (this session)

| Change | File | Status |
|---|---|---|
| Add **PMGSY** (rural roads) `pmgsytenders.gov.in` | [portals.js](../backend/src/services/ingestion/sources/cppp/portals.js) | ✅ enabled (GePNIC, verified) |
| Add **BEML** `eprocurebeml.nic.in` → completes 12/12 PSU set | portals.js | ✅ enabled (GePNIC, verified) |
| Add **DNH** `dnhtenders.gov.in` (2nd endpoint of the merged UT) | portals.js | ✅ enabled (GePNIC, verified) |
| Register **ISRO, CPWD, BPCL, POWERGRID** as tracked targets | portals.js | ✅ disabled stubs + notes (adapters pending — Phase B) |
| **Detail-capture ON by default** (`CRAWLER_FETCH_DETAILS`) so every new GePNIC tender's public detail page is read for estimated value / EMD / fee / category / tender type / source link | [config.js](../backend/src/config.js) | ✅ default flipped `off → on` |

**Result:** enabled portals **47 → 50**; the crawler now fills all *public* money/category/type fields, not just the listing columns. Registry is self-validating (shape + uniqueness test in `crawler.cppp.test.js`).

> Detail-capture only flows to GePNIC portals — the custom adapters (nProcure/Bihar/Vupadhi) ignore the extra options, so the default flip is safe for them.

---

## Phase B — Bespoke adapters for the accessible NON-GePNIC portals

Each target was **investigated against the live site on 21 Nov 2026** (raw-HTML probe) to see whether it serves a public, server-rendered listing (buildable + testable here with cheerio) or hides its data behind JS/SAP/encrypted-login walls (which need a live headless-browser dev loop with devtools on the site's own XHR endpoints — not finishable in this environment without risking a broken adapter against production).

| # | Target | URL used | What the live probe found | Outcome |
|---|---|---|---|---|
| **B2** | **ISRO / Dept. of Space** | `eproc.isro.gov.in` | Public server-rendered table, ~96 tenders, one page, no login on the list (captcha is on vendor-login only) | ✅ **BUILT** — `sources/isro/isro.js`, enabled, `test/crawler.isro.test.js` (4 pass) |
| **B5** | **POWERGRID** | `apps.powergrid.in/pgciltenders` | The SAP portal (`etender.powergrid.in`) is login-walled, **but** the public "Published Tenders" index is a plain server-rendered ASP.NET page (`?dt=onemonth` ≈ 188 rows, `data-order` dates, per-tender GUIDs, no login) | ✅ **BUILT** — `sources/powergrid/powergrid.js`, enabled, `test/crawler.powergrid.test.js` (4 pass). Parser verified against the real 188-row page |
| **B6** | **HPCL** | `etender.hpcl.co.in` | The eProc login page also carries a public, server-rendered **"Public Tenders"** table (ref / title / due date, full NIT description in the row's `onclick`), no login | ✅ **BUILT** — `sources/hpcl/hpcl.js`, enabled, `test/crawler.hpcl.test.js` (3 pass). Parser verified against the real 41-row page |
| **B4** | **BPCL** | `bpcltenders.eproc.in` | The bidding SPA (bpcleproc.in) hides its list behind an encrypted search, but abcProcure's **public dashboard** (`/Product/publicDash`) is server-rendered and login-free | ✅ **BUILT** — `sources/bpcl/bpcl.js`, enabled, `test/crawler.bpcl.test.js` (3 pass). Shows the current live tenders (a subset; full archive = future enhancement) |
| **B3** | **CPWD** | `etender.cpwd.gov.in` | The login-looking entry hides a PUBLIC **"All Tenders" DataTable** (newest-first, server-side ~160k rows). A browser-driven adapter opens it and walks the first pages. **CPWD publishes value + EMD** | ✅ **BUILT** — `sources/cpwd/cpwd.js` (Playwright-driven, like nProcure), enabled, `test/crawler.cpwd.test.js` (3 pass). **Verified live end-to-end**: 30 tenders / 3 pages / 13s, value on 28/30 |
| B1 | **CPPP ePublishing** | `eprocure.gov.in/epublish/app` | Server-rendered (GePNIC-family) but its unique value is **award/result** notices → the Results pipeline, not open-tender discovery (which CPPP already covers) | ⏳ Deferred — separate Results-ingestion feature |
| B7 | **Vupadhi full listing** (TG + AP) | existing adapter | Full list behind jCryption (homepage subset works today) | ⏳ Deferred — needs live jCryption iteration |

**Net Phase-B result: ALL 5 buyer/department portals are BUILT, wired and unit-tested (ISRO, POWERGRID, HPCL, BPCL, CPWD).** Three (ISRO, POWERGRID, HPCL) are plain `fetch`+cheerio once the right public endpoint was found; **BPCL** reads abcProcure's public dashboard (also `fetch`+cheerio); **CPWD** needed a Playwright-driven adapter (its public list is a JS-rendered NIC-TMS DataTable) and was verified live end-to-end. Playwright (already a crawler dependency, used by nProcure/Bihar/Vupadhi) did the reverse-engineering headlessly — no personal browser needed. **Only ePublish (award/Results data) and the Vupadhi full-list remain**, and both are separate feature tracks, not blocked portals.

**Adapter contract (for the deferred ones, same seam ISRO used):** implement `createXClient({baseUrl,state}) → { tenders({page}) }` returning `{content,totalElements,totalPages,page}` of dtos; register it in `makeCrawlerClient` (definitions.js) by `portal.adapter`; flip the portal's registry entry to `enabled:true` with its `adapter` id; reuse `normalizeCpppTender`; add `crawler.<name>.test.js` with a real-HTML fixture.

---

## Phase C — Field completeness & its public ceiling

**Frontend shows:** estimated value, EMD (+status), tender fee, publish/pre-bid/deadline/opening dates, department, category, tender type, status, documents, eligibility / payment / delivery / penalty terms, BOQ.

| Field group | Source | Status |
|---|---|---|
| Dates, department, title, type | Listing row | ✅ captured |
| Estimated value, EMD, fee, category, source link | **Public detail page** | ✅ now captured (Phase A detail-capture on) |
| Money fields still NULL after detail | NIT PDF text | 🟡 `ENRICH_*` pipeline exists (off). **Works only where the PDF is public** — GePNIC NIT PDFs are login/DSC-gated, so enrichment helps mainly non-GePNIC adapters. Pilot per-provider. |
| **Documents (NIT/BOQ files)** | Portal download | ⛔ GePNIC: **login + DSC gated** — not public. Stays undisclosed. |
| **Eligibility / payment / delivery / penalty / BOQ** | Inside the NIT PDF only | ⛔ GePNIC: unreachable publicly (PDF gated). Shows "Not Disclosed by Department". |

**This is the honest ceiling:** for the GePNIC network we deliver complete *discovery + qualification metadata*, but the bid-document files and the terms that live only inside them require a registered-bidder session the user performs themselves. Not a gap to "fix" — a boundary to state.

**Placeholder accuracy (follow-up decision):** the label "Not Disclosed **by Department**" asserts the department withheld it. After Phase A, most blanks that were really *capture gaps* are filled, so the remaining blanks are far more likely to be genuine non-disclosure — making the label truthful. Optional: for the still-unfetchable (gated) cases, a neutral "Rate not published" avoids over-attributing to the department. **No user-facing copy changed without sign-off.**

---

## Never crawl (blocked — documented, not attempted)

| Target | Reason | Class |
|---|---|---|
| **IREPS** (Railways) | `robots.txt: Disallow: /` | Legal (robots) |
| **Maharashtra** `mahatenders.gov.in` | `robots.txt: Disallow: /` | Legal (robots) |
| **Karnataka KPPP** | Keycloak login on listing | Technical (auth) |
| **Chhattisgarh** `eproc.cgstate.gov.in` | Text captcha on listing | Technical (captcha) |
| GePNIC document files / terms / BOQ | Login + DSC gated | Technical (auth) |

**Compliant path for the blocked buyers:** their notices often also appear on CPPP/eTenders (crawled) or on GeM. For Railways/Maharashtra/Karnataka common-goods tenders an **official data partnership** remains the strategic answer — a business decision, not an engineering one.

### GeM — crawled by business decision (26 Nov 2026)

This table used to list GeM as "Never crawl — ToS prohibits automated extraction; anti-bot/JS-rendered". Re-checked on 26 Nov 2026 before building the adapter:

- **robots.txt allows it.** `bidplus.gem.gov.in/robots.txt` disallows only `/resources/` and three bank-guarantee endpoints; the crawler fetches none of them.
- **No anti-bot barrier on the listing.** `/all-bids` is a server-rendered page that gives every visitor a session cookie + CSRF token; it loads bids with a plain JSON POST to `/all-bids-data`. The crawler sends exactly that request under its honest User-Agent (`ShanDeepTenderCrawler/1.0 (+https://procure-brain.in; respectful crawler)`) — no login, captcha, stealth or fingerprint tricks. Bid PDFs (`/showbidDocument/{id}`) are public.
- **Terms of Use: not settled.** The public pages that could be read contain no clause on automated access; GeM's General T&C pages redirect and could not be read. GeM's T&C bind registered buyers/sellers; whether they cover reading the public listing is a legal question.
- **Decision:** the product owner chose to crawl GeM, accepting the terms risk (and ~165 MB for the first full sweep, ~9 MB/day after while `PRUNE_EXPIRED_ENABLED` is off). `GEM_ENABLED=off` stops it without a code change.

Adapter: `sources/gem/` · job `crawl-gem` (own schedule, every 30 min) · ~44k live bids, Reverse Auctions skipped · polite pacing (1 request/s, ≤300 requests/run) · details in the module header of `sources/gem/gem.js`.

---

## Master status checklist (every directory portal)

Legend: ✅ live · 🟢 added this session · ⏳ Phase B · 🟡 via gateway · ⛔ blocked

- **National:** CPPP ✅ · eTenders ✅ · Defence ✅ · ePublish ⏳(B1) · GeM 🟢(adapter, own job; EMD + value from bid PDFs) · IREPS ⛔
- **Specialised:** PMGSY 🟢 · ISRO 🟢(adapter) · CPWD 🟢(adapter, value+EMD) · DAE/DRDO/NHAI/AAI 🟡(via CPPP/eTenders)
- **States (28):** 25 ✅ · Maharashtra ⛔ · Karnataka ⛔ · Chhattisgarh ⛔ · (Gujarat/Bihar/Telangana/AP via custom adapters ✅, Telangana+AP full-list ⏳ B7)
- **UTs (8):** 8 ✅ · DNH 2nd endpoint 🟢
- **PSUs (12):** 11 ✅ · BEML 🟢  → **12/12**
- **Energy:** ONGC/NHPC/GAIL 🟡(via gateways) · POWERGRID 🟢(adapter) · HPCL 🟢(adapter) · BPCL 🟢(adapter)
- **Institutional (AIIMS/ICMR/ESIC/ICAR/CSIR/NICSI):** 🟡 via CPPP/eTenders
- **Banks (12 PSBs + RBI):** deferred (own CMS, low volume — build only on client demand)

---

## Operational runbook (when ready to go live)
1. Apply any pending migrations to Supabase (migrations are **not** auto-applied).
2. Set `CRAWLER_ENABLED=on`. Detail-capture is already on (Phase A).
3. First run: `crawl-gepnic` with `{ only: 'pmgsy' }` (then `beml`, `dnh`) to confirm new portals parse before a full sweep.
4. Monitor ingestion health logs; `CRAWLER_MAX_DETAILS` (default 60) caps detail fetches per portal per run.
5. Optionally pilot `ENRICH_ENABLED` against a non-GePNIC provider that exposes public PDFs.
