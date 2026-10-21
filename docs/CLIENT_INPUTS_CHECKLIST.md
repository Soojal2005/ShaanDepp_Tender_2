# What we need from Shan-Deep to go live

The system is built and tested end to end. Everything below is something only Shan-Deep can supply or decide. Until each item arrives, the matching part runs in a safe mode and says so on screen; nothing pretends to be live.

## 1. Credentials and accounts

| # | What | Who | Needed for | Until then |
|---|---|---|---|---|
| 1 | **A new Tenderbook / Metalbook API key.** The key that was in the earlier prototype was exposed in its code and in files that were shared; treat it as compromised and do not reuse it. Confirm its expiry date (the old one was due 25 Oct 2026) | Shan-Deep, from Metalbook | Live tender data | Tenders come only from Excel upload or sample data |
| 2 | **Confirmation from Metalbook** of: refresh frequency and call limits, whether a **results (awards) feed** is included in the licence, and whether documents (NIT, BOQ) can be downloaded through the API | Metalbook | Results and rate analysis; document links | Results use uploaded Excel; documents show names only |
| 3 | **Microsoft 365 setup**: an administrator to complete [AZURE_M365_SETUP.md](AZURE_M365_SETUP.md) (app registration, Mail.Send consent, access policy) and give us tenant ID, client ID, client secret, sending mailbox | Shan-Deep's M365 admin | Real email | Email is written to files, never sent |
| 4 | **DNS access** to add website, SPF, DKIM and DMARC records ([DNS_SPF_DKIM_DMARC.md](DNS_SPF_DKIM_DMARC.md)) | Whoever manages procure-brain.com | Website address, email deliverability | Site runs on a staging address |
| 5 | **A server or cloud account** in India and a login for it (or tell us your preferred provider) | Shan-Deep | Going live | Runs on our machine for review |
| 6 | **An address for operations alerts** (feed failures, key expiry) | Shan-Deep | Ops emails | No ops emails |

## 2. Content

| # | What | Notes |
|---|---|---|
| 7 | **The company brochure** and approved wording for each service | The website's English copy was written from the signed proposal's service list. Replace with your brochure text where it differs. |
| 8 | **Hindi review.** All Hindi text (website and portal) is a first draft by our team. Someone fluent should read it, especially service names and the sentences on the home page | We will apply corrections the same day |
| 9 | **Logo and brand assets** (logo files, colours, favicon) | The site uses a plain placeholder mark |
| 10 | **Department and client logos for the logo wall**, only those you have permission to show | The wall currently lists department *names* only, with a note that it implies no association |
| 11 | **Shan-Deep's own phone, email and WhatsApp number** for the public site | The site currently shows Synquic's contact details as placeholders. Replace before launch |
| 12 | **Office address and any registration details** to show in the footer | Currently: Bhopal, business registration BHOP260407SE000586, GST 23APSPT2592R1ZR (from the proposal) |

## 3. Business decisions

| # | What | Current setting |
|---|---|---|
| 13 | **Plans**: names, number of alert profiles, tenders per email, logins | Basic / Standard / Premium: 2 / 5 / 10 profiles; 50 / 100 / 150 tenders per email; 3 logins each. Editable under Administration → Plans |
| 14 | **Master lists**: your preferred department names and categories | 36 states and UTs, 32 departments and a starter set of categories are loaded; unknown names from the feed queue for your review |
| 15 | **Who is on the submission desk**: names and roles (case manager / analyst) | Create their accounts under Administration → Organizations (Shan-Deep staff organization) |
| 16 | **Standard eligibility and technical checklist items** you want on every case | A sensible starter set is loaded and editable per case |
| 17 | **Who may release weekly reports** and whether to email clients on release | Case Managers and Admins; email is optional per release |

## 4. Rollout

| # | What | Notes |
|---|---|---|
| 18 | **Two or three pilot subscribers** and their alert preferences | Used for user-acceptance testing with real tenders |
| 19 | **A named person to accept** each demo (website on staging; feed and search; alerts and email; results and reports; submission desk) | |
| 20 | **A time for the walkthrough and handover session** | We will record it |

## Things we deliberately did not do

- The system does not scrape CPPP, GeM or state portals; tender data comes only from the licensed feed and Excel uploads you provide.
- No WhatsApp or SMS alerts (out of scope in the proposal). The website has a plain WhatsApp link and a call link only.
- No automated bidding or GeM integration.
- No payment collection or subscription billing; plans are assigned by an administrator.
