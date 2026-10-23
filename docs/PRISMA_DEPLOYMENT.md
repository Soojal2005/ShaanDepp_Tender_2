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
and `APP_DB_PASSWORD`. Only after it succeeds, roll out API containers with `DB_MIGRATE_ON_START=off`
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

Copy exact hosts and region from the project's **Connect** panel. Example shapes:

```dotenv
# Runtime through Supavisor transaction pooler, with the custom runtime role.
DATABASE_URL=postgresql://app_api_user.PROJECT_REF:ENCODED_APP_PASSWORD@POOLER_HOST:6543/postgres?sslmode=require
# Owner through a direct endpoint (IPv6 connectivity required unless IPv4 is enabled).
MIGRATION_DATABASE_URL=postgresql://postgres:ENCODED_OWNER_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require
# If direct IPv6 is unavailable, use the SESSION pooler, never transaction pooling for migrations:
# MIGRATION_DATABASE_URL=postgresql://postgres.PROJECT_REF:ENCODED_OWNER_PASSWORD@POOLER_HOST:5432/postgres?sslmode=require
APP_DB_PASSWORD=RAW_APP_PASSWORD
DB_MIGRATE_ON_START=off
DB_POOL_MAX=5
```

The release job creates/configures `app_api_user` before the API starts. Do not use a
`BYPASSRLS` role as the runtime login. Prisma uses the `pg` adapter without named prepared
statements; tenant settings and role changes are transaction-local, supporting transaction pooling.

If only this backend accesses the database, disable the Supabase Data API in project API
settings as recommended by the [Supabase Prisma guide](https://supabase.com/docs/guides/database/prisma).
The app's policies depend on server-set context rather than Supabase JWT claims. If keeping
the Data API enabled, review its grants independently; never give browser clients database credentials.

## Managed database deployment with Docker Compose

```bash
cp deploy/managed.env.example .env
# Fill in domain, both URLs, app password and first administrator.
docker compose -f docker-compose.managed.yml build api
docker compose -f docker-compose.managed.yml --profile tools run --rm migrate
docker compose -f docker-compose.managed.yml up -d api caddy
```

For a custom CA add a read-only certificate volume to **both** `api` and `migrate` services
before running those commands. Compose clears owner URLs and `APP_DB_PASSWORD` from the API's
environment. Startup seeds the baseline lists and bootstrap admin using runtime credentials.
On each update, build, migrate, then roll out the API in that order. Keep database backups/PITR
enabled at the database provider and back up the app's persistent data volume separately.
Verify `/api/v1/health`, login, master lists and a tenant read/write after deployment.

The original `docker-compose.prod.yml` continues to support a local PostgreSQL container
and automatic startup migrations. Live AWS/Supabase credentials are not needed to build the image.
