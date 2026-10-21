/**
 * Runtime configuration. Everything comes from the environment (optionally
 * loaded from backend/.env or the repository root .env); nothing secret has a
 * default. Integrations that need credentials are OFF unless explicitly
 * switched on, so a fresh checkout can never send mail or call a paid API by
 * accident.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');

// Node >= 20.12. Missing files are fine; real environment variables always win.
// Tests never read .env files, so a developer's local settings cannot leak into them.
if (process.env.NODE_ENV !== 'test') {
  for (const file of [path.join(BACKEND_ROOT, '.env'), path.join(REPO_ROOT, '.env')]) {
    try {
      process.loadEnvFile(file);
    } catch {
      /* no such file */
    }
  }
}

const bool = z
  .enum(['true', 'false', '1', '0', 'on', 'off', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1' || v === 'on');

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: optionalString,

  // Database. 'auto' = real PostgreSQL when DATABASE_URL is set, else embedded PGlite.
  // DB_DRIVER=pglite forces the embedded engine even if DATABASE_URL is present.
  DB_DRIVER: z.enum(['auto', 'pglite', 'pg']).default('auto'),
  DATABASE_URL: optionalString,
  MIGRATION_DATABASE_URL: optionalString,
  APP_DB_PASSWORD: optionalString,
  PGLITE_DIR: z.string().default('var/pgdata'),

  // Sessions
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 7),
  COOKIE_SECURE: bool,

  // Files
  STORAGE_DIR: z.string().default('var/storage'),
  OUTBOX_DIR: z.string().default('var/outbox'),

  // Development convenience: create sample accounts at start-up. Ignored in production.
  SEED_DEMO: bool,

  // Bootstrap (first platform admin; created by `npm run seed`)
  BOOTSTRAP_ADMIN_EMAIL: optionalString,
  BOOTSTRAP_ADMIN_PASSWORD: optionalString,
  BOOTSTRAP_ADMIN_NAME: z.string().default('Platform Administrator'),

  // Tenderbook (tender data licensed in the client's name)
  TENDERBOOK_SYNC: bool,
  TENDERBOOK_API_URL: z.string().url().default('https://dev-api.tenderbook.in'),
  TENDERBOOK_API_KEY: optionalString,
  TENDERBOOK_KEY_VALID_TILL: optionalString,
  INGEST_INTERVAL_MINUTES: z.coerce.number().int().min(5).default(120),

  // Microsoft 365 / Graph. MAIL_MODE=live is required to actually send.
  MAIL_MODE: z.enum(['dry_run', 'live']).default('dry_run'),
  AZURE_TENANT_ID: optionalString,
  AZURE_CLIENT_ID: optionalString,
  AZURE_CLIENT_SECRET: optionalString,
  GRAPH_SENDER_MAILBOX: optionalString,
  GRAPH_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(25),
  GRAPH_DAILY_LIMIT: z.coerce.number().int().min(1).default(10000),
  OPS_ALERT_EMAIL: optionalString,

  // Scheduler
  JOBS_ENABLED: bool,

  // Website
  WHATSAPP_NUMBER: z.string().default('918269868808'),
  CONTACT_PHONE: z.string().default('+91 82698 68808'),
  CONTACT_EMAIL: z.string().default('info@synquic.com'),
});

function load(env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const c = parsed.data;

  const graphReady = Boolean(
    c.AZURE_TENANT_ID && c.AZURE_CLIENT_ID && c.AZURE_CLIENT_SECRET && c.GRAPH_SENDER_MAILBOX
  );
  if (c.MAIL_MODE === 'live' && !graphReady) {
    throw new Error(
      'MAIL_MODE=live needs AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET and GRAPH_SENDER_MAILBOX.'
    );
  }
  if (c.TENDERBOOK_SYNC && !c.TENDERBOOK_API_KEY) {
    throw new Error('TENDERBOOK_SYNC=on needs TENDERBOOK_API_KEY.');
  }
  const dbDriver = c.DB_DRIVER === 'auto' ? (c.DATABASE_URL ? 'pg' : 'pglite') : c.DB_DRIVER;
  if (dbDriver === 'pg' && !c.DATABASE_URL) {
    throw new Error('DB_DRIVER=pg needs DATABASE_URL.');
  }
  if (c.NODE_ENV === 'production' && dbDriver === 'pglite') {
    throw new Error('Production must use PostgreSQL: set DATABASE_URL (the embedded engine is for development and tests).');
  }

  const isProd = c.NODE_ENV === 'production';
  const resolveDir = (d) => (path.isAbsolute(d) ? d : path.resolve(BACKEND_ROOT, d));

  return Object.freeze({
    env: c.NODE_ENV,
    isProd,
    isTest: c.NODE_ENV === 'test',
    port: c.PORT,
    publicBaseUrl: c.PUBLIC_BASE_URL.replace(/\/$/, ''),
    corsOrigins: c.CORS_ORIGINS
      ? c.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
      : [c.PUBLIC_BASE_URL.replace(/\/$/, '')],
    db: Object.freeze({
      driver: dbDriver,
      url: c.DATABASE_URL,
      migrationUrl: c.MIGRATION_DATABASE_URL || c.DATABASE_URL,
      appPassword: c.APP_DB_PASSWORD,
      pgliteDir: c.PGLITE_DIR === 'memory' ? 'memory://' : resolveDir(c.PGLITE_DIR),
    }),
    session: Object.freeze({
      ttlMs: c.SESSION_TTL_HOURS * 3600 * 1000,
      cookieName: 'pb_session',
      csrfHeader: 'x-csrf-token',
      secureCookie: c.COOKIE_SECURE || isProd,
    }),
    storageDir: resolveDir(c.STORAGE_DIR),
    outboxDir: resolveDir(c.OUTBOX_DIR),
    bootstrapAdmin: Object.freeze({
      email: c.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase(),
      password: c.BOOTSTRAP_ADMIN_PASSWORD,
      name: c.BOOTSTRAP_ADMIN_NAME,
    }),
    tenderbook: Object.freeze({
      enabled: c.TENDERBOOK_SYNC,
      baseUrl: c.TENDERBOOK_API_URL.replace(/\/$/, ''),
      apiKey: c.TENDERBOOK_API_KEY,
      validTill: c.TENDERBOOK_KEY_VALID_TILL,
      intervalMinutes: c.INGEST_INTERVAL_MINUTES,
    }),
    mail: Object.freeze({
      mode: c.MAIL_MODE,
      dryRun: c.MAIL_MODE !== 'live',
      tenantId: c.AZURE_TENANT_ID,
      clientId: c.AZURE_CLIENT_ID,
      clientSecret: c.AZURE_CLIENT_SECRET,
      senderMailbox: c.GRAPH_SENDER_MAILBOX,
      perMinute: c.GRAPH_RATE_LIMIT_PER_MIN,
      perDay: c.GRAPH_DAILY_LIMIT,
      opsAlertEmail: c.OPS_ALERT_EMAIL,
    }),
    jobsEnabled: c.JOBS_ENABLED,
    seedDemo: c.SEED_DEMO && !isProd,
    site: Object.freeze({
      whatsappNumber: c.WHATSAPP_NUMBER,
      phone: c.CONTACT_PHONE,
      email: c.CONTACT_EMAIL,
    }),
  });
}

export const config = load(process.env);
export { load as loadConfig };
