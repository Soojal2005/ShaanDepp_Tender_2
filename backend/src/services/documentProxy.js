/**
 * Streams a tender document from the government portal straight to the user.
 *
 * The portal's own URL is never exposed in the browser and nothing is stored on
 * our side: the bytes flow through this process to the client and are gone.
 * Because the URL comes from scraped data, the fetch is guarded against SSRF
 * (only hosts of portals we crawl, never raw IPs), oversized files and non-PDF
 * responses — an expired portal link often returns a login or error page rather
 * than the file.
 */
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { log } from '../log.js';
import { cleanFileName } from './storage.js';
import { GEPNIC_PORTALS } from './ingestion/sources/cppp/portals.js';

export const MAX_PROXY_BYTES = 30 * 1024 * 1024; // 30 MB ceiling per download
const OVERALL_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 4;
const MAX_CONCURRENT = 10; // protect the (small) instance from a burst of downloads
const PDF_MAGIC = Buffer.from('%PDF');

let inFlight = 0;

const badGateway = (message = 'The source document could not be retrieved.') => new HttpError(502, message, { code: 'bad_gateway' });

// Hosts we will fetch from: every portal in the crawl registry. A stored link
// can only legitimately point at one of these, so anything else — another site,
// or a raw IP that could reach something internal — is refused.
const ALLOWED_HOSTS = new Set(GEPNIC_PORTALS.map((p) => new URL(p.baseUrl).hostname.toLowerCase()));
const IP_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$|:/; // IPv4, or any IPv6 (contains ':')

/** Validate a document URL and return it, or throw a 502. Re-checked on every redirect hop. */
export function assertFetchableUrl(raw) {
  let url;
  try { url = new URL(String(raw)); } catch { throw badGateway('The document link is invalid.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw badGateway('The document link is not permitted.');
  if (IP_LITERAL.test(url.hostname)) throw badGateway('The document link is not permitted.');
  const host = url.hostname.toLowerCase();
  const allowed = [...ALLOWED_HOSTS].some((h) => host === h || host.endsWith(`.${h}`));
  if (!allowed) throw badGateway('The document link is not permitted.');
  return url;
}

/** A safe download filename, always ending in .pdf. */
export function pdfFileName(name) {
  const base = cleanFileName(name || 'tender-document');
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

// Follow redirects ourselves so each hop's host is re-validated (fetch's own
// redirect-following would hide an intermediate host from the SSRF check).
async function fetchFollowing(url, signal) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertFetchableUrl(current.toString());
    const res = await fetch(current, {
      signal,
      redirect: 'manual',
      headers: { 'user-agent': config.crawler.userAgent, accept: 'application/pdf,application/octet-stream,*/*' },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw badGateway();
      current = new URL(location, current);
      continue;
    }
    return res;
  }
  throw badGateway('The document link redirected too many times.');
}

// Pull chunks until we have at least `min` bytes (to inspect the file header).
async function readAtLeast(reader, min) {
  const parts = [];
  let len = 0;
  while (len < min) {
    const { done, value } = await reader.read();
    if (done) break;
    const buf = Buffer.from(value);
    parts.push(buf);
    len += buf.length;
  }
  return Buffer.concat(parts);
}

// Yield the already-read header, then the rest, failing if the running total
// passes the size ceiling.
async function* streamBody(head, reader, cap) {
  let total = head.length;
  yield head;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    total += value.length;
    if (total > cap) throw badGateway('The document exceeds the maximum download size.');
    yield Buffer.from(value);
  }
}

/**
 * Fetch `rawUrl` and stream it to the Express response `res` as a PDF
 * attachment. Throws an HttpError (handled by the error middleware) if the URL
 * is not allowed or the source does not return a real PDF; once streaming has
 * started, a later failure just tears the connection down.
 */
export async function proxyDocument(rawUrl, res, { fileName }) {
  const url = assertFetchableUrl(rawUrl);
  if (inFlight >= MAX_CONCURRENT) throw new HttpError(503, 'Too many downloads in progress. Please try again in a moment.', { code: 'busy' });
  inFlight++;
  const controller = new AbortController();
  const onClose = () => controller.abort();
  res.once('close', onClose);
  const timeout = setTimeout(() => controller.abort(), OVERALL_TIMEOUT_MS);
  try {
    const upstream = await fetchFollowing(url, controller.signal);
    if (!upstream.ok || !upstream.body) throw badGateway();
    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html')) throw badGateway('The source returned a web page, not a file — the link may have expired.');
    const declared = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_PROXY_BYTES) throw badGateway('The document exceeds the maximum download size.');

    const reader = upstream.body.getReader();
    const head = await readAtLeast(reader, PDF_MAGIC.length);
    if (!head.length) throw badGateway('The source returned an empty document.');
    if (!head.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) throw badGateway('The source did not return a valid PDF.');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    await pipeline(Readable.from(streamBody(head, reader, MAX_PROXY_BYTES)), res);
  } catch (err) {
    if (res.headersSent) {
      log.warn('document proxy interrupted mid-stream', { error: err.message });
      if (!res.writableEnded) res.destroy();
      return;
    }
    if (err instanceof HttpError) throw err;
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') throw badGateway('The document took too long to download.');
    log.warn('document proxy failed', { error: err.message });
    throw badGateway();
  } finally {
    clearTimeout(timeout);
    res.off('close', onClose);
    inFlight--;
  }
}
