import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = 'http://localhost:5173';
const shots = path.resolve(process.env.E2E_OUT ?? 'e2e-output', '03-alerts-and-mail');
fs.mkdirSync(shots, { recursive: true });
const PASSWORD = 'Demo-Pass-2026';
const outbox = process.env.OUTBOX_DIR;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  -> ' + detail : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
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

try {
  await login('owner@demo.test');

  // ---- Alert profiles list ---------------------------------------------------------
  await page.goto(`${base}/app/alerts`);
  await page.waitForSelector('.alert-card');
  check('the two sample alerts are listed', (await page.$$('.alert-card')).length === 2);
  check('the plan limit and ceiling are stated', (await page.textContent('.note-info')).includes('5 alert profiles') && (await page.textContent('.note-info')).includes('100 tenders'));
  check('each alert says when it last emailed', (await page.textContent('.alert-card')).includes('Last email'));
  await shot('01-alerts');

  // ---- Preview ---------------------------------------------------------------------------
  await page.click('.alert-card >> nth=0 >> button:has-text("Preview")');
  await page.waitForSelector('.modal');
  const previewText = await page.textContent('.modal');
  check('preview explains what the next email holds', previewText.includes('What your next email would contain'));
  await shot('02-preview');
  await page.click('.modal-footer button:has-text("Close")');

  // ---- Test send ---------------------------------------------------------------------------
  await page.click('.alert-card >> nth=0 >> button:has-text("Send me a test")');
  await page.waitForSelector('text=outbox');
  check('test send says honestly that dry-run mode saved it to the outbox', true);
  await page.waitForTimeout(1500);

  // ---- Create a new alert ---------------------------------------------------------------------
  await page.click('button:has-text("New alert profile")');
  await page.waitForSelector('#alert-form');
  await page.fill('#alert-form input[placeholder="Water meters in Madhya Pradesh"], #alert-form input[maxlength="150"]', 'Solar rooftop in Rajasthan');
  await page.fill('input[aria-label="Keywords"]', 'solar');
  await page.keyboard.press('Enter');
  await page.fill('input[aria-label="Keywords"]', 'rooftop, pv');
  await page.keyboard.press('Enter');
  check('keywords become removable chips', (await page.$$('#alert-form .tag-chip')).length >= 3);
  await page.selectOption('select[aria-label="States / UTs"]', { label: 'Rajasthan' });
  await page.fill('input[aria-label="Send to"]', 'not-an-email');
  await page.keyboard.press('Enter');
  check('an invalid recipient address is refused', await page.isVisible('text=is not valid'));
  await page.fill('input[aria-label="Send to"]', '');
  await page.fill('input[aria-label="Tender value band (₹ lakh) Min"]', '10');
  await shot('03-new-alert');
  await page.click('button:has-text("Save")');
  await page.waitForSelector('text=Alert profile created.');
  await page.waitForSelector('.alert-card:has-text("Solar rooftop in Rajasthan")');
  check('a new alert is created', (await page.$$('.alert-card')).length === 3);

  // ---- Pause / resume ------------------------------------------------------------------------------
  const third = page.locator('.alert-card', { hasText: 'Solar rooftop in Rajasthan' });
  await third.locator('button:has-text("Pause")').click();
  await third.locator('.badge:has-text("Paused")').waitFor();
  check('pausing an alert shows its status', true);
  await third.locator('button:has-text("Resume")').click();
  await third.locator('.badge:has-text("Active")').waitFor();

  // ---- Delete ----------------------------------------------------------------------------------------
  await third.locator('button:has-text("Delete")').click();
  await page.click('.modal-footer button:has-text("Delete")');
  await page.waitForSelector('text=Alert profile deleted.');
  check('deleting asks first, then removes the alert', (await page.$$('.alert-card')).length === 2);

  // ---- Alert flags in search -----------------------------------------------------------------------------
  await page.goto(`${base}/app/search?alerts=matched`);
  await page.waitForSelector('.tender-item-card');
  const emailed = await page.$$('.tender-category-tag:has-text("In your alert email")');
  check('search shows which tenders were in your alert email', emailed.length > 0);
  await shot('04-search-flags');
  await page.goto(`${base}/app/search?q=road`);
  await page.waitForSelector('.tender-item-card');
  await page.click('button:has-text("Create alert from these filters")');
  await page.fill('#from-filters-form input', 'Road work alert');
  await page.click('.modal-footer button:has-text("New alert profile")');
  await page.waitForSelector('text=Alert created');
  await page.goto(`${base}/app/alerts`);
  await page.waitForSelector('.alert-card:has-text("Road work alert")');
  check('an alert can be created straight from a search', await page.isVisible('.alert-card:has-text("Road work alert") >> text=road'));

  // ---- Hindi -----------------------------------------------------------------------------------------------
  await page.click('.lang-btn:has-text("हिं")');
  await page.waitForSelector('h2:has-text("अलर्ट प्रोफ़ाइल")');
  check('the alerts page switches to Hindi', await page.isVisible('text=आपके अलर्ट कैसे काम करते हैं'));
  await shot('05-alerts-hindi');
  await page.click('.lang-btn:has-text("EN")');

  // ---- Mobile -----------------------------------------------------------------------------------------------
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const m = await mobile.newPage();
  await m.goto(`${base}/login`);
  await m.fill('input[type=email]', 'owner@demo.test');
  await m.fill('input[type=password]', PASSWORD);
  await m.click('button[type=submit]');
  await m.waitForURL('**/app/**');
  await m.goto(`${base}/app/alerts`);
  await m.waitForSelector('.alert-card');
  check('mobile: alerts page has no horizontal scroll', !(await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)));
  await m.screenshot({ path: path.join(shots, '06-mobile-alerts.png') });
  await mobile.close();

  // ---- Admin: mail queue and jobs ----------------------------------------------------------------------------------
  await page.click('.top-user-pill');
  await page.click('text=Sign out');
  await page.waitForURL('**/login');
  await login('admin@demo.test');
  await page.goto(`${base}/app/admin/mail`);
  await page.waitForSelector('.note-warn');
  check('the mail queue warns plainly that dry-run mode does not deliver', (await page.textContent('.note-warn')).includes('not delivered'));
  await page.waitForSelector('table.table tbody tr');
  check('the queue lists the digest and test emails', (await page.$$('table.table tbody tr')).length >= 2);
  await shot('07-mail-queue');
  await page.click('table.table tbody tr >> nth=0 >> button[aria-label^="View message"]');
  await page.waitForSelector('iframe.mail-preview');
  const sandbox = await page.getAttribute('iframe.mail-preview', 'sandbox');
  check('message previews are shown in a script-less sandbox', sandbox === '');
  await shot('08-mail-preview');
  await page.keyboard.press('Escape');
  await page.click('button:has-text("Send now")');
  await page.waitForSelector('text=Queue processed');
  await page.waitForTimeout(800);
  check('"Send now" processes the queue (dry-run entries appear)', (await page.$$('.badge:has-text("dry_run")')).length > 0);

  await page.goto(`${base}/app/admin/jobs`);
  await page.waitForSelector('text=Daily alert digests');
  check('the jobs page lists the schedule with India time for alerts', await page.isVisible('text=Asia/Kolkata'));
  await page.click('tr:has-text("Watchlist reminders") button:has-text("Run now")');
  await page.waitForSelector('text=Finished');
  await shot('09-jobs');

  if (outbox) {
    const files = fs.existsSync(outbox) ? fs.readdirSync(outbox).filter((f) => f.endsWith('.html')) : [];
    check('dry-run emails exist as files in the outbox folder', files.length > 0, outbox);
    if (files.length) {
      const text = fs.readFileSync(path.join(outbox, files[0]), 'utf8');
      check('an outbox email carries its recipient, subject and tender links', /To: .+@/.test(text) && /Subject: /.test(text));
    }
  }
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
