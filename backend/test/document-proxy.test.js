/**
 * On-demand document proxy: the tender's PDF is streamed from the government
 * portal through our server, the portal URL is never exposed, and a bad or
 * expired link fails cleanly instead of handing the user a web page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeContext, signIn, insertTender, SYSTEM } from './helpers.js';
import { assertFetchableUrl, pdfFileName } from '../src/services/documentProxy.js';

const ADMIN = 'admin@test.local';
const addDoc = (db, tenderId, url, name = 'NIT Document') =>
  db.withContext(SYSTEM, (q) =>
    q.one('INSERT INTO tender_documents (tender_id, name, url) VALUES ($1, $2, $3) RETURNING id', [tenderId, name, url])
  ).then((r) => r.id);

// Create a corrigendum with one attachment; returns the attachment's id.
const addCorrigendumDoc = (db, tenderId, url, name = 'Corrigendum 1') =>
  db.withContext(SYSTEM, async (q) => {
    const corr = await q.one(
      `INSERT INTO tender_corrigenda (tender_id, corrigendum_number, subject, issue_date) VALUES ($1, 'CORR-1', 'Date extended', now()) RETURNING id`,
      [tenderId]
    );
    const doc = await q.one('INSERT INTO corrigendum_documents (corrigendum_id, name, url) VALUES ($1, $2, $3) RETURNING id', [corr.id, name, url]);
    return doc.id;
  });

// Replace global fetch with a canned response for the duration of one test.
function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => handler(new URL(url));
  return () => { globalThis.fetch = original; };
}

test('assertFetchableUrl allows portal hosts and rejects everything else', () => {
  assert.ok(assertFetchableUrl('https://eprocure.gov.in/eprocure/app?download=1'));
  assert.ok(assertFetchableUrl('https://mptenders.gov.in/nicgep/app?doc=2')); // state portal
  assert.throws(() => assertFetchableUrl('https://evil.example.com/x.pdf'), /not permitted/);
  assert.throws(() => assertFetchableUrl('https://169.254.169.254/latest'), /not permitted/); // SSRF to metadata IP
  assert.throws(() => assertFetchableUrl('file:///etc/passwd'), /not permitted/);
  assert.throws(() => assertFetchableUrl('not a url'), /invalid/);
});

test('pdfFileName cleans the name and forces a .pdf extension', () => {
  assert.equal(pdfFileName('NIT Document'), 'NIT Document.pdf');
  assert.equal(pdfFileName('report.pdf'), 'report.pdf');
  assert.equal(pdfFileName('../../etc/passwd'), 'passwd.pdf');
});

test('streams a portal PDF through our endpoint as an attachment', async () => {
  const ctx = await makeContext();
  const restore = stubFetch(() => new Response(Buffer.from('%PDF-1.4\nfake pdf bytes\n'), { headers: { 'content-type': 'application/pdf' } }));
  try {
    const tenderId = await insertTender(ctx.db);
    const docId = await addDoc(ctx.db, tenderId, 'https://eprocure.gov.in/eprocure/app?download=1');
    const client = await signIn(ctx.app, ADMIN);
    const res = await client.get(`/tenders/${tenderId}/documents/${docId}/file`).buffer();
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.match(res.headers['content-disposition'], /attachment/);
    // The government host must not leak to the client in any header.
    assert.ok(!JSON.stringify(res.headers).includes('eprocure.gov.in'));
  } finally {
    restore();
    await ctx.close();
  }
});

test('rejects a source that returns a web page instead of a PDF', async () => {
  const ctx = await makeContext();
  const restore = stubFetch(() => new Response('<html><body>Session expired</body></html>', { headers: { 'content-type': 'text/html' } }));
  try {
    const tenderId = await insertTender(ctx.db);
    const docId = await addDoc(ctx.db, tenderId, 'https://eprocure.gov.in/eprocure/app?download=1');
    const client = await signIn(ctx.app, ADMIN);
    const res = await client.get(`/tenders/${tenderId}/documents/${docId}/file`);
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'bad_gateway');
  } finally {
    restore();
    await ctx.close();
  }
});

test('refuses a document link pointing off the allowed portals (SSRF)', async () => {
  const ctx = await makeContext();
  let fetched = false;
  const restore = stubFetch(() => { fetched = true; return new Response(Buffer.from('%PDF-1.4')); });
  try {
    const tenderId = await insertTender(ctx.db);
    const docId = await addDoc(ctx.db, tenderId, 'https://evil.example.com/payload.pdf');
    const client = await signIn(ctx.app, ADMIN);
    const res = await client.get(`/tenders/${tenderId}/documents/${docId}/file`);
    assert.equal(res.status, 502);
    assert.equal(fetched, false); // never even attempted the request
  } finally {
    restore();
    await ctx.close();
  }
});

test('streams a corrigendum attachment through our endpoint', async () => {
  const ctx = await makeContext();
  const restore = stubFetch(() => new Response(Buffer.from('%PDF-1.4\ncorrigendum\n'), { headers: { 'content-type': 'application/pdf' } }));
  try {
    const tenderId = await insertTender(ctx.db);
    const docId = await addCorrigendumDoc(ctx.db, tenderId, 'https://eprocure.gov.in/eprocure/app?corr=1');
    const client = await signIn(ctx.app, ADMIN);
    const res = await client.get(`/tenders/${tenderId}/corrigenda/documents/${docId}/file`).buffer();
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.match(res.headers['content-disposition'], /attachment/);
  } finally {
    restore();
    await ctx.close();
  }
});

test('getTender exposes corrigendum documents without their raw URL', async () => {
  const ctx = await makeContext();
  try {
    const tenderId = await insertTender(ctx.db);
    await addCorrigendumDoc(ctx.db, tenderId, 'https://eprocure.gov.in/eprocure/app?corr=1');
    const client = await signIn(ctx.app, ADMIN);
    const res = await client.get(`/tenders/${tenderId}`);
    assert.equal(res.status, 200);
    const corr = res.body.tender.corrigenda[0];
    assert.equal(corr.number, 'CORR-1');
    assert.equal(corr.documents[0].downloadable, true);
    assert.equal(corr.documents[0].url, undefined);
  } finally {
    await ctx.close();
  }
});

test('getTender no longer sends the raw document URL to the client', async () => {
  const ctx = await makeContext();
  try {
    const tenderId = await insertTender(ctx.db);
    await addDoc(ctx.db, tenderId, 'https://eprocure.gov.in/eprocure/app?download=1');
    const client = await signIn(ctx.app, ADMIN);
    const res = await client.get(`/tenders/${tenderId}`);
    assert.equal(res.status, 200);
    const doc = res.body.tender.documents[0];
    assert.equal(doc.downloadable, true);
    assert.equal(doc.url, undefined);
  } finally {
    await ctx.close();
  }
});
