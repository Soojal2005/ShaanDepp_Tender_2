/**
 * Crawler client for ISRO / Department of Space eProcurement (eproc.isro.gov.in).
 *
 * ISRO is NOT GePNIC: it runs its own portal (v5.x). Its public homepage renders
 * ALL current tenders in one server-side HTML table — no login, no pagination,
 * and the vendor-login captcha does not gate the listing — so a plain HTTP GET
 * plus cheerio is enough (no headless browser needed). Each row is reshaped into
 * the dto shape the shared normalizer (normalizeCpppTender) already understands,
 * so ISRO tenders flow through the identical normalize -> upsert pipeline.
 *
 * Table columns (verified 2026-11-21):
 *   Tender No | Centre Name | Tender Description | Bid Closing Date (IST) |
 *   Bid Opening Date (IST) | Actions
 * Estimated value / EMD / fee are not published on ISRO's public pages, so they
 * stay NULL ("Not Disclosed") per the honesty rule — never defaulted.
 *
 * parseIsroListing is pure and exported for fixture-based tests.
 */
import * as cheerio from 'cheerio';
import { config } from '../../../../config.js';
import { log } from '../../../../log.js';
import { cleanText } from '../../normalize.js';
import { SourceError } from '../../tenderbook.js';
import { fetchHtml } from '../cppp/http.js';

const DETAIL_PATH = '/homeTenderView?tenderId=';
// A plausible ISRO tender id: a short centre prefix then a long number, e.g.
// "LE202600064601", "IS202600091001". Guards against header/layout <tr> rows.
const TENDER_ID = /^[A-Za-z]{1,5}\d{6,}$/;

/**
 * Parse the ISRO homepage HTML into dtos for normalizeCpppTender. Pure.
 * @param {string} html
 * @param {{baseUrl?:string,state?:string|null}} [opts]
 * @returns {object[]}
 */
export function parseIsroListing(html, { baseUrl = 'https://eproc.isro.gov.in', state = null } = {}) {
  const root = String(baseUrl).replace(/\/$/, '');
  const $ = cheerio.load(html || '');
  const byId = new Map();
  $('table tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 5) return; // header row (<th>) or layout row
    const tenderId = cleanText($(tds[0]).text());
    if (!tenderId || !TENDER_ID.test(tenderId) || byId.has(tenderId)) return;
    const centre = cleanText($(tds[1]).text());
    const title = cleanText($(tds[2]).text());
    byId.set(tenderId, {
      tenderId,
      refNo: tenderId,
      title,
      workDescription: title,
      organisationChain: centre ? `ISRO - ${centre}` : 'ISRO / Department of Space',
      closingDate: cleanText($(tds[3]).text()),
      openingDate: cleanText($(tds[4]).text()),
      detailUrl: `${root}${DETAIL_PATH}${encodeURIComponent(tenderId)}`,
      state,
    });
  });
  return [...byId.values()];
}

/**
 * Build the ISRO client. Same interface as the other crawlers:
 * tenders({ page }) -> { content, totalElements, totalPages, page }.
 */
export function createIsroClient(opts = {}) {
  const {
    baseUrl = 'https://eproc.isro.gov.in',
    state = null,
    fetchImpl = globalThis.fetch,
    userAgent = config.crawler?.userAgent,
    timeoutMs = config.crawler?.timeoutMs ?? 30_000,
  } = opts;
  const root = baseUrl.replace(/\/$/, '');

  async function tenders({ page = 0 } = {}) {
    // The whole public listing is one page; nothing to paginate.
    if (page > 0) return { content: [], totalElements: 0, totalPages: 1, page };
    const html = await fetchHtml(`${root}/`, { fetchImpl, userAgent, timeoutMs });
    const content = parseIsroListing(html, { baseUrl: root, state });
    if (!content.length) {
      throw new SourceError('ISRO eProc returned no parseable tenders (portal layout may have changed).');
    }
    log.info('isro crawl complete', { baseUrl: root, rows: content.length });
    return { content, totalElements: content.length, totalPages: 1, page: 0 };
  }

  return { tenders };
}
