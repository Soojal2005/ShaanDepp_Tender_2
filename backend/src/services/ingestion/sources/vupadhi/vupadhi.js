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

      // Step 3: navigate to the full tender listing page.
      // Vupadhi portals use jCryption to encrypt form POSTs, so we must use
      // Playwright's real click (not JS .click()) to trigger the page's own
      // encryption handler. We try multiple strategies.
      let navigated = null;

      // Strategy A: Playwright real-click on ".viewCurrentall" / "More..." link
      for (const sel of ['.viewCurrentall', '.viewCurrentalltabs', 'a:has-text("More")', 'span:has-text("More")']) {
        const el = await pg.$(sel).catch(() => null);
        if (el) {
          try {
            await Promise.all([
              pg.waitForNavigation({ waitUntil: 'networkidle', timeout: timeoutMs }).catch(() => {}),
              el.click(),
            ]);
            navigated = 'click-' + sel;
            break;
          } catch { /* try next */ }
        }
      }

      // Strategy B: find the TenderDetailsHome form and submit with jCryption
      if (!navigated) {
        navigated = await pg.evaluate(() => {
          const forms = [...document.querySelectorAll('form')];
          for (const form of forms) {
            const action = form.getAttribute('action') || '';
            if (/TenderDetailsHome/i.test(action)) {
              let typeField = form.querySelector('[name="hdnType"]');
              if (!typeField) {
                typeField = document.createElement('input');
                typeField.type = 'hidden';
                typeField.name = 'hdnType';
                form.appendChild(typeField);
              }
              typeField.value = 'current';
              form.submit();
              return 'form-submit';
            }
          }
          return null;
        }).catch(() => null);
        if (navigated) {
          await pg.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
        }
      }

      if (navigated) {
        // Wait for page navigation or AJAX load
        await pg.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
        await pg.waitForTimeout(3000);

        // Scrape the full listing page — look for table rows and tender blocks
        const expandedBlocks = await pg.evaluate(() => {
          const blocks = [];
          // Check for tender blocks (same structure as homepage)
          document.querySelectorAll('.samer, .tender-item, .tender-block').forEach((el) => {
            blocks.push(el.outerHTML);
          });
          // Also check table rows
          if (!blocks.length) {
            document.querySelectorAll('table tbody tr').forEach((tr) => {
              if (tr.innerHTML.length > 50 && tr.querySelectorAll('td').length >= 2) {
                blocks.push(tr.outerHTML);
              }
            });
          }
          // Check for viewtender elements
          if (!blocks.length) {
            document.querySelectorAll('[onclick*="viewtender"]').forEach((el) => {
              const parent = el.closest('div, tr') || el.parentElement;
              if (parent) blocks.push(parent.outerHTML);
            });
          }
          return blocks;
        }).catch(() => []);

        for (const html of expandedBlocks) {
          const dto = parseVupadhiTender(html, state);
          if (dto.tenderId && !byId.has(dto.tenderId)) byId.set(dto.tenderId, dto);
        }
        log.info('vupadhi full listing scraped', { baseUrl, method: navigated, total: byId.size });

        // Try pagination: look for "Next" links
        for (let pageNum = 2; pageNum <= 20; pageNum++) {
          const hasNext = await pg.evaluate(() => {
            const nextLink = [...document.querySelectorAll('a')].find(
              (a) => /next|»|›/i.test(a.textContent?.trim() || '')
            );
            if (nextLink) { nextLink.click(); return true; }
            return false;
          }).catch(() => false);
          if (!hasNext) break;

          await pg.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
          await pg.waitForTimeout(2000);

          const pageBlocks = await pg.evaluate(() => {
            const blocks = [];
            document.querySelectorAll('.samer, .tender-item, table tbody tr, [onclick*="viewtender"]').forEach((el) => {
              const target = el.tagName === 'TR' || el.classList.contains('samer') ? el : (el.closest('div, tr') || el.parentElement);
              if (target && target.innerHTML.length > 50) blocks.push(target.outerHTML);
            });
            return blocks;
          }).catch(() => []);

          let newCount = 0;
          for (const html of pageBlocks) {
            const dto = parseVupadhiTender(html, state);
            if (dto.tenderId && !byId.has(dto.tenderId)) { byId.set(dto.tenderId, dto); newCount++; }
          }
          if (newCount === 0) break; // No new tenders = reached the end
          if (requestDelayMs > 0) await new Promise((r) => setTimeout(r, requestDelayMs));
        }
        log.info('vupadhi after pagination', { baseUrl, total: byId.size });
      } else {
        log.warn('vupadhi could not navigate to full listing', { baseUrl });
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
