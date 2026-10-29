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
    tableSelector = c.tableSelector ?? '#table',
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
    return chromium.launch({ headless });
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
      const settleAndFind = async () => {
        await pg.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => {});
        await pg.waitForTimeout(2500);
        return pg.waitForSelector(`${tableSelector} tr`, { timeout: timeoutMs }).then(() => true).catch(() => false);
      };
      let haveTable = false;
      for (let attempt = 0; attempt < 2 && !haveTable; attempt++) {
        if (attempt) await sleep(requestDelayMs);
        await pg.goto(listUrl, { waitUntil: 'commit', timeout: timeoutMs }).catch(() => {});
        haveTable = await settleAndFind();
      }
      if (!haveTable) {
        await pg.goto(new URL(startPath, baseUrl).toString(), { waitUntil: 'commit', timeout: timeoutMs }).catch(() => {});
        await pg.waitForTimeout(2000);
        const link = pg.getByRole('link', { name: new RegExp(listLinkText, 'i') }).first();
        if (await link.count().catch(() => 0)) await link.click({ timeout: timeoutMs }).catch(() => {});
        haveTable = await settleAndFind();
      }

      const byId = new Map();
      const absorb = (html) => {
        for (const row of parseListPage(html, baseUrl, { tableSelector })) {
          if (row.tenderId && !byId.has(row.tenderId)) byId.set(row.tenderId, row);
        }
      };
      absorb(await pg.content());
      if (!byId.size) {
        throw new SourceError('GePNIC listing rendered no tender rows. The portal flow or layout may have changed.');
      }

      // Walk the pager (?...&sp=N) within the same session, up to maxPages.
      for (let p = 2; p <= maxPages; p++) {
        const href = await pg.$$eval('a', (as, n) => {
          const a = as.find((x) => new RegExp(`[?&]sp=${n}(?:&|$)`).test(x.href) && /sp=A/i.test(x.href));
          return a ? a.href : null;
        }, p).catch(() => null);
        if (!href) break;
        if (requestDelayMs) await sleep(requestDelayMs);
        await pg.goto(href, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
        await pg.waitForSelector(tableSelector, { timeout: timeoutMs }).catch(() => {});
        absorb(await pg.content());
      }

      const content = [...byId.values()];
      log.info('gepnic crawl page fetched', { baseUrl, rows: content.length });
      return { content, totalElements: content.length, totalPages: 1, page: 0 };
    } finally {
      await browser.close().catch(() => {});
    }
  }

  return { tenders };
}
