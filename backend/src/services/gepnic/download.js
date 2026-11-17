/**
 * On-demand GePNIC document download.
 *
 * GePNIC has no durable per-tender URL and its document links are session-bound,
 * so to serve a PDF we re-walk the live "closing-date" listing in a warm browser
 * session, open the tender's detail page, click the document and capture the
 * download — then stream it to the user. Nothing is stored permanently; the file
 * lands in a temp path that the caller streams and then deletes.
 *
 * Only tenders still present in the live closing-window listing can be served;
 * anything that has aged out raises DocumentUnavailableError so the caller can
 * tell the user to use the source portal.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../../config.js';
import { log } from '../../log.js';
import { pdfFileName } from '../documentProxy.js';
import { portalById } from '../ingestion/sources/cppp/portals.js';
import { SessionError } from './sessionManager.js';

const PDF_MAGIC = Buffer.from('%PDF');
const DOC_HREF = 'a[href*="DirectLink" i], a[href*="download" i], a[href*="docdownload" i], a[href*="resources" i]';

/** The tender or its document could not be reached (e.g. it aged out of the listing). */
export class DocumentUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DocumentUnavailableError';
  }
}

/** Build the listing/navigation options for a provider from the portal registry + crawler config. */
export function workerPortal(providerId) {
  const p = portalById(providerId);
  if (!p || p.adapter) return null;
  const c = config.crawler?.cppp ?? {};
  return {
    id: p.id,
    baseUrl: p.baseUrl,
    startPath: p.appPath,
    listPath: `${p.appPath}${(c.listPath ?? '/eprocure/app?page=FrontEndListTendersbyDate&service=page').replace(/^[^?]*/, '')}`,
    tableSelector: c.tableSelector ?? '#table',
    closingWindowLink: c.closingWindowLink ?? 'Closing within 14 days',
  };
}

async function openListing(page, portal, timeoutMs) {
  const url = new URL(portal.listPath, portal.baseUrl).toString();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
  await page.waitForTimeout(1500);
  // Widen from "Closing Today" to the 14-day window if that link is present.
  const windowLink = page.getByRole('link', { name: new RegExp(portal.closingWindowLink, 'i') }).first();
  if (await windowLink.count().catch(() => 0)) {
    await windowLink.click({ timeout: timeoutMs }).catch(() => {});
  }
  await page.waitForSelector(`${portal.tableSelector} tr`, { timeout: timeoutMs }).catch(() => {});
}

/** Click the next listing page; returns false when there is no next page. */
async function gotoNextListingPage(page, nextNumber, timeoutMs) {
  const href = await page.$$eval('a', (as, n) => {
    const numbered = as.find((x) => new RegExp(`[?&]sp=${n}(?:&|$)`).test(x.href) && /sp=A/i.test(x.href));
    if (numbered) return numbered.href;
    const forward = as.find((x) => /TablePages\.linkFwd/i.test(x.href));
    return forward ? forward.href : null;
  }, nextNumber).catch(() => null);
  if (!href) return false;
  const ok = await page.goto(href, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).then(() => true).catch(() => false);
  if (ok) await page.waitForSelector('#table tr', { timeout: timeoutMs }).catch(() => {});
  return ok;
}

/** Walk the listing until the tender's row is found, then open its detail page. Throws if not found. */
async function openTenderDetail(page, portal, tenderSourceId, { timeoutMs, maxPages }) {
  for (let p = 1; p <= maxPages; p++) {
    const rowLink = page.locator(`${portal.tableSelector} tr`, { hasText: `[${tenderSourceId}]` }).locator('a').first();
    if (await rowLink.count().catch(() => 0)) {
      await rowLink.click({ timeout: timeoutMs });
      await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => {});
      await page.waitForTimeout(800);
      return true;
    }
    if (p < maxPages && !(await gotoNextListingPage(page, p + 1, timeoutMs))) break;
  }
  throw new DocumentUnavailableError('Tender is no longer in the live listing (it may have closed).');
}

/** Find the anchor for the requested document on the detail page. */
function documentLocator(page, docName) {
  const links = page.locator(DOC_HREF);
  if (docName) {
    const byName = links.filter({ hasText: docName.replace(/\.pdf$/i, '').trim().slice(0, 40) });
    return { byName, any: links };
  }
  return { byName: null, any: links };
}

async function saveTempFromDownload(download, filename) {
  const tempPath = path.join(os.tmpdir(), `gepnic-${randomUUID()}.pdf`);
  await download.saveAs(tempPath);
  return { tempPath, filename };
}

// Fallback for portals that open the PDF inline instead of firing a download:
// fetch the link with the context's cookies and write it if it is a real PDF.
async function saveTempFromRequest(context, href, filename) {
  const res = await context.request.get(href, { timeout: 30000 }).catch(() => null);
  if (!res || !res.ok()) throw new DocumentUnavailableError('The document link could not be retrieved.');
  const body = Buffer.from(await res.body());
  if (!body.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    throw new DocumentUnavailableError('The source did not return a PDF (the link may have expired).');
  }
  const tempPath = path.join(os.tmpdir(), `gepnic-${randomUUID()}.pdf`);
  await fs.writeFile(tempPath, body);
  return { tempPath, filename };
}

/**
 * Download one tender document. Returns { tempPath, filename } — the caller
 * streams tempPath to the client and must unlink it afterwards.
 * @throws {DocumentUnavailableError|SessionError}
 */
export async function fetchTenderDocument(manager, { providerId, tenderSourceId, docName }) {
  const portal = workerPortal(providerId);
  if (!portal) throw new DocumentUnavailableError('Not a supported GePNIC portal.');
  const timeoutMs = config.gepnic?.timeoutMs ?? 30000;
  const maxPages = config.gepnic?.locateMaxPages ?? 40;
  const filename = pdfFileName(docName);

  return manager.executeWithPage(portal, async (page, st) => {
    await openListing(page, portal, timeoutMs);
    await openTenderDetail(page, portal, tenderSourceId, { timeoutMs, maxPages });

    const { byName, any } = documentLocator(page, docName);
    let anchor = byName && (await byName.count().catch(() => 0)) ? byName.first() : any.first();
    if (!(await anchor.count().catch(() => 0))) {
      throw new DocumentUnavailableError('No downloadable document was found on the tender page.');
    }

    // Prefer a real browser download event; fall back to fetching the resolved
    // href with the session cookies if the portal renders the PDF inline.
    const href = await anchor.getAttribute('href').catch(() => null);
    const downloadTimeout = Math.min(config.gepnic?.downloadTimeoutMs ?? 60000, timeoutMs);
    const waitDownload = page.waitForEvent('download', { timeout: downloadTimeout }).catch(() => null);
    await anchor.click({ timeout: timeoutMs }).catch(() => {});
    const download = await waitDownload;
    if (download) {
      log.info('gepnic document downloaded', { portal: portal.id, tender: tenderSourceId });
      return saveTempFromDownload(download, filename);
    }
    if (href) {
      const abs = new URL(href, portal.baseUrl).toString();
      log.info('gepnic document via request fallback', { portal: portal.id, tender: tenderSourceId });
      return saveTempFromRequest(st.context, abs, filename);
    }
    throw new DocumentUnavailableError('The document did not download.');
  });
}

/**
 * fetchTenderDocument with one session refresh + retry when the failure looks
 * like an expired/broken session (not a genuine "document unavailable").
 */
export async function fetchTenderDocumentWithRetry(manager, args) {
  const retries = config.gepnic?.retryLimit ?? 1;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchTenderDocument(manager, args);
    } catch (err) {
      lastErr = err;
      if (err instanceof DocumentUnavailableError) throw err; // not a session problem
      if (attempt < retries) {
        const portal = workerPortal(args.providerId);
        if (portal) await manager.refresh(portal).catch(() => {});
        continue;
      }
    }
  }
  throw lastErr instanceof SessionError ? lastErr : new SessionError(lastErr?.message || 'download failed');
}
