/**
 * Crawler client for Gujarat's nProcure portal (tender.nprocure.com, "eProc-Suite").
 *
 * nProcure is NOT GePNIC: its public tender list comes from a JSON endpoint
 * (POST /beforeLoginTenderTableList) whose request parameters are AES-encrypted
 * in the browser. Rather than reproduce that crypto, we load the page and drive
 * its own jQuery DataTable through its pages, collecting the raw row objects the
 * server returns — the page does the encryption for us. No login, no captcha.
 *
 * Each row is reshaped (parseNprocureRow) into the same dto shape the shared
 * normalizer (normalizeCpppTender) already understands, so Gujarat tenders flow
 * through the identical normalize -> upsert pipeline as every other portal.
 *
 * parseNprocureRow is pure and exported for fixture-based tests.
 */
import * as cheerio from 'cheerio';
import { config } from '../../../../config.js';
import { log } from '../../../../log.js';
import { cleanText } from '../../normalize.js';
import { SourceError } from '../../tenderbook.js';

/**
 * Turn one raw DataTables row ({ "1": noticeNo, "2": htmlBlob, "3": docs }) into
 * a dto for normalizeCpppTender.
 */
export function parseNprocureRow(row, state = 'Gujarat') {
  const refNo = cleanText(row['1']);
  const $ = cheerio.load(row['2'] || '');
  const text = $('body').text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

  const tenderId = cleanText($('input[name="tenderid"]').first().attr('value'))
    ?? (text.match(/Tender Id\s*:?\s*(\d+)/i) || [])[1] ?? null;
  const department = cleanText((text.match(/^(.*?)\s*Tender Id\s*:/i) || [])[1]);
  const title = cleanText((text.match(/Name Of Work\s*:?\s*(.*?)\s*(?:Corrigendum\s*:|Estimated Contract Value|Last Date|$)/i) || [])[1]);
  const tenderValue = (text.match(/Estimated Contract Value\s*:?\s*([\d.,]+)/i) || [])[1] ?? null;
  // "16-11-2026 18:00:00" (DD-MM-YYYY) — toCpppDate handles this.
  const closingDate = (text.match(/Last Date (?:&|and) Time For Submission\s*:?\s*([0-9]{1,2}-[0-9]{1,2}-[0-9]{4}[ 0-9:]*)/i) || [])[1]?.trim() ?? null;

  return { tenderId, refNo, title, organisationChain: department, closingDate, tenderValue, state };
}

async function launchChromium({ headless = true, launchImpl = null } = {}) {
  if (launchImpl) return launchImpl();
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { throw new SourceError('Playwright is not installed. Run `npm i playwright && npx playwright install chromium`.'); }
  return chromium.launch({ headless, executablePath: config.crawler?.chromiumPath || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}

/**
 * Build the nProcure client. Same interface as the other crawlers:
 * tenders({ page }) -> { content, totalElements, totalPages, page }.
 */
export function createNprocureClient(opts = {}) {
  const {
    baseUrl = 'https://tender.nprocure.com',
    state = 'Gujarat',
    timeoutMs = config.crawler?.timeoutMs ?? 45_000,
    requestDelayMs = config.crawler?.requestDelayMs ?? 1_500,
    maxPages = config.crawler?.maxPages ?? 40, // DataTable pages of pageLen rows
    pageLen = 50,
    headless = true,
    launchImpl = null,
  } = opts;

  async function tenders({ page = 0 } = {}) {
    if (page > 0) return { content: [], totalElements: 0, totalPages: 1, page };
    const browser = await launchChromium({ headless, launchImpl });
    try {
      const ctx = await browser.newContext({ locale: 'en-IN' });
      const pg = await ctx.newPage();
      await pg.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
      const ready = await pg.waitForFunction(
        () => window.jQuery && window.jQuery.fn.DataTable && window.jQuery('#DataTables_Table_0').length && window.jQuery.fn.dataTable.isDataTable('#DataTables_Table_0'),
        { timeout: timeoutMs },
      ).then(() => true).catch(() => false);
      if (!ready) throw new SourceError('nProcure tender table did not initialise. The portal layout may have changed.');

      // Drive the DataTable through its pages; the page encrypts each request.
      const rawRows = await pg.evaluate(async ({ pageLen, maxPages, delay }) => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const $ = window.jQuery;
        const dt = $('#DataTables_Table_0').DataTable();
        const drawOnce = (fn) => new Promise((res) => { dt.one('draw', () => res()); fn(); });
        const out = [];
        await drawOnce(() => dt.page.len(pageLen).draw(false));
        for (let p = 0; p < maxPages; p++) {
          dt.rows().data().each((r) => out.push(r));
          const info = dt.page.info();
          if (info.page + 1 >= info.pages) break;
          await drawOnce(() => dt.page('next').draw(false));
          await sleep(delay);
        }
        return out;
      }, { pageLen, maxPages, delay: requestDelayMs }).catch((e) => { throw new SourceError(`nProcure pagination failed: ${e.message}`); });

      const byId = new Map();
      for (const row of rawRows || []) {
        const dto = parseNprocureRow(row, state);
        if (dto.tenderId && !byId.has(dto.tenderId)) byId.set(dto.tenderId, dto);
      }
      const content = [...byId.values()];
      if (!content.length) throw new SourceError('nProcure returned no parseable tenders.');
      log.info('nprocure crawl complete', { baseUrl, rows: content.length });
      return { content, totalElements: content.length, totalPages: 1, page: 0 };
    } finally {
      await browser.close().catch(() => {});
    }
  }

  return { tenders };
}
