# Day-to-day operations

Commands assume the Docker deployment in [DEPLOYMENT.md](DEPLOYMENT.md), run from the project folder on the server. Shorthand: `dc` = `docker compose -f docker-compose.prod.yml`.

## Every morning (two minutes)

1. Open **Administration → Data Feeds**: last run recent, no warnings.
2. Open **Administration → Mail Queue**: nothing stuck, no repeated failures, daily count sensible.
3. Open **Submission Desk**: anything under "Deadline risk" or "Unassigned".

The server also reports on itself: `https://<domain>/api/v1/health` returns `{"status":"ok"}` when the database answers. Point an uptime monitor (UptimeRobot, Better Stack, Azure Monitor) at it.

## Logs

```bash
dc logs -f api            # the application
dc logs --since 1h api
dc logs db caddy backup
```

Each line is JSON with a message and fields. Failed background jobs are also listed with their reason under **Administration → Background Jobs**.

## When tender data stops arriving

Check **Data Feeds**. The panel says why:

| Message | What it means | What to do |
|---|---|---|
| Status **failed**, with an HTTP error (401 or 403) | Key wrong or expired | Get a new key from Metalbook, update `TENDERBOOK_API_KEY`, `dc up -d` |
| Status **failed**, with a network or timeout error | Their service or our network is down | Usually clears itself; **Run now** later |
| "Only N records arrived; at least M are expected" | The feed returned fewer records than a normal run | Re-run; if it persists, tell the vendor |
| "N of M records could not be read. The source format may have changed." | A field the system expects is missing or renamed | Tell your developer; tenders already stored are unaffected |
| "Stopped part-way after N records" | The feed failed in the middle of a run | Re-run; what had arrived is kept |

While the feed is down, clients keep what they already have. For a long outage, load tenders from the vendor's Excel export through **Data Feeds → Excel upload** (template provided).

To fill a gap afterwards use **Back-fill** with the missing date range; it never creates duplicates (each tender is matched by its source id and updated only if it changed).

## When email is not going out

**Mail Queue** shows the reason.

| Sign | Meaning | Fix |
|---|---|---|
| Mode says Dry run | `MAIL_MODE` is not `live` | Set it in `.env` and `dc up -d` |
| "Sender paused: 401/403" | Microsoft refused the app | Secret expired, permission not consented, or access policy wrong. See AZURE_M365_SETUP.md. The ops address is emailed. |
| Messages "waiting" late in the day | Daily limit reached | They send in the next window. Raise `GRAPH_DAILY_LIMIT` only if Microsoft allows |
| One address always fails | Hard bounce | Listed under **Bounces**; fix the address and **Clear** it |

**Reading dry-run email** (before email is live): each message is an HTML file.

```bash
dc exec api ls /data/outbox
dc cp api:/data/outbox/<file>.html .      # then open it in a browser
```

## Backups

`backup` writes a database dump and a copy of the uploaded case documents to `./backups` every 24 hours and keeps the last `BACKUP_KEEP_DAYS` (14). **Copy that folder off the server** (another machine or cloud storage) on a schedule; a backup on the same disk does not survive losing the server.

### Restore (test this once before you need it)

Restoring into a **spare** database first is the safe way to prove a backup works:

```bash
# 1. a scratch database
dc exec db createdb -U postgres -E UTF8 restore_check

# 2. load the dump
gunzip -c backups/db-<stamp>.dump.gz | dc exec -T db pg_restore -U postgres -d restore_check --no-owner

# 3. look at it
dc exec db psql -U postgres -d restore_check -c "SELECT count(*) FROM tenders;"

# 4. remove it
dc exec db dropdb -U postgres restore_check
```

To restore for real after a disaster: stop the stack (`dc down`), start only `db`, drop and recreate the `shandeep` database, run `pg_restore` into it, extract `files-<stamp>.tar.gz` into the `appdata` volume's `storage` folder, then `dc up -d`. The application re-applies the role settings at start.

## Rotating secrets

| Secret | How |
|---|---|
| Microsoft client secret | Create a new one in the app registration, update `AZURE_CLIENT_SECRET`, `dc up -d`, delete the old one |
| Metalbook API key | Update `TENDERBOOK_API_KEY` and `TENDERBOOK_KEY_VALID_TILL`, `dc up -d` |
| Database passwords | Change `POSTGRES_PASSWORD` / `APP_DB_PASSWORD` in `.env`, run `ALTER ROLE ... PASSWORD` in the database to match, `dc up -d` |
| A user's password | Administration → Organizations → the person → Reset password (they get a link valid for one hour) |

Anyone who ever had a copy of an old key should be treated as still able to use it until it is rotated.

## Users and access

- A person who leaves: **Deactivate** them (Organizations → the organization → People). Their sessions end at once; their history stays.
- Five wrong passwords lock an account for 15 minutes.
- Staff accounts are created by a Platform Admin. Keep at least two Platform Admins.

## Data and privacy

- Enquiries hold the visitor's name, business, email, phone and message, kept only to answer them. Delete old ones you no longer need from the database; there is no automatic deletion.
- Case documents are on the server's disk (`appdata` volume) and in backups. Treat both as confidential.
- To stop a client's service, **Suspend** their organization. Permanently erasing a client's data (for example on a data-protection request) is a database operation your developer carries out; the audit log is append-only by design and keeps the record that it happened.

## Upgrading PostgreSQL

Minor versions (15.x) arrive with `dc pull db && dc up -d db`. A major upgrade (15 to 16) needs a dump and restore: take a backup, change the image tag, restore into the new volume. Plan it for a quiet weekend.

## Capacity

One small server comfortably handles the pilot (tens of clients, tens of thousands of tenders). Watch disk growth: tenders and results accumulate, as do uploads and backups.
