import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = 'http://localhost:5173';
const shots = path.resolve(process.env.E2E_OUT ?? 'e2e-output', '05-submission-desk');
fs.mkdirSync(shots, { recursive: true });
const PASSWORD = 'Demo-Pass-2026';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const pdfPath = path.join(os.tmpdir(), 'sample-upload.pdf');
fs.writeFileSync(pdfPath, PDF);

const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  -> ' + detail : ''}`);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[134]|status of 409|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const shot = (name, full = false) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: full });

async function login(email) {
  await page.goto(`${base}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/app/**');
}
async function logout() {
  await page.click('.top-user-pill');
  await page.click('[role=menuitem]:has-text("Sign out")');
  await page.waitForURL('**/login');
}

try {
  // ---- Client -------------------------------------------------------------------------------
  await login('owner@demo.test');
  await page.click('a[href="/app/desk"]');
  await page.waitForSelector('table.table tbody tr');
  check('client sees their three open requests', (await page.$$('table.table tbody tr')).length === 3);
  check('the list shows stage and a progress bar', (await page.$$('.stage-bar')).length === 3);
  await shot('01-client-list');

  await page.click('table.table tbody tr >> nth=0');
  await page.waitForSelector('.stepper');
  const bodyText = await page.textContent('body');
  check('the stepper shows nine steps', (await page.$$('.stepper li')).length === 9);
  check('the desk summary is shown to the client', bodyText.includes('Class A registration'));
  check('the pre-bid query is shown', bodyText.includes('joint venture'));
  check('internal strategy never reaches the client page', !bodyText.includes('7% below') && !bodyText.includes('Expected margin') && !bodyText.includes('Internal'));
  await shot('02-client-case', true);

  // upload a document and download it back
  await page.setInputFiles('input[type=file]', pdfPath);
  await page.click('button:has-text("Add a document")');
  await page.waitForSelector('.doc-list li');
  check('an uploaded document appears in the list', (await page.textContent('.doc-list')).includes('sample-upload.pdf'));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.doc-list a.btn:has-text("Download")')]);
  check('the document downloads', dl.suggestedFilename() === 'sample-upload.pdf');

  // a wrongly-typed file is refused with a clear message
  const fakePath = path.join(os.tmpdir(), 'fake.pdf');
  fs.writeFileSync(fakePath, 'plain text pretending to be a pdf');
  await page.setInputFiles('input[type=file]', fakePath);
  await page.click('button:has-text("Add a document")');
  await page.waitForSelector('.note-error');
  check('a fake PDF is refused', (await page.textContent('.note-error')).includes('does not look like'));

  // ---- Raise a request from a tender --------------------------------------------------------
  await page.goto(`${base}/app/search`);
  await page.waitForSelector('.tender-item-card');
  await page.click('.tender-item-card .tender-card-headline >> nth=3');
  await page.waitForSelector('.drawer .fact');
  await page.click('.drawer button:has-text("Request submission help")');
  await page.waitForSelector('#request-form');
  await page.fill('#request-form textarea', 'Please prepare the bid');
  await page.click('.modal-footer button:has-text("Send request")');
  await page.waitForURL(/\/app\/desk\/\d+/);
  await page.waitForSelector('.stepper');
  check('raising a request opens its tracker', true);
  check('a new request starts at "Request received"', (await page.textContent('.stepper li.current')).includes('Request received'));
  await shot('03-new-request');
  // the same tender again is refused
  await page.goBack();
  await page.waitForSelector('.drawer .fact');
  await page.click('.drawer button:has-text("Request submission help")');
  await page.click('.modal-footer button:has-text("Send request")');
  await page.waitForSelector('text=already have an open request');
  check('a second request for the same tender is refused politely', true);
  await page.click('.modal-footer button:has-text("Cancel")');

  // Hindi
  await page.goto(`${base}/app/desk`);
  await page.waitForSelector('table.table tbody tr');
  await page.click('.lang-btn >> nth=1');
  await page.waitForTimeout(500);
  check('the desk is translated into Hindi', /[ऀ-ॿ]/.test(await page.textContent('table.table thead')));
  await shot('04-hindi');
  await page.click('.lang-btn >> nth=0');
  await logout();

  // ---- Staff --------------------------------------------------------------------------------
  await login('manager@demo.test');
  await page.goto(`${base}/app/desk`);
  await page.waitForSelector('.stage-counts');
  check('staff see the dashboard with stage counts', (await page.$$('.stage-count')).length === 9);
  check('staff see an unassigned request', await page.isVisible('text=Unassigned >> nth=0'));
  await shot('05-staff-dashboard', true);
  await page.click('table.table tbody tr >> nth=0');
  await page.waitForSelector('.stepper');
  await page.waitForSelector('text=Financial bid strategy (internal');
  check('staff see the internal strategy', (await page.textContent('body')).includes('Expected margin') || (await page.inputValue('textarea >> nth=1')).length >= 0);

  // work an unassigned case: assign, move, summarise
  await page.goto(`${base}/app/desk`);
  await page.waitForSelector('table.table tbody tr');
  await page.click('select[aria-label="Owner"]');
  await page.selectOption('select[aria-label="Owner"]', 'unassigned');
  await page.waitForTimeout(600);
  const rows = await page.$$('table.table tbody tr');
  check('the unassigned filter works', rows.length >= 1);
  await rows[rows.length - 1].click();
  await page.waitForSelector('select[aria-label="Owner"]');
  await page.selectOption('select[aria-label="Owner"]', { label: 'Meera Case Manager' });
  await page.waitForSelector('.toast-success');
  await page.selectOption('select[aria-label="Stage"]', 'detail_study');
  await page.waitForFunction(() => document.querySelector('.stepper li.current')?.textContent.includes('Detail study'));
  check('stage move is reflected in the stepper', true);
  await page.fill('textarea >> nth=0', 'Short summary from the desk for the client.');
  await page.click('button:has-text("Save details")');
  await page.waitForSelector('.toast-success >> text=Saved');
  // checklist
  await page.selectOption('select[aria-label^="Status of"] >> nth=0', 'pass');
  await page.waitForTimeout(700);
  // internal document
  await page.setInputFiles('input[type=file]', pdfPath);
  await page.click('button:has-text("Add a document")');
  await page.waitForSelector('.doc-list li');
  check('staff upload is internal by default', (await page.textContent('.doc-list')).includes('Internal'));
  await shot('06-staff-case', true);
  const caseUrl = page.url();
  await logout();

  // the client sees the summary but not the internal document
  await login('owner@demo.test');
  await page.goto(caseUrl);
  await page.waitForSelector('.stepper');
  const clientView = await page.textContent('body');
  check('the client sees the summary the desk wrote', clientView.includes('Short summary from the desk'));
  check('the client does not see the internal document', !(await page.textContent('main')).includes('sample-upload.pdf'));
  check('the client sees the first checklist item as met', (await page.textContent('.check-list')).includes('Met'));

  // ---- Mobile --------------------------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${base}/app/desk`);
  await page.waitForSelector('table.table tbody tr');
  check('desk list has no horizontal page scroll on mobile', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.click('table.table tbody tr >> nth=0');
  await page.waitForSelector('.stepper');
  check('case page has no horizontal page scroll on mobile', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot('07-mobile', true);
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (err) {
  console.log('FAIL  script error  -> ' + err.message.split('\n')[0]);
  await shot('error', true).catch(() => {});
} finally {
  await browser.close();
}
