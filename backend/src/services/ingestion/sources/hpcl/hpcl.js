/**
 * Crawler client for HPCL (Hindustan Petroleum Corporation Limited).
 *
 * HPCL's eProcurement portal (etender.hpcl.co.in) shows a login page, but that
 * page also carries a PUBLIC "Public Tenders" table that is fully server-rendered
 * (no login, no JS needed to see it). Each row is:
 *   <td><a onclick="shownit('REF','<full NIT description>','modalak')">REF</a></td>
 *   <td>Tender Title</td><td>Due Date</td>
 * so a plain HTTP GET + cheerio reads it. The onclick's 2nd argument is the full
 * tender description, which we keep as the work description.
 *
 * Estimated value / EMD / fee are not on the public page, so they stay NULL
 * ("Not Disclosed") per the honesty rule. There is no public per-tender URL
 * (the detail is a login-gated modal), so sourceUrl points at the public list.
 *
 * parseHpclListing is pure and exported for fixture-based tests.
 */
import * as cheerio from 'cheerio';
import { config } from '../../../../config.js';
import { log } from '../../../../log.js';
import { cleanText } from '../../normalize.js';
import { SourceError } from '../../tenderbook.js';
import { fetchHtml } from '../cppp/http.js';

const DEPARTMENT = 'Hindustan Petroleum Corporation Limited (HPCL)';

/**
 * Parse the HPCL "Public Tenders" table into dtos for normalizeCpppTender. Pure.
 * @param {string} html
 * @param {{baseUrl?:string,state?:string|null}} [opts]
 * @returns {object[]}
 */
export function parseHpclListing(html, { baseUrl = 'https://etender.hpcl.co.in', state = null } = {}) {
  const root = String(baseUrl).replace(/\/$/, '');
  const $ = cheerio.load(html || '');
  const byId = new Map();
  // Each public tender is an anchor that pops a modal: onclick="shownit('REF',...)".
  $('a[onclick*="shownit"]').each((_, a) => {
    const $a = $(a);
    const tenderId = cleanText($a.text());
    if (!tenderId || !/\d/.test(tenderId) || byId.has(tenderId)) return;
    const tds = $a.closest('tr').children('td');
    const title = cleanText($(tds[1]).text());
    const closingDate = cleanText($(tds[2]).text()); // "21-Nov-2026 15:00"
    // The onclick's 2nd argument is the full NIT description (with literal \r\n).
    const onclick = cleanText($a.attr('onclick')) || '';
    const m = onclick.match(/shownit\('[^']*','([\s\S]*)','[^']*'\)/);
    const longDesc = m ? cleanText(m[1].replace(/\\[rn]/g, ' ')) : null;

    byId.set(tenderId, {
      tenderId,
      refNo: tenderId,
      title,
      workDescription: longDesc || title,
      organisationChain: DEPARTMENT,
      closingDate,
      detailUrl: `${root}/`,
      state,
    });
  });
  return [...byId.values()];
}

/**
 * Build the HPCL client. Same interface as the other crawlers:
 * tenders({ page }) -> { content, totalElements, totalPages, page }.
 */
export function createHpclClient(opts = {}) {
  const {
    baseUrl = 'https://etender.hpcl.co.in',
    state = null,
    fetchImpl = globalThis.fetch,
    userAgent = config.crawler?.userAgent,
    timeoutMs = config.crawler?.timeoutMs ?? 30_000,
  } = opts;
  const root = baseUrl.replace(/\/$/, '');

  async function tenders({ page = 0 } = {}) {
    // The public-tenders table is one server-rendered page; nothing to paginate.
    if (page > 0) return { content: [], totalElements: 0, totalPages: 1, page };
    const html = await fetchHtml(`${root}/`, { fetchImpl, userAgent, timeoutMs });
    const content = parseHpclListing(html, { baseUrl: root, state });
    if (!content.length) {
      throw new SourceError('HPCL public-tenders listing returned no parseable rows (portal layout may have changed).');
    }
    log.info('hpcl crawl complete', { baseUrl: root, rows: content.length });
    return { content, totalElements: content.length, totalPages: 1, page: 0 };
  }

  return { tenders };
}
