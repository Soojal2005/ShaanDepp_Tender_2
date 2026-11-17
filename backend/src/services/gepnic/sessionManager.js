/**
 * GePNIC on-demand session manager.
 *
 * Keeps one warm, anonymous Chromium context per GePNIC portal and lends out
 * pooled pages for on-demand work (streaming a tender's document). The whole
 * point is to reuse an authenticated *browser session* — cookies, the portal's
 * server-side session and component state — instead of launching a browser per
 * request or trying to replay a session-bound URL server-side.
 *
 * This is a single-process deployment, so all coordination is in-process:
 *   - a global semaphore caps concurrent downloads (protects memory + the portal),
 *   - a per-portal single-flight promise prevents overlapping (re)initialisation,
 *   - a crashed/disconnected browser is detected and rebuilt on next use,
 *   - a periodic health check refreshes a stale session before a user hits it.
 *
 * Playwright is imported lazily so the backend runs normally when the feature is
 * off and the browser binary is not installed. Tests inject a fake via launchImpl.
 */
import { config } from '../../config.js';
import { log } from '../../log.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Raised when the browser session is gone and work must not proceed. */
export class SessionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SessionError';
  }
}

export class GepnicSessionManager {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxConcurrent]
   * @param {number} [opts.healthIntervalMs]
   * @param {number} [opts.timeoutMs] navigation timeout
   * @param {string} [opts.chromiumPath]
   * @param {string} [opts.userAgent]
   * @param {Function} [opts.launchImpl] test hook returning a fake browser
   */
  constructor(opts = {}) {
    const g = config.gepnic ?? {};
    this.maxConcurrent = opts.maxConcurrent ?? g.maxConcurrent ?? 3;
    this.healthIntervalMs = opts.healthIntervalMs ?? g.healthIntervalMs ?? 300000;
    this.timeoutMs = opts.timeoutMs ?? g.timeoutMs ?? 30000;
    this.chromiumPath = opts.chromiumPath ?? g.chromiumPath ?? '';
    this.userAgent = opts.userAgent ?? g.userAgent;
    this.launchImpl = opts.launchImpl ?? null;

    this.portals = new Map(); // baseUrl -> portal state
    this.available = this.maxConcurrent;
    this.waiters = []; // queued { resolve, reject, timer }
    this.healthTimer = null;
    this.closing = false;
  }

  // ---- concurrency semaphore ------------------------------------------------

  async acquireSlot(timeoutMs) {
    if (this.closing) throw new SessionError('Session manager is shutting down');
    if (this.available > 0) { this.available--; return; }
    await new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new SessionError('Timed out waiting for a free download slot'));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
    this.available--; // claimed on wake
  }

  releaseSlot() {
    this.available++;
    const next = this.waiters.shift();
    if (next) { clearTimeout(next.timer); next.resolve(); }
  }

  get queueDepth() { return this.waiters.length; }

  // ---- browser / context lifecycle -----------------------------------------

  async launchBrowser() {
    if (this.launchImpl) return this.launchImpl();
    let chromium;
    try { ({ chromium } = await import('playwright')); }
    catch { throw new SessionError('Playwright is not installed. Run `npm i playwright && npx playwright install chromium`.'); }
    return chromium.launch({
      headless: true,
      executablePath: this.chromiumPath || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  }

  /** Get (creating if needed) the warm state for a portal, with single-flight init. */
  async ensurePortal(portal) {
    if (this.closing) throw new SessionError('Session manager is shutting down');
    const key = portal.baseUrl;
    let st = this.portals.get(key);
    if (st && st.browser && st.browser.isConnected?.() !== false && st.context) return st;
    if (st?.initPromise) return st.initPromise;

    st = st ?? {};
    this.portals.set(key, st);
    st.initPromise = (async () => {
      // Drop any dead handles before rebuilding.
      await this.disposePortal(key, { keepEntry: true });
      const browser = await this.launchBrowser();
      const context = await browser.newContext({ locale: 'en-IN', acceptDownloads: true, userAgent: this.userAgent });
      // Warm the session by visiting the portal home, so the portal issues its
      // session cookie before the first real request.
      try {
        const warm = await context.newPage();
        await warm.goto(new URL(portal.startPath ?? portal.appPath ?? '/', portal.baseUrl).toString(), { waitUntil: 'domcontentloaded', timeout: this.timeoutMs }).catch(() => {});
        await warm.close().catch(() => {});
      } catch { /* a warm-up failure is not fatal; the first job will retry */ }
      Object.assign(st, { browser, context, portal, createdAt: Date.now(), lastOkAt: Date.now() });
      log.info('gepnic session initialized', { portal: portal.id, baseUrl: portal.baseUrl });
      return st;
    })().finally(() => { st.initPromise = null; });
    return st.initPromise;
  }

  async disposePortal(key, { keepEntry = false } = {}) {
    const st = this.portals.get(key);
    if (!st) return;
    try { await st.context?.close?.(); } catch { /* ignore */ }
    try { await st.browser?.close?.(); } catch { /* ignore */ }
    st.context = null;
    st.browser = null;
    if (!keepEntry) this.portals.delete(key);
  }

  /** Force a fresh session for a portal (after an expiry/crash). */
  async refresh(portal) {
    log.warn('gepnic session refresh', { portal: portal.id, baseUrl: portal.baseUrl });
    await this.disposePortal(portal.baseUrl, { keepEntry: true });
    return this.ensurePortal(portal);
  }

  /**
   * Is the portal session still usable? Cheap within the health interval;
   * otherwise opens a scratch page on the listing and checks the table renders.
   */
  async checkHealth(portal) {
    const st = this.portals.get(portal.baseUrl);
    if (!st?.context) return false;
    if (Date.now() - (st.lastOkAt ?? 0) < this.healthIntervalMs) return true;
    let page;
    try {
      page = await st.context.newPage();
      const url = new URL(portal.listPath ?? portal.appPath ?? '/', portal.baseUrl).toString();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
      const ok = await page.$(portal.tableSelector ?? '#table').then((el) => Boolean(el)).catch(() => false);
      if (ok) st.lastOkAt = Date.now();
      log.info('gepnic session health check', { portal: portal.id, healthy: ok });
      return ok;
    } catch (err) {
      log.warn('gepnic session health check failed', { portal: portal.id, error: err.message });
      return false;
    } finally {
      await page?.close?.().catch(() => {});
    }
  }

  // ---- the lending primitive ------------------------------------------------

  /**
   * Run `fn(page)` on a fresh page in the portal's warm context, under the
   * global concurrency cap. The page is always closed; the context stays alive.
   */
  async executeWithPage(portal, fn, { timeoutMs } = {}) {
    const slotTimeout = timeoutMs ?? config.gepnic?.downloadTimeoutMs ?? 60000;
    await this.acquireSlot(slotTimeout);
    let page;
    try {
      const st = await this.ensurePortal(portal);
      page = await st.context.newPage();
      page.setDefaultTimeout?.(this.timeoutMs);
      const result = await fn(page, st);
      st.lastOkAt = Date.now();
      return result;
    } finally {
      await page?.close?.().catch(() => {});
      this.releaseSlot();
    }
  }

  // ---- health monitor + shutdown -------------------------------------------

  startHealthMonitor() {
    if (this.healthTimer || !this.healthIntervalMs) return;
    this.healthTimer = setInterval(() => {
      for (const [, st] of this.portals) {
        if (st?.portal) this.checkHealth(st.portal).catch(() => {});
      }
    }, this.healthIntervalMs);
    this.healthTimer.unref?.();
  }

  async shutdown() {
    this.closing = true;
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }
    for (const w of this.waiters.splice(0)) { clearTimeout(w.timer); w.reject(new SessionError('shutting down')); }
    for (const key of [...this.portals.keys()]) await this.disposePortal(key);
    log.info('gepnic session manager shut down');
  }
}
