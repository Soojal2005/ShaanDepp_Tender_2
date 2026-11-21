/**
 * Crawler client for CPWD (Central Public Works Department) eTenders.
 *
 * CPWD runs NIC-TMS (etender.cpwd.gov.in). Its entry page looks like a login, but
 * the "Tender Information" menu exposes a PUBLIC "All Tenders" view that needs no
 * login — a jQuery DataTable (#awardedDataTable) sorted newest-first, backed by a
 * server-side source (~160k historic rows), rendered by the portal's own JS. So
 * this adapter drives a real headless browser (like nProcure): it opens the
 * public view and walks the first `maxPages` DataTable pages (newest tenders),
 * reading each page's rows — it does NOT try to pull the whole archive.
 *
 * Columns (verified 2026-11-21): Tender ID | NIT/RFP No | Name of Work |
 * Publishing Office | Estimated Cost (₹) | EMD Amount (₹) | Bid Submission
 * Closing | Bid Opening | Status | Action. CPWD DOES publish estimated value and
 * EMD, so those are captured (unlike most portals).
 *
 * parseCpwdRows is pure and exported for fixture-based tests.
 */
import * as cheerio from 'cheerio';
import { config } from '../../../../config.js';
import { log } from '../../../../log.js';
import { cleanText } from '../../normalize.js';
import { SourceError } from '../../tenderbook.js';

const TABLE = '#awardedDataTable';

/**
 * Parse CPWD "All Tenders" table HTML into dtos for normalizeCpppTender. Pure.
 * @param {string} html  outerHTML of (or a page containing) the tender table
 * @param {{baseUrl?:string,state?:string|null}} [opts]
 * @returns {object[]}
 */
export function parseCpwdRows(html, { baseUrl = 'https://etender.cpwd.gov.in', state = null } = {}) {
  const root = String(baseUrl).replace(/\/$/, '');
  const $ = cheerio.load(html || '');
  const byId = new Map();
  $('tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 8) return; // header / layout rows
    const tenderId = cleanText($(tds[0]).text());
    if (!tenderId || !/^\d{3,}$/.test(tenderId) || byId.has(tenderId)) return;
    const office = cleanText($(tds[3]).text());
    byId.set(tenderId, {
      tenderId,
      refNo: cleanText($(tds[1]).text()),
      title: cleanText($(tds[2]).text()),
      workDescription: cleanText($(tds[2]).text()),
      organisationChain: office ? `CPWD - ${office}` : 'Central Public Works Department (CPWD)',
      tenderValue: cleanText($(tds[4]).text()),   // "₹18,17,411" -> toMoney
      emdAmount: cleanText($(tds[5]).text()),     // "₹36,348" -> toMoney
      closingDate: cleanText($(tds[6]).text()),   // "28/11/2026 15:00"
      openingDate: cleanText($(tds[7]).text()),
      detailUrl: `${root}/tenderAwardedDetails.html`,
      state,
    });
  });
  return [...byId.values()];
}

async function launchChromium({ headless = true, launchImpl = null } = {}) {
  if (launchImpl) return launchImpl();
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { throw new SourceError('Playwright is not installed. Run `npm i playwright && npx playwright install chromium`.'); }
  return chromium.launch({ headless, executablePath: config.crawler?.chromiumPath || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}

/**
 * Build the CPWD client. Same interface as the other crawlers:
 * tenders({ page }) -> { content, totalElements, totalPages, page }.
 * Drives the public "All Tenders" DataTable for the newest `maxPages` pages.
 */
export function createCpwdClient(opts = {}) {
  const {
    baseUrl = 'https://etender.cpwd.gov.in',
    state = null,
    timeoutMs = config.crawler?.timeoutMs ?? 45_000,
    requestDelayMs = config.crawler?.requestDelayMs ?? 1_500,
    // CPWD's "All Tenders" is the whole archive (newest first). Only the first
    // pages are recent/relevant, so cap tightly regardless of global maxPages.
    maxPages = Math.min(config.crawler?.maxPages ?? 25, 25),
    userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    headless = true,
    launchImpl = null,
  } = opts;
  const root = baseUrl.replace(/\/$/, '');
  const drawTimeout = Math.max(20_000, timeoutMs);

  async function tenders({ page = 0 } = {}) {
    if (page > 0) return { content: [], totalElements: 0, totalPages: 1, page };
    const browser = await launchChromium({ headless, launchImpl });
    try {
      const ctx = await browser.newContext({ locale: 'en-IN', userAgent });
      const pg = await ctx.newPage();
      pg.setDefaultTimeout(timeoutMs * 2);
      await pg.goto(`${root}/`, { waitUntil: 'networkidle', timeout: timeoutMs }).catch(() => {});
      await pg.waitForTimeout(2500); // let the menu handlers attach before clicking
      // Open the public "All Tenders" view (the NIC-TMS menu handler).
      await pg.evaluate(() => document.getElementById('a_tenderAwardedDetails')?.click()).catch(() => {});
      await pg.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
      await pg.waitForTimeout(3500); // let the DataTable's server-side rows render

      // Ready = the tender table has rows. The DataTable paging API is used
      // best-effort below; if it is unavailable we still return the first page.
      const ready = await pg.waitForFunction(
        (sel) => document.querySelectorAll(`${sel} tbody tr`).length > 0,
        TABLE, { timeout: timeoutMs },
      ).then(() => true).catch(() => false);
      if (!ready) throw new SourceError('CPWD tender table did not initialise (portal layout may have changed).');

      const byId = new Map();
      for (let p = 0; p < maxPages; p++) {
        const tableHtml = await pg.evaluate((sel) => {
          const el = document.querySelector(sel);
          return el ? el.outerHTML : '';
        }, TABLE).catch(() => '');
        for (const dto of parseCpwdRows(tableHtml, { baseUrl: root, state })) {
          if (dto.tenderId && !byId.has(dto.tenderId)) byId.set(dto.tenderId, dto);
        }
        const hasNext = await pg.evaluate((sel) => {
          const info = window.jQuery(sel).DataTable().page.info();
          return info.page + 1 < info.pages;
        }, TABLE).catch(() => false);
        if (!hasNext) break;
        const advanced = await pg.evaluate(({ sel, to }) => new Promise((res) => {
          try {
            const t = window.jQuery(sel).DataTable();
            const timer = setTimeout(() => res(false), to);
            t.one('draw', () => { clearTimeout(timer); res(true); });
            t.page('next').draw(false);
          } catch { res(false); }
        }), { sel: TABLE, to: drawTimeout }).catch(() => false);
        if (!advanced) break;
        if (requestDelayMs > 0) await new Promise((r) => setTimeout(r, requestDelayMs));
      }

      const content = [...byId.values()];
      if (!content.length) throw new SourceError('CPWD returned no parseable tenders.');
      log.info('cpwd crawl complete', { baseUrl: root, rows: content.length, pagesWalked: maxPages });
      return { content, totalElements: content.length, totalPages: 1, page: 0 };
    } finally {
      await browser.close().catch(() => {});
    }
  }

  return { tenders };
}
