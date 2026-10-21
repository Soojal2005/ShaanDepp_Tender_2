# Browser tests

Real-browser click-through checks (Playwright). They drive the running application the way a person would, and save screenshots to `e2e-output/` (git-ignored).

## One-time

```bash
npm install --no-save playwright
npx playwright install chromium
```

## Run 01 to 06 (development servers with demo data)

Each script expects a **freshly started** API with demo data, so restart the API between scripts:

```bash
# terminal 1  (restart before each script)
SEED_DEMO=on DB_DRIVER=pglite PGLITE_DIR=memory JOBS_ENABLED=off npm run dev:api
# terminal 2
npm run dev:web
# terminal 3
node e2e/01-sign-in-and-admin.mjs
```

Output is one line per check: `PASS  ...` or `FAIL  ...`. The scripts assume the demo accounts from `.env.example`.

## Run 07 (production mode, real PostgreSQL)

Build the site (`npm run build`), start the API as in DEPLOYMENT.md (`NODE_ENV=production`, a PostgreSQL `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `BOOTSTRAP_ADMIN_EMAIL=root@shandeep.test`, `BOOTSTRAP_ADMIN_PASSWORD=Root-Password-2026`, `PUBLIC_BASE_URL=http://localhost:4100`, `PORT=4100`), then:

```bash
node e2e/07-production-smoke.mjs
```

It checks the security headers, caching, the 404 behaviour, cookie flags, the admin pages against PostgreSQL, a public enquiry, and creating a client.
