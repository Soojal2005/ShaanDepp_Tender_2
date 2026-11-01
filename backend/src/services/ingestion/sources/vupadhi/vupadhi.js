/**
 * Crawler client for Vupadhi Techno Services e-procurement portals.
 *
 * Both Telangana (tender.telangana.gov.in) and Andhra Pradesh
 * (tender.apeprocurement.gov.in) run the same Vupadhi platform: Java/Spring MVC
 * with jQuery, jCryption-encrypted form POSTs, session cookies + CSRF tokens.
 *
 * Strategy: use Playwright to load the homepage (which auto-establishes a session),
 * then scrape the tenders visible on the page. The homepage shows "Current Tenders",
 * "Upcoming Tenders", and "Corrigendums" tabs with a limited preview (~5-15 each).
 * We also attempt to click "More..." to get the full listing.
 *
 * For Telangana, a JSON corrigendum endpoint (hPageCorrigendumDetails.html) exists
 * and is fetched as a bonus.
 *
 * parseVupadhiTender is pure and exported for fixture-based tests.
 */
import * as cheerio from 'cheerio';
import { config } from '../../../../config.js';
import { log } from '../../../../log.js';
import { cleanText } from '../../normalize.js';
import { SourceError } from '../../tenderbook.js';

/**
 * Parse a single tender block from the Vupadhi homepage HTML.
 *
 * Each tender is inside a div with class "samer" (AP) or similar. The structure
 * contains: Tender ID, IFB/Tender No, closing date, description, and sometimes
 * a procurement ID in a viewtender() onclick handler.
 */
export function parseVupadhiTender(html, state) {
  const $ = cheerio.load(html);

  // Procurement ID from onclick="viewtender(848803)"
  const onclick = $('[onclick*="viewtender"]').attr('onclick') || '';
  const procId = (onclick.match(/viewtender\((\d+)\)/) || [])[1] || null;

  // Display tender ID: prefer coli-id class, then text of the viewtender link, then procurement ID.
  const displayId = cleanText($('.coli-id').text())
    || cleanText($('[onclick*="viewtender"]').text())
    || procId;

  // Tender/IFB number
  const tenderNo = cleanText($('.coli-tno').text())
    || cleanText($('.tno').text())
    || null;

  // Closing date (class coli-date, or in the date area)
  const closingDateRaw = cleanText($('.coli-date').text())
    || cleanText($('.date').text())
    || null;

  // Title/description
  const title = cleanText($('.tDesc').text())
    || cleanText($('.tender-desc').text())
    || cleanText($('p').last().text())
    || null;

  // Division/circle info (sometimes in the HTML)
  const department = cleanText($('.sCircle_Division').text())
    || cleanText($('.dept').text())
    || null;

  const tenderId = displayId || procId;

  return {
    tenderId,
    refNo: tenderNo,
    title,
    organisationChain: department,
    closingDate: closingDateRaw,
    tenderValue: null, // Not shown on the listing page
    state,
  };
}

/**
 * Parse one row of the full tender listing.
 *
 * Columns are matched by their header text, not by position: Telangana publishes
 * ten columns and Andhra Pradesh nine (it has no "Published" column), so fixed
 * indexes would silently read the wrong field on one of the two.
 */
export function parseVupadhiRow(headers, cells, state) {
  const at = (re) => {
    const i = headers.findIndex((h) => re.test(h));
    return i >= 0 ? cleanText(cells[i]) : null;
  };
  const tenderId = at(/tender\s*id/i);
  return {
    tenderId: tenderId || null,
    refNo: at(/notice\s*no|tender\s*no|ifb/i),
    title: at(/name\s*of\s*work|description|work/i),
    organisationChain: at(/department|circle|division|organisation/i),
    category: at(/category/i),
    publishedDate: at(/publish/i),
    closingDate: at(/clos/i),
    // "₹ 5,97,74,68,240" — toMoney understands the Indian grouping.
    tenderValue: at(/value|amount|cost/i),
    state,
  };
}

/**
 * Parse a Telangana corrigendum JSON entry into the same dto shape.
 */
export function parseVupadhiCorrigendum(obj, state) {
  return {
    tenderId: String(obj.nTenderID ?? obj.nProcurementID ?? ''),
    refNo: cleanText(obj.sTenderNo) || null,
    title: cleanText(obj.sNameOfWork) || null,
    organisationChain: cleanText(obj.sCircle_Division) || null,
    closingDate: obj.sMonth && obj.sDate
      ? `${obj.sDate}-${obj.sMonth}-${new Date().getFullYear()} ${cleanText(obj.sMins) || ''}`.trim()
      : null,
    tenderValue: null,
    state,
  };
}

async function launchChromium({ headless = true, launchImpl = null } = {}) {
  if (launchImpl) return launchImpl();
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { throw new SourceError('Playwright is not installed. Run `npm i playwright && npx playwright install chromium`.'); }
  return chromium.launch({ headless, executablePath: config.crawler?.chromiumPath || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}

/**
 * Build the Vupadhi client for Telangana or Andhra Pradesh.
 * tenders({ page }) -> { content, totalElements, totalPages, page }.
 */
export function createVupadhiClient(opts = {}) {
  const {
    baseUrl,
    state,
    timeoutMs = config.crawler?.timeoutMs ?? 45_000,
    requestDelayMs = config.crawler?.requestDelayMs ?? 1_500,
    maxPages = config.crawler?.maxPages ?? 40,
    headless = true,
    launchImpl = null,
  } = opts;

  if (!baseUrl || !state) throw new Error('Vupadhi client requires baseUrl and state');

  async function tenders({ page = 0 } = {}) {
    if (page > 0) return { content: [], totalElements: 0, totalPages: 1, page };
    const browser = await launchChromium({ headless, launchImpl });
    try {
      const ctx = await browser.newContext({ locale: 'en-IN', ignoreHTTPSErrors: true });
      const pg = await ctx.newPage();
      pg.setDefaultTimeout(timeoutMs * 2);
      // The listing handler calls alert(); an unanswered dialog blocks the page.
      pg.on('dialog', (d) => d.accept().catch(() => {}));

      // Step 1: load the homepage (which may auto-redirect via JS POST to login.html).
      await pg.goto(`${baseUrl}/`, { waitUntil: 'networkidle', timeout: timeoutMs }).catch(() => {});
      // Give the page time to auto-submit and render
      await pg.waitForTimeout(3000);

      // Some Vupadhi portals auto-POST from / to login.html. If we're still on /,
      // try navigating directly to login.html.
      const currentUrl = pg.url();
      if (!currentUrl.includes('login')) {
        await pg.goto(`${baseUrl}/login.html`, { waitUntil: 'networkidle', timeout: timeoutMs }).catch(() => {});
        await pg.waitForTimeout(2000);
      }

      // Step 2: scrape tender blocks from the rendered page.
      const byId = new Map();

      // Extract tender blocks — try multiple selectors used by different Vupadhi versions.
      const tenderHtmlBlocks = await pg.evaluate(() => {
        const blocks = [];
        // AP uses .samer class, Telangana uses similar structure
        const selectors = ['.samer', '.tender-item', '.tender-block', '.tenderbox'];
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach((el) => blocks.push(el.outerHTML));
        }
        // If no blocks found, try to get individual tender containers from tab panels
        if (!blocks.length) {
          document.querySelectorAll('[class*="tender"], [id*="tender"]').forEach((el) => {
            if (el.querySelector('[onclick*="viewtender"]') || el.querySelector('.coli-id')) {
              blocks.push(el.outerHTML);
            }
          });
        }
        // Fallback: look for any element with viewtender onclick
        if (!blocks.length) {
          document.querySelectorAll('[onclick*="viewtender"]').forEach((el) => {
            const parent = el.closest('div') || el.parentElement;
            if (parent) blocks.push(parent.outerHTML);
          });
        }
        return blocks;
      }).catch(() => []);

      for (const html of tenderHtmlBlocks) {
        const dto = parseVupadhiTender(html, state);
        if (dto.tenderId && !byId.has(dto.tenderId)) byId.set(dto.tenderId, dto);
      }
      log.info('vupadhi homepage tenders scraped', { baseUrl, count: byId.size });

      // Step 3: open the full listing. The page's own "More" handler performs the
      // jCryption-encrypted POST to TenderDetailsHome.html, so we only have to get
      // that handler to run -- there is nothing to reimplement.
      await pg.evaluate(() => {
        // Telangana lays a modal over the page which swallows the click.
        for (const sel of ['#tgep-overlay', '#tgep-scope']) document.querySelector(sel)?.remove();
      }).catch(() => {});

      const link = await pg.$('#viewCurrentall').catch(() => null);
      if (link) {
        // Andhra Pradesh renders the control zero-sized, which makes a real click
        // time out; dispatching the event runs the same handler.
        const realClick = await link.click({ timeout: 10_000 }).then(() => true).catch(() => false);
        if (!realClick) {
          await pg.evaluate(() => document.querySelector('#viewCurrentall')
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))).catch(() => {});
        }
        await pg.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
        await pg.waitForTimeout(2500);
      } else {
        log.warn('vupadhi "view all" control not found', { baseUrl });
      }

      // The listing is a DataTable whose id differs between the two portals, so
      // take the richest table on the page rather than hard-coding one.
      const tableId = await pg.evaluate(() => {
        let best = null; let bestRows = 0;
        for (const t of document.querySelectorAll('table[id]')) {
          const n = t.querySelectorAll('tbody tr').length;
          if (n > bestRows) { best = t.id; bestRows = n; }
        }
        return bestRows > 1 ? best : null;
      }).catch(() => null);

      if (tableId) {
        // Ask the table for bigger pages through its own API, so one pass covers
        // far more rows. Ignored on portals that pin the page length.
        await pg.evaluate((id) => {
          const jq = window.jQuery ?? window.$;
          jq?.(`#${id}`)?.DataTable?.().page.len(100).draw(false);
        }, tableId).catch(() => {});
        await pg.waitForTimeout(1500);

        const readPage = () => pg.evaluate((id) => {
          const t = document.getElementById(id);
          if (!t) return { headers: [], rows: [] };
          const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
          return {
            headers: [...t.querySelectorAll('thead th')].map(txt),
            rows: [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map(txt)),
          };
        }, tableId).catch(() => ({ headers: [], rows: [] }));

        for (let p = 0; p < maxPages; p++) {
          const { headers, rows } = await readPage();
          const before = byId.size;
          for (const cells of rows) {
            const dto = parseVupadhiRow(headers, cells, state);
            if (dto.tenderId && !byId.has(dto.tenderId)) byId.set(dto.tenderId, dto);
          }
          const advanced = await pg.evaluate((id) => {
            const next = document.getElementById(`${id}_next`);
            if (!next || /disabled/i.test(next.className)) return false;
            next.click();
            return true;
          }, tableId).catch(() => false);
          if (!advanced) break;
          if (byId.size === before && p > 0) break; // nothing new: end of the table
          await pg.waitForTimeout(Math.max(600, requestDelayMs / 2));
        }
        log.info('vupadhi full listing scraped', { baseUrl, table: tableId, total: byId.size });
      } else {
        log.warn('vupadhi full listing table not found; keeping homepage preview', { baseUrl });
      }

      // Step 4: for Telangana, try the corrigendum JSON endpoint (bonus data).
      if (baseUrl.includes('telangana')) {
        try {
          if (requestDelayMs > 0) await new Promise((r) => setTimeout(r, requestDelayMs));
          const corrigendumData = await pg.evaluate(async () => {
            // Get CSRF token from the page
            const csrfInput = document.querySelector('input[name="CSRFToken"]');
            const csrf = csrfInput?.value || '';
            const url = `/hPageCorrigendumDetails.html${csrf ? '?CSRFToken=' + csrf : ''}`;
            const res = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!res.ok) return [];
            return res.json();
          }).catch(() => []);

          if (Array.isArray(corrigendumData)) {
            for (const obj of corrigendumData) {
              const dto = parseVupadhiCorrigendum(obj, state);
              if (dto.tenderId && !byId.has(dto.tenderId)) byId.set(dto.tenderId, dto);
            }
            log.info('vupadhi corrigendum data fetched', { baseUrl, corrigendums: corrigendumData.length });
          }
        } catch (e) {
          log.warn('vupadhi corrigendum fetch failed (non-fatal)', { error: e.message });
        }
      }

      const content = [...byId.values()];
      if (!content.length) throw new SourceError(`Vupadhi portal (${state}) returned no parseable tenders.`);
      log.info('vupadhi crawl complete', { baseUrl, state, rows: content.length });
      return { content, totalElements: content.length, totalPages: 1, page: 0 };
    } finally {
      await browser.close().catch(() => {});
    }
  }

  return { tenders };
}
