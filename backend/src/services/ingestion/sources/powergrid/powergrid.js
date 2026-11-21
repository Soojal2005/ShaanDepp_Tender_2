/**
 * Crawler client for POWERGRID (Power Grid Corporation of India).
 *
 * POWERGRID's bidding portal (etender.powergrid.in) is an SAP Enterprise Portal
 * behind login — but its PUBLIC "Published Tenders" index is a plain, server-
 * rendered ASP.NET page at apps.powergrid.in/pgciltenders/u/view-published-
 * tender.aspx, with NO login and NO client-side rendering. So a plain HTTP GET +
 * cheerio is enough (no headless browser). We read the `?dt=onemonth` window
 * (tenders published in the last month) to keep the page small and current; the
 * unfiltered page carries years of history (~20 MB).
 *
 * Table columns (verified 2026-11-21):
 *   # | Tender Location | Tender Ref No / Tender Title | Doc Collection Upto /
 *   Tender Opening at | Published At | Tender Details (View link) | Corrigendum
 * The stable per-tender id is the `tid` GUID in the View link. Estimated value /
 * EMD / fee are not on the public index, so they stay NULL ("Not Disclosed").
 *
 * parsePowergridListing is pure and exported for fixture-based tests.
 */
import * as cheerio from 'cheerio';
import { config } from '../../../../config.js';
import { log } from '../../../../log.js';
import { cleanText } from '../../normalize.js';
import { SourceError } from '../../tenderbook.js';
import { fetchHtml } from '../cppp/http.js';

const LIST_PATH = '/pgciltenders/u/view-published-tender.aspx';
const DETAIL_BASE = '/pgciltenders/u/';
const DEPARTMENT = 'Power Grid Corporation of India (POWERGRID)';

/**
 * Parse the POWERGRID published-tenders HTML into dtos for normalizeCpppTender. Pure.
 * @param {string} html
 * @param {{baseUrl?:string,state?:string|null}} [opts]
 * @returns {object[]}
 */
export function parsePowergridListing(html, { baseUrl = 'https://apps.powergrid.in', state = null } = {}) {
  const root = String(baseUrl).replace(/\/$/, '');
  const $ = cheerio.load(html || '');
  const byId = new Map();
  $('table tbody tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 6) return; // layout / header rows

    const location = cleanText($(tds[1]).text());

    // Ref/title cell: <i>REF-NO</i> / <br> Title text [Spec.no: ...]
    const refTitleCell = $(tds[2]);
    const refNo = cleanText(refTitleCell.find('i').first().text());
    const fullText = cleanText(refTitleCell.text());
    let title = fullText;
    if (refNo && fullText) {
      const idx = fullText.indexOf(refNo);
      if (idx >= 0) title = cleanText(fullText.slice(idx + refNo.length).replace(/^\s*\/\s*/, '')) || fullText;
    }

    // Date cell: "Fri, 11-Dec-2026 04:00 PM / Sat, 12-Dec-2026 04:00 PM"
    // (closing / opening). toCpppDate reads "DD-Mon-YYYY hh:mm AM/PM".
    const [closingText, openingText] = cleanText($(tds[3]).text()).split('/');
    const publishedText = cleanText($(tds[4]).text());

    const href = cleanText($(tds[5]).find('a').attr('href'));
    const tid = href ? (href.match(/tid=([0-9a-f-]+)/i) || [])[1] : null;
    const tenderId = tid || refNo;
    if (!tenderId || byId.has(tenderId)) return;

    byId.set(tenderId, {
      tenderId,
      refNo: refNo || tenderId,
      title,
      workDescription: title,
      organisationChain: DEPARTMENT,
      location,
      closingDate: cleanText(closingText),
      openingDate: cleanText(openingText),
      publishedDate: publishedText,
      detailUrl: href ? `${root}${DETAIL_BASE}${href.replace(/^\.?\//, '')}` : null,
      state,
    });
  });
  return [...byId.values()];
}

/**
 * Build the POWERGRID client. Same interface as the other crawlers:
 * tenders({ page }) -> { content, totalElements, totalPages, page }.
 */
export function createPowergridClient(opts = {}) {
  const {
    baseUrl = 'https://apps.powergrid.in',
    state = null,
    dt = 'onemonth', // published window: threedays | sevendays | twoweeks | onemonth
    fetchImpl = globalThis.fetch,
    userAgent = config.crawler?.userAgent,
    timeoutMs = config.crawler?.timeoutMs ?? 30_000,
  } = opts;
  const root = baseUrl.replace(/\/$/, '');

  async function tenders({ page = 0 } = {}) {
    // The window page is a single server-rendered table; nothing to paginate.
    if (page > 0) return { content: [], totalElements: 0, totalPages: 1, page };
    const url = `${root}${LIST_PATH}?dt=${encodeURIComponent(dt)}`;
    const html = await fetchHtml(url, { fetchImpl, userAgent, timeoutMs });
    const content = parsePowergridListing(html, { baseUrl: root, state });
    if (!content.length) {
      throw new SourceError('POWERGRID published-tender listing returned no parseable rows (portal layout may have changed).');
    }
    log.info('powergrid crawl complete', { baseUrl: root, rows: content.length });
    return { content, totalElements: content.length, totalPages: 1, page: 0 };
  }

  return { tenders };
}
