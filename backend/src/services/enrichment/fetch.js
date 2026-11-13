/**
 * Download a tender document into memory, with hard caps, so it can be parsed
 * and then discarded. Nothing is written to disk or the database — the whole
 * point of the enrichment pipeline is to read the amounts out of the PDF and
 * keep only those few numbers, not the file.
 */
import crypto from 'node:crypto';

/**
 * @param {string} url document URL (from tender_documents.url)
 * @param {{ maxBytes?: number, timeoutMs?: number, userAgent?: string }} [opts]
 * @returns {Promise<
 *   { ok: true, buffer: Buffer, checksum: string, bytes: number, contentType: string } |
 *   { ok: false, reason: string, status?: number, contentType?: string, error?: string }>}
 */
export async function downloadPdf(url, opts = {}) {
  const { maxBytes = 15 * 1024 * 1024, timeoutMs = 20_000, userAgent = 'ShanDeepTenderCrawler/1.0 (+https://procure-brain.com; respectful crawler)' } = opts;
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, reason: 'bad_url' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': userAgent, accept: 'application/pdf,*/*' },
    });
    if (!res.ok) return { ok: false, reason: 'http_error', status: res.status };

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared && declared > maxBytes) return { ok: false, reason: 'too_large', contentType };

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) return { ok: false, reason: 'too_large', contentType };

    // Accept only real PDFs: trust the %PDF magic bytes over the content-type,
    // since government portals frequently mislabel downloads.
    const isPdf = buffer.subarray(0, 5).toString('latin1') === '%PDF-' || contentType.includes('pdf');
    if (!isPdf) return { ok: false, reason: 'not_pdf', contentType };

    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    return { ok: true, buffer, checksum, bytes: buffer.length, contentType };
  } catch (err) {
    return { ok: false, reason: err.name === 'AbortError' ? 'timeout' : 'fetch_error', error: err.message };
  } finally {
    clearTimeout(timer);
  }
}
