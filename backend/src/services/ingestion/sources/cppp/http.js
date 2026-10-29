/**
 * A small, polite HTML fetcher shared by web-crawler sources.
 *
 *  - Announces an honest User-Agent and a contact URL, so a portal administrator
 *    can see who is crawling and ask us to stop.
 *  - Times each request out and retries transient failures (429 / 5xx / network)
 *    with a short back-off, so one hiccup does not fail a whole run.
 *  - Turns every failure into a SourceError (reusing the ingestion convention),
 *    so the runner classifies the run and alerts operations exactly as it does
 *    for the vendor API.
 *
 * `fetchImpl` is injectable so tests never touch the network.
 */
import { SourceError } from '../../tenderbook.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch a URL and return its body as text.
 * @param {string} url
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {string} [opts.userAgent]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.retries]  extra attempts after the first (default 2)
 * @param {number} [opts.retryDelayMs]
 * @returns {Promise<string>}
 */
export async function fetchHtml(url, {
  fetchImpl = globalThis.fetch,
  userAgent = 'ShanDeepTenderCrawler/1.0 (+https://procure-brain.com; respectful crawler)',
  timeoutMs = 30_000,
  retries = 2,
  retryDelayMs = 1_000,
} = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          'User-Agent': userAgent,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-IN,en;q=0.9,hi;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Network error or timeout: worth another try.
      lastError = new SourceError(
        err?.name === 'TimeoutError' ? 'CPPP request timed out' : 'CPPP could not be reached',
        { retryable: true }
      );
      if (attempt < retries) { await sleep(retryDelayMs * (attempt + 1)); continue; }
      throw lastError;
    }

    if (response.status === 429 || response.status >= 500) {
      lastError = new SourceError(`CPPP is unavailable (HTTP ${response.status})`, { status: response.status, retryable: true });
      if (attempt < retries) { await sleep(retryDelayMs * (attempt + 1)); continue; }
      throw lastError;
    }
    if (!response.ok) {
      throw new SourceError(`CPPP returned HTTP ${response.status}`, { status: response.status });
    }

    try {
      return await response.text();
    } catch {
      throw new SourceError('CPPP returned a response body that could not be read');
    }
  }
  // Unreachable, but keeps the type honest.
  throw lastError ?? new SourceError('CPPP request failed');
}
