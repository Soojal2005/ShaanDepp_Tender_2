/**
 * Extract the text layer from a PDF buffer with pdfjs (pure JS, no native deps).
 *
 * Only the first few pages are read — an NIT states its estimated cost, EMD and
 * fee up front, and reading a 200-page BOQ would be wasteful. A PDF that yields
 * almost no text is a scanned image: we report `hasText: false` so the caller
 * can send it to the review queue (or, later, to OCR) instead of guessing.
 */

// pdfjs is heavy; load it lazily so importing this module (e.g. in a test that
// injects a fake extractor) doesn't pull in the whole library.
let _pdfjs = null;
async function lib() {
  if (!_pdfjs) _pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return _pdfjs;
}

const MIN_TEXT_CHARS = 30;

/**
 * @param {Buffer|Uint8Array|ArrayBuffer} buffer raw PDF bytes
 * @param {{ maxPages?: number }} [opts]
 * @returns {Promise<{ text: string, pages: number, totalPages: number, hasText: boolean }>}
 */
export async function extractPdfText(buffer, { maxPages = 15 } = {}) {
  const pdfjs = await lib();
  // pdfjs rejects a Node Buffer (even though it is a Uint8Array subclass), so
  // always hand it a plain Uint8Array.
  const data = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : Uint8Array.from(buffer);
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise;
  const totalPages = doc.numPages;
  const pages = Math.min(totalPages, maxPages);
  let text = '';
  try {
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it) => (typeof it.str === 'string' ? it.str : '')).join(' ') + '\n';
      page.cleanup?.();
    }
  } finally {
    await doc.destroy?.();
  }
  const clean = text.replace(/[ \t]+/g, ' ').trim();
  return { text: clean, pages, totalPages, hasText: clean.replace(/\s/g, '').length >= MIN_TEXT_CHARS };
}
