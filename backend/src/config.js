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

// Node >= 20.12. Missing files are fine; real environment variables always win
// (loadEnvFile never overrides an already-defined variable, and among files the
// first one loaded wins). Tests never read .env files, so a developer's local
// settings cannot leak into them.
if (process.env.NODE_ENV !== 'test') {
  const files = [path.join(BACKEND_ROOT, '.env'), path.join(REPO_ROOT, '.env')];
  // In production the live values (e.g. PUBLIC_BASE_URL=https://www.procure-brain.in)
  // live in .env.production. Load it FIRST so it wins over any dev `.env` left on
  // the box; real environment variables (e.g. the Render dashboard) still win.
  if (process.env.NODE_ENV === 'production') {
    files.unshift(path.join(REPO_ROOT, '.env.production'), path.join(BACKEND_ROOT, '.env.production'));
  }
  for (const file of files) {
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

// A switch that is ON unless explicitly turned off.
const boolDefaultOn = z
  .enum(['true', 'false', '1', '0', 'on', 'off', ''])
  .optional()
  .transform((v) => !(v === 'false' || v === '0' || v === 'off'));

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
  DIRECT_URL: optionalString,
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1).default(10000),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1).default(30000),
  DB_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(1).default(120000),
  DB_SSL_CA_FILE: optionalString,
  DB_MIGRATE_ON_START: boolDefaultOn,
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

  // Web crawler (scrapes government portals). OFF unless switched on.
  CRAWLER_ENABLED: bool,
  // How pages are fetched: 'http' (cheerio only, for plain-HTML portals) or
  // 'browser' (a real headless browser, for session/JavaScript portals like CPPP).
  CRAWLER_ENGINE: z.enum(['http', 'browser']).default('browser'),
  CRAWLER_CPPP_URL: z.string().url().default('https://eprocure.gov.in'),
  // The captcha-free "Tenders by Closing Date" listing (works across GePNIC portals).
  CRAWLER_CPPP_LIST_PATH: z.string().default('/eprocure/app?page=FrontEndListTendersbyDate&service=page'),
  CRAWLER_CPPP_START_PATH: z.string().default('/eprocure/app'),
  CRAWLER_CPPP_LIST_LINK: z.string().default('Tenders by Closing Date'),
  // The listing opens on "Closing Today", which is empty on Sundays and holidays.
  // This wider window is what actually yields tenders still open when read.
  CRAWLER_CPPP_CLOSING_WINDOW: z.string().default('Closing within 14 days'),
  CRAWLER_CPPP_TABLE_SELECTOR: z.string().default('#table'),
  // How many listing pages to walk per portal (each ~10 tenders). The crawler
  // stops early when a page adds nothing new, so small portals finish quickly;
  // a high value means "effectively everything" for large portals like CPPP.
  CRAWLER_MAX_PAGES: z.coerce.number().int().min(1).max(2000).default(100),
  CRAWL_INTERVAL_MINUTES: z.coerce.number().int().min(15).default(120),
  CRAWLER_USER_AGENT: z.string().default('ShanDeepTenderCrawler/1.0 (+https://procure-brain.com; respectful crawler)'),
  // Path to a system Chromium for the browser engine (set in the Docker image).
  // Empty = use Playwright's own downloaded browser (local development).
  CRAWLER_CHROMIUM_PATH: optionalString,
  CRAWLER_REQUEST_DELAY_MS: z.coerce.number().int().min(0).default(1500),
  // Max detail pages fetched per GePNIC portal per run (new + open back-fill).
  // The same budget now targets the open backlog, so each run's cost is unchanged;
  // raise it to clear the backlog faster if crawl time allows.
  CRAWLER_MAX_DETAILS: z.coerce.number().int().min(0).default(60),
  // Open each NEW tender's detail page (in the live browser session) to capture
  // the public fields the listing omits: estimated value, EMD, fee, category,
  // tender type, source link. ON by default so the crawl fills every public field
  // the frontend shows; set CRAWLER_FETCH_DETAILS=off to fall back to listing-only.
  // Only tenders not already stored are fetched, and at most CRAWLER_MAX_DETAILS
  // of them per portal per run, so the extra cost stays bounded.
  CRAWLER_FETCH_DETAILS: boolDefaultOn,
  CRAWLER_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),

  // On-demand GePNIC document download. A warm, anonymous Playwright context per
  // portal is kept alive and lends pooled pages to re-walk the live listing and
  // stream a tender's PDF when a user asks — nothing is stored. Only works for
  // tenders still in the live closing-window listing. OFF by default.
  GEPNIC_SESSION_ENABLED: bool,
  GEPNIC_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60000),
  GEPNIC_MAX_CONCURRENT_DOWNLOADS: z.coerce.number().int().min(1).max(10).default(3),
  GEPNIC_SESSION_HEALTH_INTERVAL_MS: z.coerce.number().int().min(10000).default(300000),
  GEPNIC_SESSION_RETRY_LIMIT: z.coerce.number().int().min(0).max(3).default(1),
  GEPNIC_LOCATE_MAX_PAGES: z.coerce.number().int().min(1).max(500).default(40),

  // Prune expired tenders. Deletes tenders whose deadline passed more than
  // PRUNE_EXPIRED_GRACE_DAYS ago, keeping any a user watchlisted or raised a
  // case for (so those users still see them). OFF by default.
  PRUNE_EXPIRED_ENABLED: bool,
  PRUNE_EXPIRED_GRACE_DAYS: z.coerce.number().int().min(0).max(365).default(2),
  PRUNE_EXPIRED_INTERVAL_MINUTES: z.coerce.number().int().min(15).default(1440),

  // PDF metadata enrichment (reads amounts from tender PDFs the listing omits).
  // OFF unless switched on. Optionally pin to one provider id while piloting.
  ENRICH_ENABLED: bool,
  ENRICH_PROVIDER_ID: optionalString,
  ENRICH_INTERVAL_MINUTES: z.coerce.number().int().min(15).default(180),
  ENRICH_MAX_DOCS: z.coerce.number().int().min(1).max(5000).default(60),
  ENRICH_REQUEST_DELAY_MS: z.coerce.number().int().min(0).default(1200),
  ENRICH_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20000),
  ENRICH_MAX_BYTES: z.coerce.number().int().min(100000).default(15728640),
  ENRICH_MAX_PAGES: z.coerce.number().int().min(1).max(100).default(15),
  ENRICH_USER_AGENT: z.string().default('ShanDeepTenderCrawler/1.0 (+https://procure-brain.com; respectful crawler)'),

  // Mail. MAIL_MODE=live is required to actually send; dry_run writes to the outbox.
  MAIL_MODE: z.enum(['dry_run', 'live']).default('dry_run'),
  // Which transport delivers mail: 'smtp' (Hostinger) or 'graph' (Microsoft 365).
  MAIL_TRANSPORT: z.enum(['smtp', 'graph']).default('smtp'),
  // Hostinger (or any) SMTP. Used when MAIL_TRANSPORT=smtp and MAIL_MODE=live.
  // Port 465 = implicit TLS (SMTP_SECURE on); 587 = STARTTLS (set SMTP_SECURE=off).
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_SECURE: boolDefaultOn,
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  // The From header, e.g. "Procure Brain <shantanu.trivedi@procure-brain.in>".
  // Hostinger requires the From mailbox to match the authenticated SMTP_USER domain.
  SMTP_FROM: optionalString,
  MAIL_FROM: optionalString, // accepted as an alias for SMTP_FROM
  // Email OTP (registration email verification + password reset).
  OTP_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
  // Microsoft 365 / Graph (alternative transport).
  AZURE_TENANT_ID: optionalString,
  AZURE_CLIENT_ID: optionalString,
  AZURE_CLIENT_SECRET: optionalString,
  GRAPH_SENDER_MAILBOX: optionalString,
  GRAPH_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(25),
  GRAPH_DAILY_LIMIT: z.coerce.number().int().min(1).default(10000),
  GRAPH_BOUNCE_POLL: bool,
  OPS_ALERT_EMAIL: optionalString,

  // Scheduler (background jobs). On by default; set JOBS_ENABLED=off to run the API alone.
  JOBS_ENABLED: boolDefaultOn,

  // Serve the built website from this process. Default: on in production when ../dist exists.
  FRONTEND_DIR: optionalString,
  SERVE_FRONTEND: bool,

  // Website
  WHATSAPP_NUMBER: z.string().default('919301039191'),
  CONTACT_PHONE: z.string().default('+91 79743 92235'),
  CONTACT_EMAIL: z.string().default('shantanu.trivedi@procure-brain.com'),
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
  const smtpReady = Boolean(c.SMTP_HOST && c.SMTP_USER && c.SMTP_PASS && (c.SMTP_FROM || c.MAIL_FROM));
  if (c.MAIL_MODE === 'live') {
    if (c.MAIL_TRANSPORT === 'smtp' && !smtpReady) {
      throw new Error('MAIL_MODE=live with MAIL_TRANSPORT=smtp needs SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM.');
    }
    if (c.MAIL_TRANSPORT === 'graph' && !graphReady) {
      throw new Error('MAIL_MODE=live with MAIL_TRANSPORT=graph needs AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET and GRAPH_SENDER_MAILBOX.');
    }
  }
  // Password-reset and invitation emails embed PUBLIC_BASE_URL. If live mail goes
  // out while it still points at localhost, every "set your password" link is dead
  // for the recipient, so refuse to start rather than send broken links.
  const baseIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i.test(c.PUBLIC_BASE_URL);
  // procure-brain.com is a dead placeholder from old templates; the live domain is .in.
  const baseWrongDomain = /procure-brain\.com\b/i.test(c.PUBLIC_BASE_URL);
  if (c.MAIL_MODE === 'live' && (baseIsLocal || baseWrongDomain)) {
    throw new Error(`MAIL_MODE=live requires PUBLIC_BASE_URL to be the live site URL https://www.procure-brain.in. It is "${c.PUBLIC_BASE_URL}", so password-reset and invitation links in emails would be dead for recipients.`);
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
      migrationUrl: c.MIGRATION_DATABASE_URL || c.DIRECT_URL || c.DATABASE_URL,
      poolMax: c.DB_POOL_MAX,
      connectTimeoutMs: c.DB_CONNECT_TIMEOUT_MS,
      idleTimeoutMs: c.DB_IDLE_TIMEOUT_MS,
      transactionTimeoutMs: c.DB_TRANSACTION_TIMEOUT_MS,
      sslCaFile: c.DB_SSL_CA_FILE ? resolveDir(c.DB_SSL_CA_FILE) : undefined,
      migrateOnStart: c.DB_MIGRATE_ON_START,
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
    crawler: Object.freeze({
      enabled: c.CRAWLER_ENABLED,
      engine: c.CRAWLER_ENGINE,
      intervalMinutes: c.CRAWL_INTERVAL_MINUTES,
      userAgent: c.CRAWLER_USER_AGENT,
      chromiumPath: c.CRAWLER_CHROMIUM_PATH,
      requestDelayMs: c.CRAWLER_REQUEST_DELAY_MS,
      maxDetails: c.CRAWLER_MAX_DETAILS,
      fetchDetails: c.CRAWLER_FETCH_DETAILS,
      maxPages: c.CRAWLER_MAX_PAGES,
      timeoutMs: c.CRAWLER_TIMEOUT_MS,
      cppp: Object.freeze({
        baseUrl: c.CRAWLER_CPPP_URL.replace(/\/$/, ''),
        listPath: c.CRAWLER_CPPP_LIST_PATH,
        startPath: c.CRAWLER_CPPP_START_PATH,
        listLinkText: c.CRAWLER_CPPP_LIST_LINK,
        closingWindowLink: c.CRAWLER_CPPP_CLOSING_WINDOW,
        tableSelector: c.CRAWLER_CPPP_TABLE_SELECTOR,
      }),
    }),
    gepnic: Object.freeze({
      enabled: c.GEPNIC_SESSION_ENABLED,
      downloadTimeoutMs: c.GEPNIC_DOWNLOAD_TIMEOUT_MS,
      maxConcurrent: c.GEPNIC_MAX_CONCURRENT_DOWNLOADS,
      healthIntervalMs: c.GEPNIC_SESSION_HEALTH_INTERVAL_MS,
      retryLimit: c.GEPNIC_SESSION_RETRY_LIMIT,
      locateMaxPages: c.GEPNIC_LOCATE_MAX_PAGES,
      chromiumPath: c.CRAWLER_CHROMIUM_PATH,
      userAgent: c.CRAWLER_USER_AGENT,
      timeoutMs: c.CRAWLER_TIMEOUT_MS,
      requestDelayMs: c.CRAWLER_REQUEST_DELAY_MS,
    }),
    prune: Object.freeze({
      enabled: c.PRUNE_EXPIRED_ENABLED,
      graceDays: c.PRUNE_EXPIRED_GRACE_DAYS,
      intervalMinutes: c.PRUNE_EXPIRED_INTERVAL_MINUTES,
    }),
    enrichment: Object.freeze({
      enabled: c.ENRICH_ENABLED,
      providerId: c.ENRICH_PROVIDER_ID,
      intervalMinutes: c.ENRICH_INTERVAL_MINUTES,
      maxDocs: c.ENRICH_MAX_DOCS,
      requestDelayMs: c.ENRICH_REQUEST_DELAY_MS,
      timeoutMs: c.ENRICH_TIMEOUT_MS,
      maxBytes: c.ENRICH_MAX_BYTES,
      maxPages: c.ENRICH_MAX_PAGES,
      userAgent: c.ENRICH_USER_AGENT,
    }),
    mail: Object.freeze({
      mode: c.MAIL_MODE,
      dryRun: c.MAIL_MODE !== 'live',
      transport: c.MAIL_TRANSPORT,
      smtp: Object.freeze({
        host: c.SMTP_HOST,
        port: c.SMTP_PORT,
        secure: c.SMTP_SECURE,
        user: c.SMTP_USER,
        pass: c.SMTP_PASS,
        from: c.SMTP_FROM || c.MAIL_FROM,
      }),
      tenantId: c.AZURE_TENANT_ID,
      clientId: c.AZURE_CLIENT_ID,
      clientSecret: c.AZURE_CLIENT_SECRET,
      senderMailbox: c.GRAPH_SENDER_MAILBOX,
      perMinute: c.GRAPH_RATE_LIMIT_PER_MIN,
      perDay: c.GRAPH_DAILY_LIMIT,
      pollBounces: c.GRAPH_BOUNCE_POLL,
      opsAlertEmail: c.OPS_ALERT_EMAIL,
    }),
    otp: Object.freeze({
      ttlMinutes: c.OTP_TTL_MINUTES,
      maxAttempts: c.OTP_MAX_ATTEMPTS,
      resendCooldownSeconds: c.OTP_RESEND_COOLDOWN_SECONDS,
    }),
    frontend: Object.freeze({
      dir: c.FRONTEND_DIR ? path.resolve(c.FRONTEND_DIR) : path.join(REPO_ROOT, 'dist'),
      serve: c.SERVE_FRONTEND || isProd,
    }),
    jobsEnabled: c.JOBS_ENABLED,
    seedDemo: c.SEED_DEMO && !isProd,
    site: Object.freeze({
      whatsappNumber: c.WHATSAPP_NUMBER.replace(/\D/g, '').endsWith('8269868808') ? '919301039191' : c.WHATSAPP_NUMBER,
      phone: c.CONTACT_PHONE.replace(/\D/g, '').endsWith('8269868808') ? '+91 79743 92235' : c.CONTACT_PHONE,
      email: c.CONTACT_EMAIL.trim().toLowerCase() === 'info@synquic.com' ? 'shantanu.trivedi@procure-brain.com' : c.CONTACT_EMAIL,
    }),
  });
}

export const config = load(process.env);
export { load as loadConfig };
