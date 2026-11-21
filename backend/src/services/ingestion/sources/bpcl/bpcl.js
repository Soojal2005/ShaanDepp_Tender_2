/**
 * Crawler client for BPCL (Bharat Petroleum Corporation Limited).
 *
 * BPCL's bidding portal (bpcleproc.in) is an abcProcure "eProc-Suite" JavaScript
 * SPA whose full tender search POSTs AES/jCryption-encrypted params — not worth
 * reproducing. But abcProcure also serves a PUBLIC, fully server-rendered
 * dashboard at bpcltenders.eproc.in/Product/publicDash that lists the live
 * tenders with no login and no JavaScript, so a plain HTTP GET + cheerio reads it
 * (confirmed with the ordinary crawler User-Agent, 2026-11-21).
 *
 * The dashboard shows the current live tenders (a subset, not the full archive —
 * the complete list is behind the encrypted search, a possible future
 * enhancement). Columns: S.No | CRFQ No | Tender Title | Department | Due Date |
 * Detail. The full title sits in a hidden <div id="newTendDesc{n}"> in the title
 * cell. Estimated value / EMD / fee are not on the dashboard, so they stay NULL.
 *
 * parseBpclListing is pure and exported for fixture-based tests.
 */
import * as cheerio from 'cheerio';
import { config } from '../../../../config.js';
import { log } from '../../../../log.js';
import { cleanText } from '../../normalize.js';
import { SourceError } from '../../tenderbook.js';
import { fetchHtml } from '../cppp/http.js';

const DASH_PATH = '/Product/publicDash';

/**
 * Parse the BPCL public dashboard HTML into dtos for normalizeCpppTender. Pure.
 * @param {string} html
 * @param {{baseUrl?:string,state?:string|null}} [opts]
 * @returns {object[]}
 */
export function parseBpclListing(html, { baseUrl = 'https://bpcltenders.eproc.in', state = null } = {}) {
  const root = String(baseUrl).replace(/\/$/, '');
  const $ = cheerio.load(html || '');
  const byId = new Map();
  $('table').each((_, t) => {
    // Only the live-tender tables (header has both "CRFQ No" and "Due Date");
    // skip the "Category" (forthcoming) and other sections.
    const header = cleanText($(t).find('tr').first().text()) || '';
    if (!/CRFQ No/i.test(header) || !/Due Date/i.test(header)) return;

    $(t).find('tr').each((_, tr) => {
      const tds = $(tr).find('td');
      if (tds.length < 5) return;
      const crfq = cleanText($(tds[1]).text());
      if (!crfq || !/^\d{6,}$/.test(crfq) || byId.has(crfq)) return; // header / non-tender rows

      const titleCell = $(tds[2]);
      // The full title is in a hidden div; the visible cell is truncated with "…".
      let title = cleanText(titleCell.find('div[id^="newTendDesc"]').first().text())
        || cleanText(titleCell.find('div[id^="newTend"]').first().text());
      if (!title) {
        const visible = cleanText(titleCell.clone().children('div').remove().end().text());
        title = visible ? visible.replace(/\.{2,}$/, '') : null;
      }
      const dept = cleanText($(tds[3]).text());

      byId.set(crfq, {
        tenderId: crfq,
        refNo: crfq,
        title,
        workDescription: title,
        organisationChain: dept ? `Bharat Petroleum (BPCL) - ${dept}` : 'Bharat Petroleum Corporation Limited (BPCL)',
        closingDate: cleanText($(tds[4]).text()), // "21-11-2026 14:00"
        detailUrl: `${root}${DASH_PATH}`,
        state,
      });
    });
  });
  return [...byId.values()];
}

/**
 * Build the BPCL client. Same interface as the other crawlers:
 * tenders({ page }) -> { content, totalElements, totalPages, page }.
 */
export function createBpclClient(opts = {}) {
  const {
    baseUrl = 'https://bpcltenders.eproc.in',
    state = null,
    fetchImpl = globalThis.fetch,
    userAgent = config.crawler?.userAgent,
    timeoutMs = config.crawler?.timeoutMs ?? 30_000,
  } = opts;
  const root = baseUrl.replace(/\/$/, '');

  async function tenders({ page = 0 } = {}) {
    // The dashboard is a single server-rendered page; nothing to paginate.
    if (page > 0) return { content: [], totalElements: 0, totalPages: 1, page };
    const html = await fetchHtml(`${root}${DASH_PATH}`, { fetchImpl, userAgent, timeoutMs });
    const content = parseBpclListing(html, { baseUrl: root, state });
    if (!content.length) {
      throw new SourceError('BPCL public dashboard returned no parseable tenders (portal layout may have changed).');
    }
    log.info('bpcl crawl complete', { baseUrl: root, rows: content.length });
    return { content, totalElements: content.length, totalPages: 1, page: 0 };
  }

  return { tenders };
}
