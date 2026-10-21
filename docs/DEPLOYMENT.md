# Deploying to a server

This puts the website, the portal and the API on one server with automatic HTTPS, a PostgreSQL 15 database and daily backups. It assumes a Linux server (Ubuntu 22.04 or later) that you can log in to.

## What you need first

| Item | Notes |
|---|---|
| A server | 2 vCPU, 4 GB RAM, 40 GB disk is comfortable to start. In India (for example Azure Central India, AWS Mumbai) so data stays in the country. |
| Docker and the Compose plugin | `curl -fsSL https://get.docker.com \| sh` |
| The domain's DNS | See [DNS_SPF_DKIM_DMARC.md](DNS_SPF_DKIM_DMARC.md). The A records must already point at the server so HTTPS can be issued. |
| Open ports | 80 and 443 inbound. **Do not** open 5432: the database is not published. |

## 1. Get the code onto the server

```bash
git clone <repository-url> procure-brain && cd procure-brain
```

## 2. Configure

```bash
cp deploy/production.env.example .env
nano .env
```

Fill every value marked `CHANGE`. Generate the two database passwords with `openssl rand -base64 32`. Leave the integrations (`TENDERBOOK_SYNC`, `MAIL_MODE`) off for the first start; turn them on in steps 5 and 6 once their credentials are in.

`.env` holds secrets. It is never committed; restrict it with `chmod 600 .env`.

## 3. Start

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f api
```

On first start the application creates the database structure (migrations), the master lists (36 states and union territories, departments, categories) and the first administrator from `BOOTSTRAP_ADMIN_*`. It never creates sample accounts in production.

Open `https://<your domain>/`. You should see the company website. Sign in at `/login` with the bootstrap administrator and **change the password** (Profile → Change password).

## 4. Create the first client

Administration → **Organizations → New organization**: choose the plan, enter the client's details and invite their first user. The invitation email is sent through the mailbox once email is live; until then it is written to the outbox (see OPERATIONS.md for how to read it).

## 5. Turn on tender data

1. Get a **new** API key from Metalbook (do not reuse any key that has appeared in an old file or email).
2. In `.env`: `TENDERBOOK_API_KEY=...`, `TENDERBOOK_KEY_VALID_TILL=YYYY-MM-DD`, `TENDERBOOK_SYNC=on`.
3. `docker compose -f docker-compose.prod.yml up -d` (re-reads `.env`).
4. Administration → **Data Feeds → Run now**. Check that tenders arrive and the health panel is green. Use **Back-fill** to load the recent past.

## 6. Turn on email

Follow [AZURE_M365_SETUP.md](AZURE_M365_SETUP.md), then set `MAIL_MODE=live` and restart. Send yourself a test from Alert Profiles before inviting clients.

## Updating to a new version

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Migrations run automatically at start and are forward-only. A migration that was already applied is checksummed: the application refuses to start if one has been edited, rather than risk a mismatched database.

## Running without Docker

You can also run the API directly (`node backend/src/server.js`) behind your own reverse proxy: Node 20.12 or later, PostgreSQL 15 or later with a **UTF-8** database, and the website built with `npm run build` (the API serves the `dist` folder). The environment variables are the same as in `deploy/production.env.example`; also set `NODE_ENV=production`, `DATABASE_URL` (the restricted `app_api_user` login) and `MIGRATION_DATABASE_URL` (the database owner).

## Database notes

- The database must be created with `ENCODING 'UTF8'` (the Docker setup does this). The application checks and refuses to start on anything else, because Hindi text and firm names would be damaged.
- The application connects as `app_api_user`, a role that **cannot bypass row-level security**. Client data separation is enforced inside the database, not only in code. Migrations run as the owner.
- The embedded development database is refused in production.

## Security checklist before going live

- [ ] `.env` is `chmod 600` and not in git.
- [ ] Bootstrap administrator password changed; a second administrator created.
- [ ] Port 5432 is not reachable from outside.
- [ ] Server firewall allows only 22 (ideally restricted to your IP), 80 and 443.
- [ ] A backup has been restored once on a spare machine (OPERATIONS.md).
- [ ] The Microsoft 365 app is restricted to the one mailbox (AZURE_M365_SETUP.md step 4).
- [ ] SPF, DKIM and DMARC pass (DNS_SPF_DKIM_DMARC.md).
- [ ] Automatic OS security updates are on.
