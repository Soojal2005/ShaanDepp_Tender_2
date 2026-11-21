# Portal Coverage Research — NCB Directory vs. Our Crawler

**Prepared:** 21 November 2026
**Inputs:** `SHAN_DEEP_NCB_Departments_and_Portal_Directory_India.pdf` (Edition 01, 20 pp.) · live crawler registry `backend/src/services/ingestion/sources/cppp/portals.js` · live robots.txt / reachability checks run 21 Nov 2026.
**Purpose:** Map every portal in the client's NCB directory to what our crawler already ingests, what is still missing, where the missing data can legitimately be obtained, and what is off-limits for legal or technical reasons. Public data only — no login/DSC-gated or ToS-restricted scraping.

---

> **Status update (21 Nov 2026):** Phases A–B of [`CRAWLER_COVERAGE_PLAN.md`](CRAWLER_COVERAGE_PLAN.md) are implemented — **enabled portals 47 → 55**. Added PMGSY, BEML, DNH (GePNIC) and **five new custom adapters: ISRO, POWERGRID, HPCL, BPCL and CPWD**, each unit-tested (CPWD also verified live end-to-end). Detail-capture is on by default so every GePNIC crawl fills the public value/EMD/fee/category/type fields; CPWD additionally publishes value + EMD directly. The reverse-engineering was done with headless **Playwright** (already a crawler dependency) — no personal browser involved. Only **ePublish** (award/Results data) and the **Vupadhi full-list** remain as separate feature tracks; the 4 still-disabled portals (Maharashtra, Karnataka, Chhattisgarh, IREPS) are genuinely blocked (robots/login/captcha). Counts below are the pre-Phase-A baseline; see the plan for current status.
>
> On the empty-field placeholder: showing "Not Disclosed by Department" for a missing EMD/value is the product's deliberate data-honesty rule (never zero, never estimated). The one caveat — it attributes the blank to the department, whereas some blanks are really *our* capture gaps (detail page / gated PDF). Phase A's detail-capture fills most of the capture-gap cases, so the remaining blanks are genuinely undisclosed-to-the-public; the login/DSC-gated items (documents, terms, BOQ) stay undisclosed by necessity.

## 1. TL;DR

- **We currently crawl 47 live portals** (43 on NIC's GePNIC software via one shared adapter + 4 custom-built adapters for non-GePNIC states). **4 more are registered but deliberately switched off** because they cannot be crawled lawfully/technically.
- **The directory is a *buyer* directory, not a *portal* list.** Its "53 + 2 ministries", DRDO, NHAI, AAI, AIIMS, ICMR, ESIC, ICAR, CSIR, ONGC, NHPC, etc. are **not 70+ separate websites** — the overwhelming majority publish their NCB notices onto **CPPP (`eprocure.gov.in`)** and **Central eTenders (`etenders.gov.in`)**, both of which **we already crawl**. So those buyers' tenders are captured today, just not through a buyer-specific page.
- **Headline coverage of the directory's concrete portal endpoints:**
  | Group | In directory | We crawl | Missing / blocked |
  |---|---|---|---|
  | States | 28 | **25** | 3 blocked (Maharashtra, Karnataka, Chhattisgarh) |
  | Union Territories | 8 | **8** | 0 (1 secondary endpoint optional) |
  | Dedicated PSU instances | 12 | **11** | 1 (**BEML** — easy add) |
  | National gateways | CPPP, eTenders, GeM, IREPS | **CPPP + eTenders** | GeM (restricted), IREPS (blocked), ePublish (partial) |
  | Specialised routes | Defence, CPWD, PMGSY, ISRO, DAE, NHAI, AAI | **Defence + (NHAI/AAI/DAE via gateways)** | CPWD, PMGSY, ISRO (addable) |
- **Biggest single gap = GeM** (`gem.gov.in` / `bidplus.gem.gov.in`). It is India's largest tender/bid volume. Its Terms of Use prohibit automated extraction and it uses anti-bot protection, so it must **not** be scraped — a compliant data route (official GeM integration/partnership) is the only option.
- **Data caveat (applies to everything):** we reliably capture tender **metadata + listing fields + most money fields**. We do **not** capture the actual **bid/NIT document files from GePNIC**, because those downloads are gated behind a registered-bidder login + Digital Signature Certificate (DSC). That is an authentication wall, not something we bypass. The NIT-PDF enrichment pipeline recovers money fields where a public PDF text layer exists.

---

## 2. How to read "coverage" correctly (buyers vs. portals)

The directory lists **buyers** (who is purchasing) and groups them by ministry, state, sector and bank. A buyer is only crawlable through the **filing/discovery system** it actually publishes on. In India that funnels into a small number of systems:

| Publishing system | Who uses it | Our status |
|---|---|---|
| **GePNIC** (NIC software — CPPP, eTenders, 30+ state/UT portals, most PSUs) | Central ministries, states, UTs, most CPSEs, AIIMS/ICMR/ESIC/ICAR/CSIR when not on GeM | **Crawled** (one shared adapter, 43 hosts) |
| **GeM** (`gem.gov.in`) | Almost every central/state buyer for goods & common services | **Not crawled — restricted** |
| **Custom state systems** (nProcure/Gujarat, EPSV2/Bihar, Vupadhi/AP+Telangana) | 4 states that left GePNIC | **Crawled** (4 bespoke adapters) |
| **Buyer-owned eProc** (POWERGRID PRANIT, HPCL, BPCL, CPWD, ISRO) | A handful of large PSUs/departments | **Mostly not crawled** (candidates below) |
| **Bank CMS pages** (`*.bank.in`) | 12 PSBs + RBI | **Not crawled** (niche, own CMS) |

**Consequence:** because we crawl CPPP + eTenders, a ministry like *Health & Family Welfare* or a body like *NHAI/AAI/DRDO/ONGC/NHPC* is **already covered for every notice it posts there**. The directory's 55 central rows do **not** translate into 55 missing targets.

---

## 3. What data we capture (and the one thing we don't)

**Captured per tender** (from `normalize.js`, stored for every crawled portal):
`tender id / ref no`, `title`, `description`, `department / organisation`, `category`, `state`, `city`, `tender type`, `estimated value`, `EMD amount + status`, `tender fee`, `publish date`, `pre-bid date`, `submission deadline`, `opening date`, `status`, and (where exposed) `document list`.

**Enrichment:** the NIT-PDF pipeline (`services/enrichment/`, deterministic, off by default) back-fills `estimated value / EMD / tender fee` from the tender's public NIT PDF text layer where the listing omitted them.

**Detail capture:** `CRAWLER_FETCH_DETAILS` opens each *new* tender's detail page to pull value/EMD/fee/category that aren't on the listing row.

**What we do NOT capture — and why it's out of scope, not an oversight:**
- **GePNIC tender document files (NIT, BOQ, drawings):** verified live (17 Nov 2026) to be **login + DSC gated** on the public portal. The "document" anchors on the public detail page are digital-signature/print/corrigendum popups, not the files; a plain GET returns HTML, not a PDF. Capturing these would require a registered-bidder session — an authentication wall we do not bypass.
- **Eligibility / payment / delivery / penalty terms & full BOQ:** these live only inside the NIT PDF, so they are available to users via the PDF, not as structured fields.

> Practical read for the business: we deliver **discovery + qualification metadata** for the whole GePNIC network. The end user still downloads the official bid pack from the source portal (with their own bidder login) to file — which matches the directory's own "Confirm the submission route" step.

---

## 4. Coverage detail — directory section by section

Legend: ✅ Crawled today · 🟡 Captured indirectly via a gateway we crawl · ➕ Not crawled, **addable** (public, lawful) · ⛔ Not crawled, **restricted/blocked**

### 4.1 National gateways (directory p.3, N01–N07)
| Code | Portal | Status | Notes |
|---|---|---|---|
| N01 | CPPP gateway `eprocure.gov.in/cppp` | ✅ | Discovery entry for the CPPP app we crawl. |
| N02 | GoI eProcurement `eprocure.gov.in/eprocure/app` | ✅ | `cppp` in registry. Primary central source. |
| N03 | eTenders `etenders.gov.in` | ✅ | `etenders` in registry. Second central DB (NHAI/AAI/ONGC route here). |
| N04 | CPPP **ePublishing** `eprocure.gov.in/epublish/app` | 🟡 ➕ | Award/corrigenda/enquiry publication. Same host, different app — **not separately crawled**. Low-effort add if award/result data is wanted. |
| N05 | **GeM** `gem.gov.in` | ⛔ | ToS prohibits automated extraction; anti-bot. See §5. |
| N06 | **GeM All Bids** `bidplus.gem.gov.in/all-bids` | ⛔ | robots.txt technically allows `/all-bids`, **but** data is JS/XHR-rendered behind bot protection and ToS forbids scraping. |
| N07 | **IREPS** `ireps.gov.in` | ⛔ | `robots.txt: Disallow: /` (re-confirmed 21 Nov 2026). Hard legal block. |

### 4.2 Specialised government routes (directory p.4, N08–N13 + lookups)
| Code | Authority | Status | Notes |
|---|---|---|---|
| N08 | Defence `defproc.gov.in` | ✅ | `defence` in registry (GePNIC). |
| N09 | **CPWD** `etender.cpwd.gov.in` | ➕ | Own eTendering (not plain GePNIC). No robots.txt (404, 21 Nov) → crawlable; needs a **dedicated adapter**. |
| N10 | **PMGSY** `pmgsytenders.gov.in` | ➕ **easy** | Verified GePNIC, loads normally, no captcha/robots block (21 Nov). **Add to registry — one line.** |
| N11 | **ISRO eProc** `eproc.isro.gov.in` | ➕ | Public tender table loads; custom NIC portal. Needs adapter assessment. |
| N12 | ISRO notices `isro.gov.in/Tenders.html` | 🟡 | Notice index; actual filing routes to N11/CPPP/GeM. |
| N13 | DAE / DPS `dpsdae.gov.in` | 🟡 | DPS has **migrated e-tendering to CPPP + GeM** → DAE notices captured via CPPP. |
| — | DRDO `drdo.gov.in` | 🟡 | Labs publish via CPPP/defproc/GeM → captured via those. |
| — | NHAI `nhai.gov.in` | 🟡 | Routes to eTenders (N03) → ✅ captured. |
| — | AAI `aai.aero` | 🟡 | 2026 RFPs direct bidders to eTenders (N03) → ✅ captured. |

### 4.3 States — 28 (directory p.9–10)
**25 crawled, 3 blocked.**
- ✅ **GePNIC (shared adapter):** Andhra*, Arunachal, Assam, Goa, Haryana, Himachal, Jharkhand, Kerala, Madhya Pradesh, Manipur, Meghalaya, Mizoram, Nagaland, Odisha, Punjab, Rajasthan, Sikkim, Tamil Nadu, Tripura, Uttar Pradesh, Uttarakhand, West Bengal.
- ✅ **Custom adapters:** **Gujarat** (nProcure, ~3,734 tenders), **Bihar** (EPSV2/Angular + REST, ~638), **Telangana** (Vupadhi), **Andhra Pradesh** (Vupadhi). *(Telangana/AP via Vupadhi currently capture the homepage subset only — full listing is behind jCryption encryption; enhancement pending.)*
- ⛔ **Blocked (in registry, disabled):**
  - **Maharashtra** `mahatenders.gov.in` — `robots.txt: Disallow: /`.
  - **Karnataka (KPPP)** `kppp.karnataka.gov.in` — tender listing behind a Keycloak login.
  - **Chhattisgarh** `eproc.cgstate.gov.in` — text captcha required (automating it = circumvention, disallowed).

### 4.4 Union Territories — 8 (directory p.11)
**All 8 crawled** (GePNIC): Andaman & Nicobar, Chandigarh, **DNH & Daman Diu**, Delhi, Jammu & Kashmir, Ladakh, Lakshadweep, Puducherry.
- Minor: the merged DNH-&-DD UT exposes **two** endpoints; we crawl `ddtenders.gov.in` (Daman & Diu). The **DNH endpoint `dnhtenders.gov.in`** is a one-line optional add (same GePNIC) if DNH-specific notices are wanted.

### 4.5 Dedicated PSU instances — 12 (directory p.13)
**11 crawled, 1 missing.**
- ✅ BEL, BHEL, Coal India, Chennai Petroleum (CPCL), GRSE, Goa Shipyard, Hindustan Shipyard, IOCL, Mazagon Dock, MIDHANI, NTPC.
- ➕ **BEML** `eprocurebeml.nic.in` — verified GePNIC (shared MoD-PSU portal), loads normally, no robots.txt (21 Nov). **Easy one-line add.**

### 4.6 Energy sector buyers (directory p.14)
| Buyer | Status | Notes |
|---|---|---|
| ONGC | 🟡 ✅ | Migrated new tenders to eTenders (N03) → captured. |
| NHPC | 🟡 ✅ | Publishes via CPPP → captured. |
| GAIL | 🟡 | Routes to GeM + CPPP → CPPP portion captured; GeM portion not. |
| **POWERGRID / PRANIT** `etender.powergrid.in` | ➕ | Own system (PRANIT). Needs dedicated adapter; crawlability to verify. |
| **HPCL eProc** | ➕ | Own eProc. Needs dedicated adapter. |
| **BPCL** `bpcleproc.in` | ➕ | Own eProc; no robots.txt (404, 21 Nov) → crawlable; needs adapter. |

### 4.7 Institutional buyers — health / science / education / IT (directory p.15)
AIIMS, ICMR, ESIC, ICAR, CSIR, NICSI, universities/IITs/NITs → **🟡 captured where they publish on CPPP/eTenders**, which the directory itself states (N02/N03/N06). The **GeM-only** portion of their procurement is not captured (GeM restriction). No dedicated portals needed — they ride the gateways.

### 4.8 Banks — 12 PSBs + RBI (directory p.16–17)
**Not crawled.** Each bank publishes on its own `*.bank.in` CMS page (SBI, PNB, BoB, BoI, BoM, Canara, Central, Indian, IOB, P&SB, UCO, Union) and RBI on `rbi.org.in`. Bank tenders then route to GeM or a bank-nominated eTender system. **Low priority:** heterogeneous bespoke pages, low volume relative to the GePNIC network, high per-site build cost. Revisit only if a client explicitly targets bank procurement.

---

## 5. Where we CAN get the data vs. where we CAN'T

### ✅ Can retrieve now (public, lawful) — **live**
The full GePNIC network (CPPP, eTenders, Defence, 11 PSUs, 25 states, 8 UTs) + Gujarat/Bihar/Telangana/AP custom adapters = **47 portals**, giving tender discovery + metadata + money fields for essentially all of central government, 25 states and every UT.

### ➕ Can retrieve, not yet built (public, lawful — recommended backlog)
| Target | Effort | Why worth it |
|---|---|---|
| **PMGSY** `pmgsytenders.gov.in` | **Trivial** (1 registry line) | Rural-road tenders; plain GePNIC, verified open. |
| **BEML** `eprocurebeml.nic.in` | **Trivial** (1 registry line) | Completes the 12/12 PSU set; plain GePNIC. |
| **DNH** `dnhtenders.gov.in` | **Trivial** (1 line) | Second endpoint of the merged UT. |
| **CPPP ePublish** `eprocure.gov.in/epublish/app` | Low | Award/result/corrigenda data. |
| **ISRO eProc** `eproc.isro.gov.in` | Medium | Custom NIC portal; needs its own adapter. |
| **CPWD** `etender.cpwd.gov.in` | Medium | Large works buyer; own eTendering; no robots block. |
| **BPCL / HPCL / POWERGRID-PRANIT** | Medium–High each | Buyer-owned systems; one adapter per site; verify anti-bot per site first. |
| **Vupadhi full listing** (Telangana + AP) | Medium | Lift from homepage-subset to full list (jCryption handling). |

### ⛔ Cannot / should not crawl (legal or technical)
| Target | Reason | Class |
|---|---|---|
| **GeM** (`gem.gov.in`, `bidplus.gem.gov.in`) | Terms of Use prohibit automated extraction; anti-bot/JS-rendered. robots.txt permits `/all-bids` but ToS + bot protection do not. | **Legal (ToS) + technical** |
| **IREPS** (Indian Railways) | `robots.txt: Disallow: /` | **Legal (robots)** |
| **Maharashtra** `mahatenders.gov.in` | `robots.txt: Disallow: /` | **Legal (robots)** |
| **Karnataka KPPP** | Listing behind Keycloak login | **Technical (auth wall)** |
| **Chhattisgarh** `eproc.cgstate.gov.in` | Text captcha on listing | **Technical (captcha — no circumvention)** |
| **GePNIC document *files*** (all portals) | Download gated behind bidder login + DSC | **Technical (auth wall)** |

**Compliant alternatives for the blocked buyers:** their notices often *also* surface on CPPP/eTenders (which we crawl), and Railways/Maharashtra/Karnataka/Chhattisgarh tenders for common goods frequently appear on **GeM** — so the right long-term answer for those is an **official GeM data partnership**, not scraping. For GeM specifically, pursue GeM's authorised integration/data channels rather than any crawler.

---

## 6. Do we still cover "all the data we require"?

**For discovery + qualification: yes, across the GePNIC universe** — which is the large majority of NCB opportunity by buyer count (central + 25 states + 8 UTs + 11 PSUs). The directory's ministries, DRDO, NHAI, AAI, ONGC, NHPC, AIIMS, ICMR, ESIC, ICAR, CSIR and DAE are all captured through the two national gateways we crawl.

**Known, deliberate data boundaries:**
1. **GeM-only tenders are not captured** (restriction). This is the one material opportunity gap — flag to the client and scope an official GeM route.
2. **Actual bid document files are not downloaded from GePNIC** (login/DSC wall). Users retrieve them from source with their own bidder login — consistent with the directory's own workflow.
3. **4 states/portals are off-limits** (Maharashtra, Karnataka, Chhattisgarh, IREPS); their common-goods tenders are partly recoverable via GeM/CPPP once a GeM route exists.

---

## 7. Recommended next steps (in priority order)

1. **Add the 3 trivial GePNIC endpoints now:** PMGSY, BEML, DNH (`dnhtenders.gov.in`) — 3 lines in `portals.js`, immediate coverage gain, zero legal risk.
2. **Decide on GeM** at the business level: it is the single largest source and the only *strategic* gap. Scope an **official/authorised GeM data route** (partnership/API), not scraping.
3. **Build CPWD + ISRO adapters** (medium effort, high-value buyers, no robots block found).
4. **Add ePublish** for award/result data if the product wants outcome tracking.
5. **Finish the Vupadhi full-listing** work for Telangana + AP (currently homepage subset).
6. **Defer** banks/RBI and the buyer-owned energy portals (POWERGRID/HPCL/BPCL) unless a client specifically needs them — high per-site cost, modest incremental volume.
7. **Keep the policy explicit in all client-facing material:** public data only; respect robots.txt; no login/DSC/captcha circumvention; no scraping of GeM or competitor aggregators.

---

## 8. Evidence log (checks performed 21 Nov 2026)

| Check | Result |
|---|---|
| `pmgsytenders.gov.in/nicgep/app` | Loads as GePNIC portal, Latest Tenders + Corrigendums visible, no captcha/WAF → **addable**. |
| `eprocurebeml.nic.in/nicgep/app` | Loads as GePNIC (shared MoD-PSU) portal, BEML tender refs present, no block → **addable**. |
| `eprocurebeml.nic.in/robots.txt` | HTTP 404 → no robots restriction. |
| `pmgsytenders.gov.in/robots.txt` | HTTP 404 → no robots restriction. |
| `etender.cpwd.gov.in/robots.txt` | HTTP 404 → no robots restriction (own eTendering). |
| `bpcleproc.in/robots.txt` | HTTP 404 → no robots restriction. |
| `eproc.isro.gov.in` | Public tender table loads (custom NIC portal). |
| `bidplus.gem.gov.in/robots.txt` | Allows `/all-bids` (only `/resources/`, `/bg_emd/...` disallowed) — **but** page data is JS/XHR behind bot protection; GeM ToS forbids extraction → treat as **restricted**. |
| `bidplus.gem.gov.in/all-bids` | Returns an empty JS shell ("Please wait…" loader), no rows in static fetch → confirms client-side/bot-guarded. |
| `ireps.gov.in/robots.txt` | `User-agent: * / Disallow: /` → **blocked** (re-confirmed). |

**Authoritative source for current coverage:** `backend/src/services/ingestion/sources/cppp/portals.js` (`GEPNIC_PORTALS`: 51 entries — 47 enabled, 4 disabled).

---

*Scope note: this document assesses portal reachability and legal/technical crawlability for public tender-discovery data. It is not a certification that every listed buyer currently has an open NCB notice, nor a statement that any authenticated bid submission was tested.*
