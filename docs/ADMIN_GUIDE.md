# Administrator guide

Who can do what:

| Role | Where they work |
|---|---|
| **Platform Admin** | Everything: organizations, plans, master lists, data feeds, mail, jobs, weekly reports (generate and release), the submission desk (assign cases), audit log |
| **Case Manager** | The submission desk (all cases, assigning, reopening), releasing weekly reports, website enquiries |
| **Analyst** | The submission desk (working cases), website enquiries |
| **Account Admin** (client) | Their own account: alerts, team members (up to 3 logins), the portal |
| **Subscriber** (client) | Their own alerts, search, watchlist, results, reports, desk requests |

A client can never see another client's data, and never sees internal desk material. This is enforced in the database itself.

## Clients: Administration → Organizations

- **New organization:** name, plan, contact. Then invite the first user (they get an email to set a password).
- **Plans** set how many alert profiles (Basic 2, Standard 5, Premium 10) and how many tenders per alert email (50, 100, 150) a client gets. Every plan allows 3 logins. Change the numbers under **Plans** if the commercial terms change.
- **Suspending** an organization stops its emails and sign-ins without deleting anything.
- Inside an organization you can invite or deactivate people, reset a password, and look at or edit the client's alert profiles on their behalf.

## Master lists: Administration → Master Lists

States, cities, departments and categories. The tender feed sometimes names a department or category the system has not seen. These are **not** silently invented: they appear under **Data Feeds → Suggestions** for you to map to an existing entry, create, or ignore. Until mapped, those tenders still appear but cannot be filtered by that department.

## Tender data: Administration → Data Feeds

- **Status** shows the last run of tenders and results, how many records were added or changed, and any warnings (feed unreachable, fewer records than expected, a changed data format).
- **Run now** pulls immediately. **Back-fill** loads a date range.
- **Excel upload** is the fallback if the feed is down: download the template, fill it, upload. Every row that fails is listed with the reason; the rest are loaded.
- The key's expiry date is shown here, and an email goes to the ops address a week before it lapses.

## Email: Administration → Mail Queue

Shows whether mail is **Live** or **Dry run**, today's count against the daily limit, anything waiting, and every message with its status. You can **Send now**, **Retry** a failed message or **Cancel** a queued one. If Microsoft refuses the sender (wrong permission), sending pauses for 15 minutes and the ops address is told. **Bounces** lists addresses that failed permanently; they are not mailed again until you clear them.

## Background jobs: Administration → Background Jobs

| Job | When | What it does |
|---|---|---|
| Tender feed sync | every 2 hours | Pulls new and changed tenders, then results |
| Daily alert digests | 08:00 India time (retried every 15 min until done) | Builds and queues each client's alert email |
| Send queued email | every 30 s | Sends within Microsoft's limits |
| Monday analytical bundles | Monday 06:00 India time | Builds last week's report for each client (held until you release it) |
| Watchlist reminders | hourly | Pre-bid and deadline reminders for tracked tenders |
| Submission desk reminders | hourly | Deadlines, follow-ups and unowned requests, to the desk team |
| Read delivery failures | every 10 min (if enabled) | Records bounces |
| Data-feed key expiry check | daily | Warns the ops address |
| Housekeeping | nightly | Removes expired sessions and old history |

Each can be run on demand with **Run now**; failures are recorded with their reason.

## Weekly reports: Administration → Weekly Reports

Reports are **built automatically every Monday but are invisible to clients until you release them.**

1. Pick the week. **Generate for all clients** rebuilds them if you need to (Platform Admin only).
2. **Preview** any client's report exactly as they will see it.
3. **Release** to one client, or choose a plan and **Release to plan**. Tick **Email clients when released** to notify their account admins.
4. Every release is written to the **Release log**, which cannot be edited or deleted.

Each client's report covers *their* categories, states and departments, taken from their alert profiles (a client with no profiles gets the whole market).

## The submission desk

A client raises a request from any tender ("Request submission help") or from Submission Desk → New request. All case managers are emailed.

1. **Assign** an owner (case manager or admin).
2. Move the case through the stages. The client is emailed at each stage. You cannot jump to submission straight from intake, cannot move to follow-up before a result is recorded, and cannot close a case with no outcome.
3. **Summary for the client**: write it in plain language; the client reads it.
4. **Eligibility and technical checklists** start with standard items; add your own, mark each met / not met, add a note. The client sees these.
5. **Financial bid strategy** (internal): your strategy and margin notes, plus **Attach rate analysis**, which snapshots what similar past awards were won at. *Never visible to the client.*
6. **Pre-bid queries**: raise them, record the department's reply. The client sees both.
7. **Submission**: online (portal reference) or offline (courier and tracking number).
8. **Result**: technical and financial status, won or not L1, both bids. Recording a result creates the right follow-ups: an **EMD refund** if not L1; a **purchase order** and **payment** if won.
9. **Documents**: upload against a slot (tender document, technical bid, BOQ, proof of submission, EMD receipt, work order). Uploads default to **internal**; use **Share** to let the client see one. Files are checked: type, size (15 MB) and that the content really is what the name says.

The **desk dashboard** (top of Submission Desk) shows open cases by stage, deadlines within 72 hours that are not yet submitted, follow-ups due, EMD outstanding, and win/loss by client and department.

## Website enquiries

Every enquiry from the public site lands under **Website Enquiries** with the service the visitor was looking at. Move each through New, Contacted, Qualified and Closed.

Sign in with a Platform Admin, Case Manager or Analyst account, then open **Administration → Website Enquiries** in the left sidebar (`/app/admin/enquiries`). The **Show** filter defaults to **All**; choose **New** for unread leads. A successful form submission displays a thank-you message to the visitor. The inbox is stored in the API database; the Vite frontend alone cannot receive enquiries. When developing locally, use the normal `npm run dev` setup so the embedded database persists in `backend/var/pgdata`. The `PGLITE_DIR=memory` browser-test setup loses enquiries whenever that API process restarts.

## Audit log

Platform Admin only. Records who did what and when (sign-ins, organization and user changes, releases, case stage changes, uploads). It cannot be edited.
