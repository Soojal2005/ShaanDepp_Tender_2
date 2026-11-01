/**
 * Browser-backed fetch layer for the CPPP crawler.
 *
 * The NIC ePublishing portal establishes a server session and renders the
 * active-tenders table with JavaScript, so a plain HTTP GET is turned away with
 * an error/redirect page. A real headless browser (Playwright) navigates the
 * site the way a person's browser would — establishing the session and running
 * the page's own scripts — and then hands us the fully-rendered HTML.
 *
 * Crucially, the HTML parsing is unchanged: we reuse parseListPage /
 * parseDetailPage from cppp.js. This file only swaps *how* the HTML is obtained.
 * Playwright is a genuine browser performing normal navigation; we do not spoof
 * identity or defeat any protection.
 *
 * Playwright is imported lazily so the backend runs normally when the crawler is
 * off and the browser binary is not installed.
 */
import { config } from '../../../../config.js';
import { log } from '../../../../log.js';
import { SourceError } from '../../tenderbook.js';
import { parseListPage } from './cppp.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Build a GePNIC crawler client that fetches with a real browser. It reads the
 * captcha-free "Tenders by Closing Date" listing (#table) and walks the pager a
 * few pages deep. Tender *detail* pages are captcha-gated, so only the listing
 * fields are collected (id, ref, title, organisation, dates) — enough for an
 * aggregated tender index. Same interface as createCpppClient.
 *
 * This works unchanged for every GePNIC portal (CPPP, state portals, NTPC, …) —
 * just point baseUrl at the portal.
 */
export function createCpppBrowserClient(opts = {}) {
  const c = config.crawler?.cppp ?? {};
  const {
    baseUrl = c.baseUrl ?? 'https://eprocure.gov.in',
    startPath = c.startPath ?? '/eprocure/app',
    listLinkText = c.listLinkText ?? 'Tenders by Closing Date',
    listPath = c.listPath ?? '/eprocure/app?page=FrontEndListTendersbyDate&service=page',
    closingWindowLink = c.closingWindowLink ?? 'Closing within 14 days',
    tableSelector = c.tableSelector ?? '#table',
    state = null, // the portal's state, stamped onto every row for master mapping
    timeoutMs = config.crawler?.timeoutMs ?? 45_000,
    requestDelayMs = config.crawler?.requestDelayMs ?? 1_500,
    maxPages = config.crawler?.maxPages ?? 3,
    headless = true,
    launchImpl = null, // tests inject a fake { launch } here
  } = opts;

  async function getBrowser() {
    if (launchImpl) return launchImpl();
    let chromium;
    try {
      ({ chromium } = await import('playwright'));
    } catch {
      throw new SourceError('Playwright is not installed. Run `npm i playwright && npx playwright install chromium`.');
    }
    // In the container we use the system Chromium (CRAWLER_CHROMIUM_PATH) and must
    // disable the sandbox (no setuid helper as a non-root user). Locally the path
    // is empty, so Playwright's own browser is used with the same safe flags.
    return chromium.launch({
      headless,
      executablePath: config.crawler?.chromiumPath || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  }

  async function tenders({ page = 0 } = {}) {
    if (page > 0) return { content: [], totalElements: 0, totalPages: 1, page };

    const browser = await getBrowser();
    try {
      const ctx = await browser.newContext({ locale: 'en-IN' });
      const pg = await ctx.newPage();

      // The portal is slow and occasionally serves an interstitial, so wait on
      // 'commit', let it settle, then wait for the data table. Retry a couple of
      // times, and fall back to following the menu link from the app home.
      const listUrl = new URL(listPath, baseUrl).toString();
      const windowLink = () => pg.getByRole('link', { name: new RegExp(closingWindowLink, 'i') }).first();
      const settle = async () => {
        await pg.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => {});
        await pg.waitForTimeout(2500);
        return windowLink().count().then((n) => n > 0).catch(() => false);
      };
      let onListing = false;
      for (let attempt = 0; attempt < 2 && !onListing; attempt++) {
        if (attempt) await sleep(requestDelayMs);
        await pg.goto(listUrl, { waitUntil: 'commit', timeout: timeoutMs }).catch(() => {});
        onListing = await settle();
      }
      if (!onListing) {
        await pg.goto(new URL(startPath, baseUrl).toString(), { waitUntil: 'commit', timeout: timeoutMs }).catch(() => {});
        await pg.waitForTimeout(2000);
        const link = pg.getByRole('link', { name: new RegExp(listLinkText, 'i') }).first();
        if (await link.count().catch(() => 0)) await link.click({ timeout: timeoutMs }).catch(() => {});
        onListing = await settle();
      }

      // The listing opens on "Closing Today", which renders an empty table on
      // Sundays and holidays and otherwise only covers the next few hours. The
      // wider window is what carries tenders still open when someone reads them.
      if (onListing) {
        await windowLink().click({ timeout: timeoutMs }).catch(() => {});
        await pg.waitForFunction(
          (sel) => (document.querySelector(sel)?.querySelectorAll('tr').length ?? 0) > 1,
          tableSelector,
          { timeout: timeoutMs },
        ).catch(() => {});
      } else {
        await pg.waitForSelector(`${tableSelector} tr`, { timeout: timeoutMs }).catch(() => {});
      }

      const byId = new Map();
      const absorb = (html) => {
        for (const row of parseListPage(html, baseUrl, { tableSelector })) {
          if (state && !row.state) row.state = state;
          if (row.tenderId && !byId.has(row.tenderId)) byId.set(row.tenderId, row);
        }
      };
      absorb(await pg.content());
      if (!byId.size) {
        throw new SourceError('GePNIC listing rendered no tender rows. The portal flow or layout may have changed.');
      }

      // Walk the pager within the same session. GePNIC shows a sliding window of
      // page numbers, so prefer the next page number's link and fall back to the
      // pager's forward arrow, which is present for as long as pages remain --
      // hunting only for the number ends the walk early once the window shifts.
      for (let p = 2; p <= maxPages; p++) {
        const href = await pg.$$eval('a', (as, n) => {
          const numbered = as.find((x) => new RegExp(`[?&]sp=${n}(?:&|$)`).test(x.href) && /sp=A/i.test(x.href));
          if (numbered) return numbered.href;
          const forward = as.find((x) => /TablePages\.linkFwd/i.test(x.href));
          return forward ? forward.href : null;
        }, p).catch(() => null);
        if (!href) break;

        // A navigation that fails leaves the previous page in place, which would
        // otherwise look exactly like "this page added nothing new", so retry
        // before treating an unchanged tally as the end of the listing.
        const before = byId.size;
        let loaded = false;
        for (let attempt = 0; attempt < 2 && !loaded; attempt++) {
          if (requestDelayMs) await sleep(requestDelayMs);
          loaded = await pg.goto(href, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).then(() => true).catch(() => false);
        }
        if (!loaded) break;
        await pg.waitForSelector(`${tableSelector} tr`, { timeout: timeoutMs }).catch(() => {});
        absorb(await pg.content());
        if (byId.size === before) break; // end of list
      }

      const content = [...byId.values()];
      log.info('gepnic crawl complete', { baseUrl, rows: content.length });
      return { content, totalElements: content.length, totalPages: 1, page: 0 };
    } finally {
      await browser.close().catch(() => {});
    }
  }

  return { tenders };
}
