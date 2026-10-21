# Shan-Deep Tender Intelligence Platform & Portal (`procure-brain.com`)

## Enterprise SaaS Platform for Indian Government Tenders, Analytics & Bid Management
**Version:** v2.1.2 FINAL  
**Target Domain:** `https://procure-brain.com`  
**License:** Commercial Enterprise SaaS

---

## Architecture Overview (Modules M0–M11)

The platform provides an end-to-end multi-tenant system designed for Indian contractors, MSMEs, and procurement teams:
1. **Frontend (React 18 + Vite + Tailwind CSS):**
   - High-density navy art direction (`#0B2545`, `#134074`, `#0066FF`).
   - Bilingual support (`EN` / `HI` switchable on all major navigation items and page headers).
   - 10 Complete Module Views:
     - **Dashboard:** 4 sparkline KPI cards, 3 macro charts (Tenders by Department, Tenders by State Donut SVG, 6-Month Monthly Trend), closing soon opportunities.
     - **Search Tenders:** Real-time multi-scope search (`In Title`, `In Description`, `In BOQ`), negative exclusion terms (`-cctv`), state/UT and department filters, value range slider, card/table toggle, bulk export.
     - **Watchlist & Saved:** Bookmarked tender collections with deadline urgency countdowns.
     - **Alert Profiles:** 100-point deterministic ranking digests, daily caps (100/day), pause/resume.
     - **Submission Desk:** 4-stage pipeline (Intake, Eligibility, Technical Prep, Submitted/Result), Kanban + Table views, **FR-CASE-011 Role-Isolated Vault**.
     - **Reports & Analytics:** Value band distribution, state breakdown, historical L1/L2 spread table with honest data availability guards.
     - **Admin Console:** Organizations management with 3-seat limit check, tender ingestion sync, Microsoft Graph sendMail queue with 429 retry backoff, and **Automated E2E Verification Suites 1–7 Runner**.
     - **Profile & Plans:** Subscription tier entitlements, digest quotas, seat allocation.
     - **Help & Support:** Indian e-Procurement guide (CPPP, GeM, State Portals), bidding FAQ.
     - **Public Website & Leads (Module M2):** Bilingual public hero, 8 core advisory service groups, and interactive lead capture form with DPDP consent logging.
   - Built-in In-Browser Binary ZIP Packager (`Download Full-Stack ZIP` button).

2. **Backend (Node.js + Express API):**
   - REST endpoints (`/api/v1/health`, `/api/v1/tenders`, `/api/v1/cases`, `/api/v1/alert-profiles`, `/api/v1/enquiries`, `/api/v1/admin/*`).
   - Rate limiting on public enquiries (≤ 5 requests per 15 minutes per IP).
   - Transactional advisory locking for 3-seat organization limit.
   - Deterministic 100-point alert ranking engine (`backend/src/ranking.js`).
   - Microsoft Graph sendMail queue with HTTP 429 Retry-After backoff calculation.
   - FR-CASE-011 role-based case serialization (`backend/src/security.js`).

3. **Database (PostgreSQL 15+ Schema Baseline):**
   - Exactly **53 Relational Tables** defined in `backend/migrations/001_initial_53_tables.sql`.
   - Least-privilege runtime role: `app_api_user` (`NOSUPERUSER NOBYPASSRLS`).
   - Forced Row-Level Security (RLS) on all tenant-owned tables.
   - Parent-scoped policies for child tables (`case_documents`, `submission_case_checklists`, `watchlist_items`).
   - Append-only integrity triggers on `report_releases` and `audit_events`.

---

## Quick Start Instructions

### 1. Run the Automated Acceptance Test Suite (Suites 1–7)
```bash
npm test
# Executes all 7 SRS verification suites (34/34 assertions passing)
```

### 2. Start the Frontend Application (Vite Dev Server)
```bash
npm run dev
# Starts local Vite server on http://localhost:5173
```

### 3. Build the Frontend for Production
```bash
npm run build
# Compiles complete production bundle into dist/
```

### 4. Start the Backend API Server
```bash
npm run server:start
# Starts Express API server on http://localhost:4000
```

### 5. Start with Docker Compose (PostgreSQL 15+ and Backend API)
```bash
docker compose up --build
```

---

## Verification Test Results (v2.1.2 FINAL)
- **Frontend Structural Tests:** 10 Passed, 0 Failed
- **Backend Acceptance Test Suites (1–7):** 34 Passed, 0 Failed
- **Vite Production Build:** Successfully built in 29.20s (`dist/assets/index-*.js`, 260.86 kB)
- Detailed audit logs available in `TEST_RESULTS_v2.1.2.md`.
