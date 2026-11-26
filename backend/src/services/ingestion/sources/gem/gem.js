/**
 * Crawler client for GeM — the Government e-Marketplace bid listing at
 * bidplus.gem.gov.in/all-bids.
 *
 * How the public page works (verified live 2026-11-26): the "All Bids" page is a
 * plain server-rendered CodeIgniter page that hands every visitor a session
 * cookie and a CSRF token, then loads bids with a jQuery POST to /all-bids-data
 * (form fields `payload` = JSON {page, param, filter} and `csrf_bd_gem_nk`). The
 * reply is Solr JSON — {code, response: {response: {numFound, start, docs}}}, 10
 * bids per page, every field an array. This client makes exactly that request,
 * as a visitor's browser does: no login, no captcha, no hidden API, under our own
 * honest crawler User-Agent. robots.txt allows the listing (it disallows only
 * /resources/ and a few bank-guarantee endpoints) and this client fetches neither.
 *
 * Response modes:
 *   HTTP 200 + code 200 ........ a page of bids (docs may be [] past the end)
 *   HTTP 404 + code 404 ........ "No data found" — an empty result, not an error
 *   HTTP 403 + HTML error page .. expired/invalid CSRF — reopen the session, retry
 *
 * Crawl strategy — a resumable sweep by closing day. There are ~44k live bids and
 * no server-side "bids only" or "newest" ordering that survives Reverse-Auction
 * noise, so each run walks the live bids one closing day (IST) at a time, sorted
 * oldest-start first within the day (new bids append at the end, so pagination
 * never skips an existing bid), for a bounded number of requests, and reports a
 * {day, page} cursor that the next run resumes from. When the sweep passes the
 * last closing day it starts again at today. Every live bid — new, unchanged, or
 * with an extended deadline (GeM auto-extends bids that draw too few offers) — is
 * therefore re-read once per cycle. Empty stretches are skipped with one range
 * query ("first bid closing on or after day X"), so a far-future rate contract
 * costs nothing extra.
 *
 * Reverse Auctions (bid type 2, "GEM/…/R/…") are dropped: an RA is restricted to
 * the sellers who qualified on its parent bid, so it is not a new opportunity
 * and would duplicate the parent. Direct RAs (type 5) are open to all sellers and
 * are kept.
 *
 * mapGemDoc / parseGemResponse are pure and exported for fixture tests.
 */
import { config } from '../../../../config.js';
import { log } from '../../../../log.js';
import { cleanText } from '../../normalize.js';
import { SourceError } from '../../tenderbook.js';

export const GEM_BASE_URL = 'https://bidplus.gem.gov.in';
export const GEM_PAGE_SIZE = 10; // fixed by GeM
const LIST_PATH = '/all-bids';
const DATA_PATH = '/all-bids-data';
// GeM's CSRF cookie lives 20 minutes; reopen the session well before that.
const SESSION_MAX_AGE_MS = 15 * 60_000;
const CSRF_RE = /csrf_bd_gem_nk['"]\s*[:,]\s*['"]([A-Za-z0-9]+)['"]/;
const FAR_DAY = '2099-12-31';
const BID_TYPES = { 1: 'bid', 2: 'ra', 5: 'direct_ra' };
const DOC_PATHS = { bid: 'showbidDocument', ra: 'showradocumentPdf', direct_ra: 'showdirectradocumentPdf' };
const RETRY_WAITS_MS = [5_000, 15_000];

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const first = (v) => (Array.isArray(v) ? v[0] : v);
const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';
const number = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
// GeM omits the ministry for state buyers; tolerate stringly "undefined"/"null" too.
const name = (v) => {
  const s = cleanText(first(v));
  return s && !/^(undefined|null|na|n\/a|-)$/i.test(s) ? s : null;
};

/** India-time calendar day ("YYYY-MM-DD") for an epoch-ms instant. */
export const istDay = (ms) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
/** Calendar arithmetic on "YYYY-MM-DD" strings. */
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The closing day of a GeM bid (its timestamps carry IST digits; see normalize.js). */
const closingDay = (doc) => (cleanText(first(doc?.final_end_date_sort)) ?? '').slice(0, 10) || null;
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Reshape one Solr doc from /all-bids-data into a flat bid for normalizeGemTender.
 * Pure.
 */
export function mapGemDoc(doc, { baseUrl = GEM_BASE_URL } = {}) {
  const root = String(baseUrl).replace(/\/$/, '');
  const bidId = first(doc?.b_id) ?? doc?.id ?? null;
  const bidType = BID_TYPES[Number(first(doc?.b_bid_type))] ?? 'other';
  const kind = Number(first(doc?.b_type)); // 0 = product, 1 = service (GeM's own filter split)
  return {
    bidId: bidId === null ? null : String(bidId),
    bidNumber: cleanText(first(doc?.b_bid_number)),
    bidType,
    parentBidNumber: cleanText(first(doc?.b_bid_number_parent)),
    // b_category_name is cut at ~100 characters; bd_category_name is the full list.
    items: cleanText(first(doc?.bd_category_name)) ?? cleanText(first(doc?.b_category_name)),
    quantity: number(first(doc?.b_total_quantity)),
    ministry: name(doc?.ba_official_details_minName),
    department: name(doc?.ba_official_details_deptName),
    startDate: cleanText(first(doc?.final_start_date_sort)),
    endDate: cleanText(first(doc?.final_end_date_sort)),
    procurement: kind === 0 ? 'Goods' : kind === 1 ? 'Services' : null,
    highValue: truthy(first(doc?.is_high_value)),
    rateContract: truthy(first(doc?.is_rc_bid)),
    globalTender: truthy(first(doc?.ba_is_global_tendering)),
    limitedTender: truthy(first(doc?.ba_is_limited_tendering)),
    singlePacket: truthy(first(doc?.ba_is_single_packet)),
    documentUrl: bidId === null ? null : `${root}/${DOC_PATHS[bidType] ?? DOC_PATHS.bid}/${bidId}`,
  };
}

/**
 * Read a /all-bids-data reply. Pure.
 * @param {string|object} body
 * @param {number} [httpStatus]
 * @returns {{ total: number, start: number, docs: object[] }}
 */
export function parseGemResponse(body, httpStatus = 200) {
  let data = body;
  if (typeof body === 'string') {
    try { data = JSON.parse(body); } catch { data = null; }
  }
  if (data && Number(data.code) === 404) return { total: 0, start: 0, docs: [] }; // "No data found"
  const inner = data?.response?.response;
  if (data && Number(data.code) === 200 && inner && Array.isArray(inner.docs)) {
    return { total: Number(inner.numFound) || 0, start: Number(inner.start) || 0, docs: inner.docs };
  }
  if (httpStatus === 403) throw new SourceError('GeM refused the request (HTTP 403): the session token expired.', { status: 403, retryable: true });
  if (httpStatus === 429 || httpStatus >= 500) throw new SourceError(`GeM is busy or unavailable (HTTP ${httpStatus}).`, { status: httpStatus, retryable: true });
  throw new SourceError(
    data ? `GeM returned an unexpected reply (code ${data.code ?? 'none'}).` : `GeM returned a non-JSON reply (HTTP ${httpStatus}); the page layout may have changed.`,
    { status: httpStatus, retryable: true }
  );
}

function setCookieHeaders(headers) {
  if (typeof headers?.getSetCookie === 'function') return headers.getSetCookie();
  const raw = headers?.get?.('set-cookie');
  return raw ? raw.split(/,(?=\s*[A-Za-z0-9_.-]+=)/) : [];
}

/**
 * A GeM visitor session: cookies + CSRF token from the All Bids page, reopened
 * when it ages out or GeM rejects it.
 */
export function createGemSession({ baseUrl = GEM_BASE_URL, userAgent, timeoutMs = 30_000, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const root = String(baseUrl).replace(/\/$/, '');
  const jar = new Map();
  let csrf = null;
  let openedAt = 0;
  let opens = 0;

  const keepCookies = (res) => {
    for (const line of setCookieHeaders(res.headers)) {
      const pair = String(line).split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  };
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

  async function open() {
    jar.clear();
    csrf = null;
    opens++;
    let res;
    try {
      res = await fetchImpl(`${root}${LIST_PATH}`, {
        headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new SourceError(`Could not reach GeM: ${err.message}`, { retryable: true });
    }
    keepCookies(res);
    const html = await res.text();
    const token = html.match(CSRF_RE)?.[1];
    if (!res.ok || !token) {
      throw new SourceError(`GeM's bid listing did not hand out a session (HTTP ${res.status}); the page may have changed.`, { status: res.status, retryable: res.status === 429 || res.status >= 500 });
    }
    csrf = token;
    openedAt = now();
  }

  /** POST one listing query; returns parseGemResponse()'s result. */
  async function query(payload) {
    if (!csrf || now() - openedAt > SESSION_MAX_AGE_MS) await open();
    let res;
    try {
      res = await fetchImpl(`${root}${DATA_PATH}`, {
        method: 'POST',
        headers: {
          'User-Agent': userAgent,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/javascript, */*; q=0.01',
          Origin: root,
          Referer: `${root}${LIST_PATH}`,
          Cookie: cookieHeader(),
        },
        body: new URLSearchParams({ payload: JSON.stringify(payload), csrf_bd_gem_nk: csrf }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new SourceError(`GeM request failed: ${err.message}`, { retryable: true });
    }
    keepCookies(res);
    const result = parseGemResponse(await res.text(), res.status);
    return result;
  }

  return {
    query,
    /** Drop the token so the next query opens a fresh session. */
    reset() { csrf = null; },
    get opens() { return opens; },
  };
}

/** The listing request the page itself sends, for one closing-day window. */
function listingPayload({ page, from, to, sort }) {
  return {
    page,
    param: { searchBid: '', searchType: 'fullText' },
    filter: {
      bidStatusType: 'ongoing_bids',
      byType: 'all',
      highBidValue: '',
      // Both ends are required: GeM ignores a range with an empty "to".
      byEndDate: { from, to },
      sort,
    },
  };
}

/**
 * Build the GeM client. Same interface as the other crawlers —
 * tenders({ page, size }) -> { content, totalElements, totalPages, page } — plus
 * report(), whose `cursor` the next run passes back in to resume the sweep.
 *
 * @param {object} [opts]
 * @param {number} [opts.maxPages] listing requests per run (10 bids each)
 * @param {{day:string,page:number}|null} [opts.cursor] where the last run stopped
 * @param {number} [opts.maxRunMs] stop the sweep after this long (stays clear of
 *   the ingestion runner's 30-minute stale-run guard)
 */
export function createGemClient(opts = {}) {
  const {
    baseUrl = GEM_BASE_URL,
    userAgent = config.crawler?.userAgent,
    timeoutMs = config.crawler?.timeoutMs ?? 30_000,
    requestDelayMs = 1000,
    maxPages = 300,
    maxRunMs = 20 * 60_000,
    cursor = null,
    includeReverseAuctions = false,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    sleep = defaultSleep,
  } = opts;
  const root = String(baseUrl).replace(/\/$/, '');
  const session = createGemSession({ baseUrl: root, userAgent, timeoutMs, fetchImpl, now });
  const startedAt = now();

  const stats = {
    requests: 0, bidsSeen: 0, kept: 0, skippedReverseAuctions: 0,
    daysVisited: 0, total: null, cycleComplete: false, stoppedBy: null,
  };
  let today = null;
  let position = null; // { day, page } still to fetch
  let started = false;
  let done = false;
  let pendingError = null;
  let lastRequestAt = 0;
  const buffer = [];

  // One paced listing request, retried (with a fresh session) on GeM refusing or
  // being briefly unavailable. A failure that persists is thrown to the runner.
  async function request(payload) {
    let lastErr = null;
    for (let attempt = 0; attempt <= RETRY_WAITS_MS.length; attempt++) {
      const wait = attempt ? RETRY_WAITS_MS[attempt - 1] : Math.max(0, lastRequestAt + requestDelayMs - now());
      if (lastRequestAt && wait) await sleep(wait);
      lastRequestAt = now();
      stats.requests++;
      try {
        return await session.query(payload);
      } catch (err) {
        lastErr = err;
        if (!(err instanceof SourceError) || !err.retryable) throw err;
        log.warn('gem request retry', { attempt, status: err.status, error: err.message });
        session.reset();
      }
    }
    throw lastErr;
  }

  /** The first closing day on or after `fromDay` that has any live bid, or null. */
  async function seek(fromDay) {
    const res = await request(listingPayload({ page: 1, from: fromDay, to: FAR_DAY, sort: 'Bid-End-Date-Oldest' }));
    if (fromDay === today) stats.total = res.total;
    const day = closingDay(res.docs[0]);
    if (!isDay(day)) return null; // nothing closes on or after fromDay
    // Never step backwards (a boundary quirk would otherwise end the cycle early).
    return day < fromDay ? fromDay : day;
  }

  async function begin() {
    started = true;
    today = istDay(now());
    const firstDay = await seek(today);
    const resume = cursor && isDay(cursor.day) && cursor.day >= today ? cursor : null;
    if (resume) {
      position = { day: resume.day, page: Math.max(1, Number(resume.page) | 0) };
    } else if (firstDay) {
      position = { day: firstDay, page: 1 };
    } else {
      // GeM lists no live bids at all; the next run starts over.
      position = { day: today, page: 1 };
      stats.cycleComplete = true;
      done = true;
    }
  }

  // Fetch the page at `position`, keep its bids, and move the position on.
  async function step() {
    const { day, page } = position;
    const res = await request(listingPayload({ page, from: day, to: day, sort: 'Bid-Start-Date-Oldest' }));
    if (page === 1) stats.daysVisited++;
    for (const doc of res.docs) {
      stats.bidsSeen++;
      const bid = mapGemDoc(doc, { baseUrl: root });
      if (bid.bidType === 'ra' && !includeReverseAuctions) { stats.skippedReverseAuctions++; continue; }
      buffer.push(bid);
      stats.kept++;
    }
    const dayFinished = res.docs.length < GEM_PAGE_SIZE || page * GEM_PAGE_SIZE >= res.total;
    if (!dayFinished) { position = { day, page: page + 1 }; return; }
    const next = await seek(addDays(day, 1));
    if (next) { position = { day: next, page: 1 }; return; }
    // Past the last closing day: the cycle is complete; the next run starts at today.
    position = { day: today, page: 1 };
    stats.cycleComplete = true;
    done = true;
  }

  function outOfBudget() {
    if (stats.requests >= maxPages) { stats.stoppedBy = 'page budget'; return true; }
    if (now() - startedAt >= maxRunMs) { stats.stoppedBy = 'time budget'; return true; }
    return false;
  }

  async function tenders({ page = 0, size = 100 } = {}) {
    if (pendingError) { const err = pendingError; pendingError = null; throw err; }
    try {
      if (!started) await begin();
      while (buffer.length < size && !done) {
        if (outOfBudget()) { done = true; break; }
        await step();
      }
    } catch (err) {
      // Hand over what was already read so it is stored, then fail on the next call.
      if (!buffer.length) throw err;
      pendingError = err;
      done = true;
    }
    const content = buffer.splice(0, size);
    if (done && !buffer.length && !pendingError) {
      log.info('gem crawl pass', { ...stats, cursor: position });
    }
    // totalPages 0: the runner pages on until a short batch (the end of this run's sweep).
    return { content, totalElements: stats.total ?? 0, totalPages: 0, page };
  }

  /** Progress of this run; `cursor` is where the next run should resume. */
  function report() {
    return { ...stats, cycleComplete: stats.cycleComplete, sessions: session.opens, cursor: position ?? cursor ?? null };
  }

  return { tenders, report };
}
