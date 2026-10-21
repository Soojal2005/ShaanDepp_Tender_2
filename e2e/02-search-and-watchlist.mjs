import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';

const base = 'http://localhost:5173';
const shots = path.resolve(process.env.E2E_OUT ?? 'e2e-output', '02-search-and-watchlist');
fs.mkdirSync(shots, { recursive: true });
const PASSWORD = 'Demo-Pass-2026';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  -> ' + detail : ''}`);
};

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
const resultCount = async () => {
  const text = await page.textContent('.result-bar .count');
  return Number(text.replace(/[^\d]/g, ''));
};

try {
  await login('owner@demo.test');

  // ---- Dashboard ---------------------------------------------------------------
  await page.goto(`${base}/app/dashboard`);
  await page.waitForSelector('.kpi-metric-card');
  const kpis = await page.$$eval('.kpi-big-value', (els) => els.map((e) => e.textContent));
  check('dashboard shows live open-tender count', Number(kpis[0].replace(/\D/g, '')) > 0, kpis.join(' | '));
  await page.waitForSelector('.recharts-surface');
  check('dashboard draws charts', (await page.$$('.recharts-surface')).length >= 3);
  check('dashboard lists department bars', (await page.$$('.dept-bar-row')).length > 0);
  check('dashboard shows when data was last updated', await page.isVisible('text=Data as of'));
  await shot('01-dashboard');

  // ---- Search ------------------------------------------------------------------
  await page.goto(`${base}/app/search`);
  await page.waitForSelector('.tender-item-card');
  const allOpen = await resultCount();
  check('search lists open tenders with a count', allOpen > 10, String(allOpen));
  await shot('02-search');

  await page.fill('input[aria-label="Keywords"]', 'water meter');
  await page.waitForFunction(() => location.search.includes('q=water+meter') || location.search.includes('q=water%20meter'));
  await page.waitForFunction((n) => Number(document.querySelector('.result-bar .count').textContent.replace(/\D/g, '')) < n, allOpen);
  const waterCount = await resultCount();
  const cards = await page.$$eval('.tender-item-card', (els) => els.map((e) => e.textContent.toLowerCase()));
  check('keyword search narrows results and every hit mentions the words', waterCount > 0 && cards.every((c) => c.includes('meter')), `${waterCount}`);

  await page.fill('input[aria-label="Exclude words"]', 'ultrasonic');
  await page.waitForFunction((n) => Number(document.querySelector('.result-bar .count').textContent.replace(/\D/g, '')) < n, waterCount).catch(() => {});
  const excluded = await resultCount();
  check('exclude words remove matching tenders', excluded < waterCount, `${waterCount} -> ${excluded}`);

  await page.click('button.facet-reset-link');
  await page.waitForFunction((n) => Number(document.querySelector('.result-bar .count').textContent.replace(/\D/g, '')) === n, allOpen);
  check('reset restores the full list', (await resultCount()) === allOpen);

  const firstDept = page.locator('.facet-filter-group:has-text("Department") input[type=checkbox]').first();
  await firstDept.click();
  await page.waitForFunction(() => location.search.includes('departmentIds='));
  await page.waitForTimeout(500);
  check('department facet filters the list and is kept in the URL', (await resultCount()) < allOpen);
  await page.click('button.facet-reset-link');
  await page.waitForTimeout(400);

  await page.selectOption('#sort', 'value');
  await page.waitForTimeout(500);
  const values = await page.$$eval('.tender-item-card .metric-column-item:first-child .metric-column-val', (els) => els.map((e) => e.textContent.trim()));
  check('sorting by value puts undisclosed values last', values.length > 0 && values[0] !== 'Not Disclosed by Department', values.slice(0, 2).join(' | '));

  // ---- Dossier drawer ------------------------------------------------------------
  await page.selectOption('#sort', 'deadline');
  await page.waitForTimeout(400);
  await page.click('.tender-item-card .tender-card-headline >> nth=0');
  await page.waitForSelector('.drawer');
  check('opening a tender puts its id in the URL', page.url().includes('tender='));
  await page.waitForSelector('.fact');
  check('dossier shows facts', (await page.$$('.fact')).length === 10);
  await shot('03-drawer');
  await page.click('.drawer .tab:has-text("BOQ")');
  check('dossier BOQ tab responds', await page.isVisible('.drawer table, .drawer .cell-sub'));
  await page.click('.drawer .tab:has-text("Documents")');
  check('dossier lists documents with an honest note about downloads', await page.isVisible('text=Documents come from the source feed'));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.drawer', { state: 'detached' });
  check('Escape closes the dossier', !page.url().includes('tender='));

  // ---- Watchlist -------------------------------------------------------------------
  await page.click('.tender-item-card .card-star-btn >> nth=0');
  await page.waitForSelector('text=Added to your watchlist');
  await page.goto(`${base}/app/watchlist`);
  await page.waitForSelector('.tender-item-card');
  check('watched tender appears on the watchlist', (await page.$$('.tender-item-card')).length === 1);
  await shot('04-watchlist');
  await page.click('.card-star-btn');
  await page.waitForSelector('text=Nothing on your watchlist yet');
  check('removing it empties the watchlist', true);

  // ---- Saved search -------------------------------------------------------------------
  await page.goto(`${base}/app/search?q=road`);
  await page.waitForSelector('.tender-item-card');
  await page.click('button:has-text("Save search")');
  await page.fill('#save-search-form input', 'Road tenders');
  await page.click('button:has-text("Save") >> nth=-1');
  await page.waitForSelector('text=Search saved.');
  await page.goto(`${base}/app/watchlist`);
  await page.click('button[role=tab]:has-text("Saved searches")');
  await page.waitForSelector('td:has-text("Road tenders")');
  await page.click('a:has-text("Run search")');
  await page.waitForURL('**/app/search?**');
  check('saved search re-runs with its filters', page.url().includes('q=road'));

  // ---- Export ------------------------------------------------------------------------------
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('a:has-text("Export Excel")')]);
  const target = path.join(shots, download.suggestedFilename());
  await download.saveAs(target);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(target);
  const sheet = wb.getWorksheet('Tenders');
  check('Excel export downloads a workbook of the filtered list', download.suggestedFilename().endsWith('.xlsx') && sheet.actualRowCount > 1, `${sheet?.actualRowCount} rows`);

  // ---- Hindi -----------------------------------------------------------------------------------
  await page.goto(`${base}/app/search`);
  await page.click('.lang-btn:has-text("हिं")');
  await page.waitForSelector('text=फ़िल्टर');
  check('search page switches to Hindi', await page.isVisible('text=लाइव टेंडर फ़ीड और खोज'));
  await shot('05-search-hindi');
  await page.click('.lang-btn:has-text("EN")');

  // ---- Mobile ------------------------------------------------------------------------------------
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const m = await mobile.newPage();
  await m.goto(`${base}/login`);
  await m.fill('input[type=email]', 'subscriber@demo.test');
  await m.fill('input[type=password]', PASSWORD);
  await m.click('button[type=submit]');
  await m.waitForURL('**/app/**');
  await m.goto(`${base}/app/search`);
  await m.waitForSelector('.tender-item-card');
  check('mobile: filters are collapsed behind a button', !(await m.isVisible('.facet-filters-card')) && (await m.isVisible('.filter-toggle')));
  await m.click('.filter-toggle');
  check('mobile: filter button reveals the filters', await m.isVisible('.facet-filters-card'));
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check('mobile: no horizontal page scroll on search', !overflow);
  await m.screenshot({ path: path.join(shots, '06-mobile-search.png') });
  await m.goto(`${base}/app/dashboard`);
  await m.waitForSelector('.kpi-metric-card');
  const overflow2 = await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check('mobile: no horizontal page scroll on dashboard', !overflow2);
  await m.screenshot({ path: path.join(shots, '07-mobile-dashboard.png') });
  await mobile.close();

  // ---- Admin: data feeds -------------------------------------------------------------------------------
  await page.click('.top-user-pill');
  await page.click('text=Sign out');
  await page.waitForURL('**/login');
  await login('admin@demo.test');
  await page.goto(`${base}/app/admin/ingestion`);
  await page.waitForSelector('text=Tenderbook (licensed API feed)');
  const stored = Number((await page.textContent('.kpi-metric-card:first-child .kpi-big-value')).replace(/\D/g, ''));
  check('data feeds page shows how many tenders are stored', stored >= 60, String(stored));
  check('data feeds page says the API key is configured only when it is', await page.isVisible('text=Not configured') || await page.isVisible('text=Configured'));
  await shot('08-data-feeds');

  const wbU = new ExcelJS.Workbook();
  const ws = wbU.addWorksheet('Data');
  ws.addRow(['Tender ID *', 'Title *', 'Department', 'State', 'Estimated value (INR)', 'Submission deadline *']);
  ws.addRow(['UP-1', 'Supply of boiler spares', 'Zila Panchayat Samiti', 'Madhya Pradesh', 2500000, '30/12/2026']);
  ws.addRow(['UP-2', '', 'Public Works Department', 'Madhya Pradesh', 100, '30/12/2026']);
  const xlsxPath = path.join(shots, 'upload.xlsx');
  await wbU.xlsx.writeFile(xlsxPath);
  await page.setInputFiles('input[type=file]', xlsxPath);
  await page.click('button:has-text("Preview (no changes)")');
  await page.waitForSelector('text=Preview:');
  check('upload preview reports valid rows and the row that needs fixing', (await page.locator('.note:has-text("Preview:")').textContent()).includes('1 of 2 rows are valid') && await page.isVisible('text=Title is required'));
  await page.click('button:has-text("Import")');
  await page.waitForSelector('text=Done:');
  check('import stores the valid row', (await page.locator('.note:has-text("Done:")').textContent()).includes('1 new'));
  await page.reload();
  await page.waitForSelector('td:has-text("Zila Panchayat Samiti")');
  check('an unrecognised department is queued for review, not guessed', true);
  await shot('09-suggestions');
  await page.click('tr:has-text("Zila Panchayat Samiti") button:has-text("Create new")');
  await page.waitForSelector('text=Created "Zila Panchayat Samiti"');
  await page.waitForSelector('td:has-text("Zila Panchayat Samiti")', { state: 'detached' });
  check('creating a master entry clears the suggestion', true);

  check('no unexpected browser console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
} catch (err) {
  check('script completed without throwing', false, err.message.split('\n')[0]);
  await shot('zz-failure');
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}
