# Prisma, AWS and Supabase PostgreSQL

Prisma 7 is used at runtime for session resolution, master-list reads and the health check.
The application also keeps its existing parameterized SQL for search, reporting, jobs and
other operations. Both paths enforce the same PostgreSQL role and tenant policies.

## Database access and schema changes

Use `db.withPrismaContext(context, async (tx) => { ... })` for model operations. It opens
an interactive transaction, sets `SET LOCAL ROLE app_api_user` and transaction-local
organization, actor scope and user settings before running the callback. Use the provided
`tx` inside the callback; the root Prisma client is private. `db.withContext()` remains
the equivalent SQL API. Each callback is its own transaction: do not nest the two APIs
or split an atomic operation between them. Prisma returns native BigInt, Decimal and Date
values; convert these explicitly in API response views where necessary.

The SQL in `backend/migrations/` remains authoritative because Prisma schema syntax cannot
represent all of the app's RLS policies, functions, triggers and check constraints.
Do **not** run `prisma migrate deploy`, `prisma migrate dev` or `prisma db push` on this
database. Use `npm run migrate`, or `node src/db/migrate.js` inside the backend container.
The runner preserves existing history and checksums, pins a connection and takes a PostgreSQL
advisory lock so two release jobs cannot apply the same migration concurrently.

For a schema change, add the next numbered SQL migration, then:

```bash
# Local disposable PostgreSQL only: this creates and drops a scratch database.
PRISMA_SYNC_PG_URL=postgresql://postgres:password@localhost:5432/postgres npm run db:schema --prefix backend
npm run db:validate
npm test
```

Commit the new migration and regenerated `backend/prisma/schema.prisma`. The sync account
needs CREATE DATABASE/ROLE permissions; do not point the scratch tooling at production.
`TEST_PG_URL` runs the API tests and schema drift check against disposable real PostgreSQL databases.

`npm install` generates the client automatically. `npm run db:generate` regenerates it without
connecting to a database. Use Node 22.12+ (the Docker image uses Node 22), or Node 20.19+.
The Docker build generates the client before pruning development packages; the runtime
includes `@prisma/client` and driver adapters and does not require the Prisma CLI.

## Connection settings

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Restricted `app_api_user` runtime login; may use a transaction pooler. |
| `MIGRATION_DATABASE_URL` | Owner/admin connection for releases; must be direct or session pooled. |
| `DIRECT_URL` | Alias for the migration URL when `MIGRATION_DATABASE_URL` is unset. |
| `APP_DB_PASSWORD` | Raw password assigned to `app_api_user` by the migration job. |
| `DB_MIGRATE_ON_START` | Defaults to `on` for the existing single-server setup; use `off` for a separate release job. |
| `DB_POOL_MAX` | Shared SQL/Prisma runtime pool per process, default 10; start at 5 for a managed deployment. |
| `DB_CONNECT_TIMEOUT_MS` | Connection acquisition timeout, default 10000. |
| `DB_IDLE_TIMEOUT_MS` | Idle connection lifetime, default 30000. |
| `DB_TRANSACTION_TIMEOUT_MS` | Prisma transaction timeout, default 120000; keep callbacks short. |
| `DB_SSL_CA_FILE` | Optional mounted CA PEM; enables certificate verification for both runtime and migrations. |

Owner URLs must connect as an account permitted to create roles and own the application
schema. Migration 008 explicitly grants `app_api_user` to the migration account, allowing
bootstrap on managed PostgreSQL without a superuser. Passwords in URLs must be percent
encoded; `APP_DB_PASSWORD` is the original, unencoded password. The API does not need an owner
connection when migrations run separately. The health check tests runtime credentials via Prisma.

## AWS RDS or Aurora PostgreSQL

Create a UTF-8 PostgreSQL database in the same region/VPC as the app. Give the app and release
task network access to port 5432 through security groups. Use a database owner with role
creation privileges for releases and `app_api_user` for the service.

```dotenv
DATABASE_URL=postgresql://app_api_user:ENCODED_APP_PASSWORD@DB_ENDPOINT:5432/shandeep?sslmode=require
MIGRATION_DATABASE_URL=postgresql://OWNER:ENCODED_OWNER_PASSWORD@DB_ENDPOINT:5432/shandeep?sslmode=require
APP_DB_PASSWORD=RAW_APP_PASSWORD
DB_SSL_CA_FILE=/certs/rds-ca-bundle.pem
DB_MIGRATE_ON_START=off
DB_POOL_MAX=5
```

Download the current [AWS RDS CA bundle](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html)
and mount it at the configured path in both API and release containers. The CA file option
verifies certificates and overrides SSL query parameters in the URLs.

Build and push the Docker image to your registry for ECS/App Runner, or use the Compose
workflow below on EC2. Run `node src/db/migrate.js` once as a release task with the owner URL
and `APP_DB_PASSWORD`. To load the optional synthetic examples, then run
`node src/db/seed-showcase.js` as a separate task with the restricted runtime URL.
Only after those tasks succeed, roll out API containers with `DB_MIGRATE_ON_START=off`
and the runtime URL. Store credentials in your deployment's secret store. Supply owner
credentials to the release task only.

This is a long-running Node/Express service with an in-process scheduler and filesystem
storage. ECS/EC2 are suitable without changing that architecture. Multiple replicas need
shared persistent storage and exactly one scheduler (`JOBS_ENABLED=on` on one process,
`off` on others). Set `STORAGE_DIR` and `OUTBOX_DIR` to persistent mounted paths; an ephemeral
container filesystem is insufficient for uploads. Lambda requires separate HTTP, job and
storage integration work.

## Supabase PostgreSQL

Use a dedicated project with an empty application `public` schema. Keep Supabase-managed
schemas such as `auth` and `storage` separate. This app retains its own cookie authentication;
adding Supabase PostgreSQL does not switch authentication or file uploads to Supabase services.

The current Supabase project uses the shared pooler shown below. Check its **Connect**
panel if the pooler host changes. The runtime password is generated separately from
the database-owner password:

```dotenv
# Runtime: restricted app role through the transaction pooler.
DATABASE_URL=postgresql://app_api_user.qtydolbquskvbpleudrm:ENCODED_APP_PASSWORD@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require&uselibpqcompat=true
# Release job: owner through the session pooler. DIRECT_URL is an alias for this variable.
MIGRATION_DATABASE_URL=postgresql://postgres.qtydolbquskvbpleudrm:ENCODED_OWNER_PASSWORD@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true
APP_DB_PASSWORD=RAW_APP_PASSWORD
DB_MIGRATE_ON_START=off
DB_POOL_MAX=5
```

The release job creates/configures `app_api_user` before the API starts. Do not use a
`BYPASSRLS` role as the runtime login. Prisma uses the `pg` adapter without named prepared
statements; tenant settings and role changes are transaction-local, supporting transaction pooling.
The `uselibpqcompat=true` parameter makes the Node `pg` driver treat `sslmode=require`
like libpq: the connection is encrypted but its certificate is not verified. For
certificate verification, download the project's root certificate from Supabase
Database Settings and set `DB_SSL_CA_FILE` on both release and runtime processes.
The owner's password and `MIGRATION_DATABASE_URL` belong only in the release job;
the website and long-running API use the restricted `DATABASE_URL`.

After the release migration, run the optional seed task shown below. In Supabase's SQL Editor,
verify it with:

```sql
SELECT provider_id, count(*) FROM public.tenders WHERE provider_id = 'sample' GROUP BY provider_id;
SELECT provider, count(*) FROM public.historical_awards WHERE provider = 'sample' GROUP BY provider;
```

The expected counts are 12 tenders and five award results. Titles start with `[Sample]`,
and rerunning the seed preserves edits to those records.

Keep the Supabase Data API enabled to show the public synthetic tender examples on the
website. Migration 009 grants the `anon` role read access to **only** tenders whose
`provider_id = 'sample'`; other application tables remain inaccessible through the
publishable key. The authenticated portal continues to use the server API and its own
cookie sessions. Do not put database passwords or Supabase secret keys in `VITE_` variables.

For the browser showcase, set these two public values **before building** the website
(or before `docker compose ... build api`):

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Vite embeds them in the website bundle at build time; changing the container's runtime
environment alone will not update that bundle. For local development, put them in an
ignored `.env.local`. With no values, the sample-tender section is hidden. After
running migration 009 and `seed:showcase` against the Supabase database, the homepage
shows three labelled synthetic tenders. The publishable key cannot apply migrations
or insert seed rows; those steps use the owner and restricted runtime PostgreSQL URLs
above, respectively.

## Managed database deployment with Docker Compose

```bash
cp deploy/managed.env.example .env
# Fill in domain, both URLs, app password, first administrator and VITE values.
docker compose -f docker-compose.managed.yml build api
docker compose -f docker-compose.managed.yml --profile tools run --rm migrate
docker compose -f docker-compose.managed.yml --profile tools run --rm seed
docker compose -f docker-compose.managed.yml up -d api caddy
```

For a custom CA add a read-only certificate volume to **both** `api` and `migrate` services
before running those commands. Compose clears owner URLs and `APP_DB_PASSWORD` from the API's
environment. The optional `seed` step uses only runtime credentials and adds 12 synthetic
tenders, five synthetic award results, a sample provider and an empty sample organization.
It is safe to rerun and does not create demo logins or overwrite existing sample rows.
Startup seeds the baseline lists and bootstrap admin using runtime credentials.

### Optional demo-role logins on a managed Supabase project

The normal production seed intentionally does not create the five `@demo.test` logins.
When a demo of every role is explicitly needed, run the scoped account seed from
`backend/` with the project's runtime and owner URLs configured:

```bash
node scripts/seed-demo-accounts.mjs --project-ref=YOUR_PROJECT_REF --apply
node scripts/audit-demo-accounts.mjs
node scripts/check-db-demo-logins.mjs
node scripts/check-live-demo-logins.mjs --url=https://YOUR_SITE_DOMAIN
```

The account seed creates only the missing demo organization and five role accounts.
It refuses a mismatched project reference and leaves existing users' passwords and
roles untouched. All five use the published `Demo-Pass-2026` password, so remove or
disable these accounts before using the project for real client data. These are
application database users, not Supabase Auth users.

On each update, build, migrate, then roll out the API in that order. Keep database backups/PITR
enabled at the database provider and back up the app's persistent data volume separately.
Verify `/api/v1/health`, login, master lists and a tenant read/write after deployment.

The original `docker-compose.prod.yml` continues to support a local PostgreSQL container
and automatic startup migrations. Live AWS/Supabase credentials are not needed to build the image.
