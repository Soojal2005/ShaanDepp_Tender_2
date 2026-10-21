import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = 'http://localhost:5173';
const shots = path.resolve(process.env.E2E_OUT ?? 'e2e-output', '04-results-and-reports');
fs.mkdirSync(shots, { recursive: true });
const PASSWORD = 'Demo-Pass-2026';

const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  -> ' + detail : ''}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[13]|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`) });

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
  await login('owner@demo.test');

  // ---- Results: awards -----------------------------------------------------------------
  await page.click('nav a[href="/app/results"], a[href="/app/results"]');
  await page.waitForSelector('table.table tbody tr');
  const rows = await page.$$('table.table tbody tr');
  check('awards list shows rows', rows.length > 0, String(rows.length));
  check('depth note is shown', (await page.textContent('.note-info')).includes('Nothing is estimated'));
  const body = await page.textContent('table.table');
  check('missing rates are labelled, never zero', /Rate not published|Winner not published/.test(body) || !/â‚¹ 0(\D|$)/.test(body));
  await shot('01-awards');
  await page.click('table.table tbody tr >> nth=0');
  await page.waitForSelector('.modal h4');
  check('award detail opens with bidders', (await page.textContent('.modal')).includes('Bidders'));
  await shot('02-award-detail');
  await page.click('.modal-footer button:has-text("Close")');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('a:has-text("Export Excel")')]);
  check('excel export downloads an xlsx', dl.suggestedFilename().endsWith('.xlsx'), dl.suggestedFilename());

  // filter by text
  await page.fill('input[aria-label="Search results"]', 'zzzznomatch');
  await page.click('button:has-text("Apply")');
  await page.waitForSelector('text=No results match these filters');
  check('a search with no match says so', true);
  await page.fill('input[aria-label="Search results"]', '');
  await page.click('button:has-text("Apply")');
  await page.waitForSelector('table.table tbody tr');

  // ---- Results: rate analysis ------------------------------------------------------------
  await page.click('[role=tab]:has-text("Rate analysis")');
  await page.waitForSelector('text=Bid band suggestion');
  await page.waitForSelector('.recharts-wrapper');
  check('rate analysis renders trend chart', (await page.$$('.recharts-wrapper')).length >= 1);
  await page.fill('input[type=number]', '50000000');
  await page.waitForTimeout(800);
  const bandText = await page.textContent('main, .portal-main, body');
  check('bid band shown as a range or an honest "not enough" note', /winning bids typically landed|No band can be suggested|Not enough data/.test(bandText));
  await shot('03-rates');

  // ---- Results: tender analysis ----------------------------------------------------------
  await page.click('[role=tab]:has-text("Tender analysis")');
  await page.waitForSelector('text=Department award patterns');
  await page.waitForSelector('text=Bidder profiles');
  await page.waitForTimeout(600);
  check('tender analysis tables render', (await page.$$('table.table')).length >= 2);
  await shot('04-tenders');
  await page.waitForSelector('tr.clickable', { timeout: 5000 }).catch(() => {});
  const bidderRow = await page.$('tr.clickable');
  if (bidderRow) {
    await bidderRow.click();
    await page.waitForSelector('.modal h4');
    check('bidder profile opens', (await page.textContent('.modal')).includes('Where this firm wins'));
    await shot('05-bidder');
    await page.click('.modal-footer button:has-text("Close")');
  } else check('bidder profile opens', false, 'no bidder rows');

  // ---- Reports locker ------------------------------------------------------------------------
  await page.goto(`${base}/app/reports`);
  await page.waitForSelector('.report-row');
  check('released reports appear in the locker', (await page.$$('.report-row')).length === 2);
  await shot('06-locker');
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.click('.report-row >> nth=0 >> a:has-text("Download PDF")')]);
  check('PDF downloads', pdf.suggestedFilename().endsWith('.pdf'));
  const [xlsx] = await Promise.all([page.waitForEvent('download'), page.click('.report-row >> nth=0 >> a:has-text("Download Excel")')]);
  check('Excel downloads', xlsx.suggestedFilename().endsWith('.xlsx'));

  await page.click('.report-row >> nth=0 >> a:has-text("Open report")');
  await page.waitForSelector('svg.tile-map');
  await page.waitForSelector('.recharts-wrapper');
  check('report shows the tile map', (await page.$$('svg.tile-map rect')).length >= 30);
  check('report shows seven numbered sections', (await page.$$('section.card h3')).length >= 7);
  const reportText = await page.textContent('body');
  check('no "NaN" or "undefined" on the report', !/NaN|undefined/.test(reportText));
  await page.screenshot({ path: path.join(shots, '07-report.png'), fullPage: true });

  // Hindi
  await page.click('.lang-btn >> nth=1');
  await page.waitForTimeout(500);
  check('report is translated to Hindi', /[ऀ-ॿ]/.test(await page.textContent('section.card h3')));
  await page.click('.lang-btn >> nth=0');
  await page.waitForTimeout(500);

  // ---- Client cannot reach staff pages -------------------------------------------------------
  await page.goto(`${base}/app/admin/reports`);
  await page.waitForTimeout(600);
  check('client is blocked from admin reports', !(await page.textContent('body')).includes('Release log'));
  await logout();

  // ---- Staff: weekly reports admin -----------------------------------------------------------
  await login('admin@demo.test');
  await page.goto(`${base}/app/admin/reports`);
  await page.waitForSelector('text=Release log');
  await page.waitForSelector('.badge-green');
  await page.waitForTimeout(500);
  check('admin sees release log with demo releases', (await page.$$('table.table tbody tr')).length >= 2);
  await page.click('button:has-text("Generate for all clients")');
  await page.waitForSelector('.toast-success');
  check('generate reports a result', (await page.textContent('.toast-success')).includes('Generated'));
  await shot('08-admin-reports');
  const preview = await page.$('button:has-text("Preview")');
  if (preview) {
    await preview.click();
    await page.waitForSelector('.modal svg.tile-map');
    check('admin can preview a bundle before release', true);
    await page.click('.modal-footer button:has-text("Close")');
  } else check('admin can preview a bundle before release', false, 'no bundle row');
  await logout();

  // ---- Case manager may release but not generate ---------------------------------------------
  await login('manager@demo.test');
  await page.goto(`${base}/app/admin/reports`);
  await page.waitForSelector('text=Release log');
  check('case manager cannot generate', (await page.$$('button:has-text("Generate for all clients")')).length === 0);

  // ---- Mobile ---------------------------------------------------------------------------------
  await logout();
  await login('owner@demo.test');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${base}/app/results`);
  await page.waitForSelector('table.table tbody tr');
  check('results page has no horizontal page scroll on mobile', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.goto(`${base}/app/reports`);
  await page.waitForSelector('.report-row');
  await page.click('.report-row >> nth=0 >> a:has-text("Open report")');
  await page.waitForSelector('svg.tile-map');
  check('report has no horizontal page scroll on mobile', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: path.join(shots, '09-report-mobile.png'), fullPage: true });

  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (err) {
  console.log('FAIL  script error  -> ' + err.message.split('\n')[0]);
  await shot('error').catch(() => {});
} finally {
  await browser.close();
}


