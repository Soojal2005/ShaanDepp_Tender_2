/**
 * Crawler client for the Central Public Procurement Portal (CPPP) ePublishing
 * site (https://eprocure.gov.in). It exposes the same shape the ingestion
 * runner expects from any source:
 *
 *     client.tenders({ page, size, filter }) -> { content, totalElements, totalPages, page }
 *
 * so it drops straight into runIngestion() and reuses all of the existing
 * dedup / change-detection / master-mapping / health machinery.
 *
 * Scope (first slice): the "Latest Active Tenders" listing is treated as a
 * single page of results. Walking the full organisation-by-organisation archive
 * (which needs form post-backs) is a documented follow-up; until then the
 * crawler keeps the freshest active tenders up to date and the vendor feed /
 * Excel upload remain available for everything else.
 *
 * The HTML parsers are pure and exported so they can be unit-tested against
 * saved fixtures without touching the network.
 */
import * as cheerio from 'cheerio';
import { config } from '../../../../config.js';
import { log } from '../../../../log.js';
import { cleanText } from '../../normalize.js';
import { SourceError } from '../../tenderbook.js';
import { fetchHtml } from './http.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const norm = (s) => cleanText(s)?.toLowerCase() ?? '';

/** A detail link worth storing: real, not an ephemeral session/captcha-gated GePNIC link. */
function durableHref(href) {
  const h = cleanText(href);
  return Boolean(h) && !/^javascript:/i.test(h) && !/service=direct|session=|component=%24|DirectLink/i.test(h);
}

/** Resolve a possibly-relative href against the portal base, ignoring javascript: links. */
function absoluteUrl(href, baseUrl) {
  const h = cleanText(href);
  if (!h || /^javascript:/i.test(h) || h === '#') return null;
  try {
    return new URL(h, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  } catch {
    return null;
  }
}

/**
 * Parse a GePNIC tender listing table. Works for both the CPPP/"Active Tenders"
 * table (id="activeTenders") and the "Tenders by Closing Date" table (id="table"),
 * whose title cell carries two bracketed tokens: [reference no][tender id].
 * Columns are matched by header text so a reordered table still works.
 * @param {string} html
 * @param {string} baseUrl
 * @param {{tableSelector?: string}} [opts]
 * @returns {Array<object>} one raw dto per row
 */
export function parseListPage(html, baseUrl = 'https://eprocure.gov.in', { tableSelector } = {}) {
  const $ = cheerio.load(html);
  const chosen = tableSelector ? $(tableSelector).first()
    : ($('#table').first().length ? $('#table').first()
      : ($('#activeTenders').first().length ? $('#activeTenders').first() : $('table:has(th)').first()));
  const table = chosen;
  if (!table.length) return [];

  // Find the header row and build a header-name -> column-index map. GePNIC uses
  // <td> header cells (not <th>), so match the row that names the title column.
  let headerCells = $();
  table.find('tr').each((_, tr) => {
    if (headerCells.length) return;
    const cells = $(tr).find('th, td');
    const texts = cells.map((_, c) => norm($(c).text())).get();
    if (texts.some((t) => t.includes('title and ref') || t.includes('e-published') || t.includes('tender id'))) {
      headerCells = cells;
    }
  });
  const colIndex = {};
  headerCells.each((i, c) => { colIndex[norm($(c).text())] = i; });

  const pick = (cells, ...names) => {
    for (const name of names) {
      const key = Object.keys(colIndex).find((h) => h.includes(name));
      if (key !== undefined && cells.eq(colIndex[key]).length) return cells.eq(colIndex[key]);
    }
    return null;
  };

  const rows = [];
  table.find('tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 2) return; // spacer row

    const titleCell = pick(cells, 'title and ref', 'title') ?? cells.filter((_, td) => $(td).find('a').length).first();
    if (!titleCell || !titleCell.length) return;

    const anchor = titleCell.find('a').first();
    const cellText = cleanText(titleCell.text());
    if (!cellText) return;
    // The title cell may carry one or two bracketed tokens: [ref no][tender id].
    const tokens = [...cellText.matchAll(/\[([^\]]+)\]/g)].map((m) => cleanText(m[1])).filter(Boolean);
    const tenderId = tokens.length ? tokens[tokens.length - 1] : null;
    const refNo = tokens.length >= 2 ? tokens[tokens.length - 2] : null;
    if (!tenderId) return; // header/spacer rows have no bracketed id
    // GePNIC wraps the title in brackets inside the anchor, with [ref][id] after it.
    // Prefer the anchor text (outer brackets stripped); otherwise the first non-id token.
    const anchorText = cleanText(anchor.text());
    let title = anchorText ? cleanText(anchorText.replace(/^\[/, '').replace(/\]$/, '')) : null;
    if (!title || title === tenderId || title === refNo) {
      title = tokens.find((t) => t !== tenderId && t !== refNo) ?? cellText;
    }

    const dateText = (cell) => (cell && cell.length ? cleanText(cell.text()) : null);
    rows.push({
      tenderId,
      refNo,
      title,
      organisationChain: dateText(pick(cells, 'organisation', 'department')),
      publishedDate: dateText(pick(cells, 'e-published', 'published')),
      closingDate: dateText(pick(cells, 'closing', 'submission closing', 'bid submission')),
      openingDate: dateText(pick(cells, 'opening')),
      // Keep only a durable detail link. GePNIC's are session-scoped and
      // captcha-gated (service=direct&session=T&component=$DirectLink), so drop those.
      detailUrl: durableHref(anchor.attr('href')) ? absoluteUrl(anchor.attr('href'), baseUrl) : null,
    });
  });
  return rows;
}

const DETAIL_LABELS = {
  tenderId: ['tender id'],
  refNo: ['tender reference number', 'reference number'],
  organisationChain: ['organisation chain', 'organization chain'],
  tenderType: ['tender type'],
  formOfContract: ['form of contract'],
  category: ['tender category', 'product category'],
  workDescription: ['work description', 'tender title', 'work item title'],
  tenderValue: ['tender value in', 'tender value'],
  emdAmount: ['emd amount in', 'emd amount'],
  tenderFee: ['tender fee in', 'tender fee'],
  publishedDate: ['published date', 'e-published date'],
  closingDate: ['bid submission end date', 'bid submission closing date', 'closing date'],
  openingDate: ['bid opening date', 'tender opening date'],
  prebidDate: ['pre bid meeting date', 'pre-bid meeting date'],
  location: ['location'],
  pincode: ['pincode', 'pin code'],
  state: ['state name', 'state'],
};

/**
 * Parse a CPPP tender detail page. The portal lays information out as
 * label/value cell pairs; we build a label->value map and read known fields.
 * @returns {object} fields to merge onto the list-level dto
 */
export function parseDetailPage(html, baseUrl = 'https://eprocure.gov.in') {
  const $ = cheerio.load(html);

  // Collect every label/value pair from two- or four-column rows.
  const values = new Map();
  $('tr').each((_, tr) => {
    const cells = $(tr).children('td');
    for (let i = 0; i + 1 < cells.length; i += 2) {
      const label = norm(cells.eq(i).text());
      const value = cleanText(cells.eq(i + 1).text());
      if (label && value && !values.has(label)) values.set(label, value);
    }
  });

  const read = (names) => {
    for (const name of names) {
      const key = [...values.keys()].find((k) => k.includes(name));
      if (key) return values.get(key);
    }
    return null;
  };

  const out = {};
  for (const [field, names] of Object.entries(DETAIL_LABELS)) {
    const v = read(names);
    if (v) out[field] = v;
  }

  // Documents: anchors that point at a portal download.
  const documents = [];
  const seen = new Set();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') ?? '';
    if (!/download|directlink|docdownload|resources/i.test(href)) return;
    const url = absoluteUrl(href, baseUrl);
    const name = cleanText($(a).text());
    if (!url || seen.has(url)) return;
    seen.add(url);
    documents.push({ name: name || 'Tender document', url });
  });
  if (documents.length) out.documents = documents;

  return out;
}

/**
 * Build a CPPP crawler client.
 * @param {object} [opts]
 * @param {string} [opts.baseUrl]
 * @param {string} [opts.listPath]  path to the active-tenders listing
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {boolean} [opts.withDetails]  fetch each tender's detail page (default true)
 * @param {number} [opts.requestDelayMs] pause between detail requests (politeness)
 * @param {number} [opts.maxDetails]  safety cap on detail fetches per run
 */
export function createCpppClient(opts = {}) {
  const c = config.crawler?.cppp ?? {};
  const {
    baseUrl = c.baseUrl ?? 'https://eprocure.gov.in',
    listPath = c.listPath ?? '/epublish/app?page=FrontEndLatestActiveTenders&service=page',
    fetchImpl = globalThis.fetch,
    userAgent = config.crawler?.userAgent,
    timeoutMs = config.crawler?.timeoutMs ?? 30_000,
    retries = 2,
    withDetails = true,
    requestDelayMs = config.crawler?.requestDelayMs ?? 1_500,
    maxDetails = config.crawler?.maxDetails ?? 60,
  } = opts;

  const getHtml = (url) => fetchHtml(url, { fetchImpl, userAgent, timeoutMs, retries });

  async function tenders({ page = 0 } = {}) {
    // The "Latest Active Tenders" listing is a single page in this slice.
    if (page > 0) return { content: [], totalElements: 0, totalPages: 1, page };

    const listUrl = absoluteUrl(listPath, baseUrl) ?? `${baseUrl}${listPath}`;
    const html = await getHtml(listUrl);
    const rows = parseListPage(html, baseUrl);
    if (!rows.length && !/activeTenders/i.test(html)) {
      // Neither rows nor the expected table marker: the page we got is not what we parse.
      throw new SourceError('CPPP listing page did not contain the active-tenders table. The portal layout may have changed.');
    }

    if (withDetails) {
      let fetched = 0;
      for (const row of rows) {
        if (!row.detailUrl || fetched >= maxDetails) continue;
        if (requestDelayMs) await sleep(requestDelayMs);
        try {
          const detailHtml = await getHtml(row.detailUrl);
          Object.assign(row, { ...parseDetailPage(detailHtml, baseUrl), ...stripEmpty(row) });
          fetched++;
        } catch (err) {
          // Keep the list-level fields; one bad detail page must not sink the run.
          log.warn('cppp detail fetch failed', { url: row.detailUrl, error: err.message });
        }
      }
    }

    return { content: rows, totalElements: rows.length, totalPages: 1, page: 0 };
  }

  return { tenders };
}

/** List-level values win over detail-level ones when both are present. */
function stripEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== null && v !== undefined && v !== '') out[k] = v;
  return out;
}
