import assert from 'node:assert/strict';
import { test } from 'node:test';
import PDFDocument from 'pdfkit';
import { extractPdfText } from '../src/services/enrichment/pdfText.js';
import { extractTenderFields } from '../src/services/enrichment/fields.js';

function makePdf(lines) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(12);
    for (const l of lines) doc.text(l);
    doc.end();
  });
}

test('extracts text layer and money fields end-to-end from a generated PDF', async () => {
  const buf = await makePdf([
    'NOTICE INVITING e-TENDER',
    'Name of Work: Construction of RCC drain',
    'Estimated Cost of Work : Rs. 1,50,00,000/-',
    'Earnest Money Deposit (EMD) : Rs. 3,00,000/-',
    'Cost of Tender Document : Rs. 5,000/-',
  ]);
  const { text, hasText } = await extractPdfText(buf);
  assert.equal(hasText, true);
  const f = extractTenderFields(text);
  assert.equal(f.estimatedValue.rupees, 15000000);
  assert.equal(f.emdAmount.rupees, 300000);
  assert.equal(f.tenderFee.rupees, 5000);
});
