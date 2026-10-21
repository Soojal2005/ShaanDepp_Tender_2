import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = 'http://localhost:5173';
const shots = path.resolve(process.env.E2E_OUT ?? 'e2e-output', '01-sign-in-and-admin');
fs.mkdirSync(shots, { recursive: true });
const PASSWORD = 'Demo-Pass-2026';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  -> ' + detail : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/status of 40[13]|Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: false });

async function login(email, password = PASSWORD) {
  await page.goto(`${base}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.click('button[type=submit]');
}
async function signOut() {
  await page.click('.top-user-pill');
  await page.click('text=Sign out');
  await page.waitForURL('**/login');
}

try {
  // ---- A. Gate ------------------------------------------------------------
  await page.goto(`${base}/app/profile`);
  await page.waitForURL('**/login');
  check('unauthenticated visit to /app/profile redirects to /login', page.url().includes('/login'));
  await shot('01-login');

  await login('admin@demo.test', 'wrong-password-1');
  await page.waitForSelector('.note-error');
  check('wrong password shows an error and stays on login', (await page.textContent('.note-error')).includes('Invalid email or password'));

  await login('admin@demo.test');
  await page.waitForURL('**/app/**');
  check('after sign-in the user returns to the page they originally asked for', page.url().endsWith('/app/profile'));
  await page.goto(`${base}/app`);
  await page.waitForURL('**/app/dashboard');
  check('platform admin lands on the workspace', page.url().endsWith('/app/dashboard'));
  check('platform admin sees the Administration section', await page.isVisible('text=Organizations'));
  await shot('02-dashboard-placeholder');

  // ---- B. Organizations ----------------------------------------------------
  await page.click('a:has-text("Organizations")');
  await page.waitForSelector('h2:has-text("Organizations")');
  await page.waitForSelector('table.table');
  const orgText = await page.textContent('table.table');
  check('organization list shows demo client and staff org', orgText.includes('Demo Infra Projects') && orgText.includes('Shan-Deep Management Advisory'));
  await shot('03-organizations');

  await page.click('button:has-text("New organization")');
  await page.fill('#new-org-form input >> nth=0', 'Gupta Constructions Ltd');
  await page.selectOption('#new-org-form select >> nth=0', 'premium');
  await page.fill('#new-org-form input >> nth=-2', 'Gupta Ji');
  await page.fill('#new-org-form input >> nth=-1', 'gupta@gupta.test');
  await shot('04-new-org-modal');
  await page.click('button:has-text("Create and invite admin")');
  await page.waitForURL(/organizations\/\d+$/);
  await page.waitForSelector('h2:has-text("Gupta Constructions Ltd")');
  check('creating an organization opens its detail page', true);
  check('invited admin is listed', (await page.textContent('table.table')).includes('gupta@gupta.test'));
  await shot('05-org-detail');

  // ---- C. Masters, plans, audit -------------------------------------------
  await page.click('a:has-text("Master Lists")');
  await page.waitForSelector('h2:has-text("Master lists")');
  await page.waitForSelector('table.table');
  check('masters list the 32 starter departments', (await page.textContent('.card-header h3')).includes('32'));
  await page.click('button:has-text("Add")');
  await page.fill('#master-form input >> nth=0', 'Tribal Welfare Department');
  await page.click('button:has-text("Save")');
  await page.waitForSelector('td:has-text("Tribal Welfare Department")');
  check('adding a department shows it in the list', true);
  await shot('06-masters');

  await page.click('a:has-text("Plans")');
  await page.waitForSelector('input[aria-label="Plan name"]');
  check('plans page shows Basic / Standard / Premium', (await page.locator('input[aria-label="Plan name"]').count()) === 3);
  await shot('07-plans');

  await page.click('a:has-text("Audit Log")');
  await page.waitForSelector('h2:has-text("Audit log")');
  await page.waitForSelector('table.table');
  const audit = await page.textContent('table.table');
  check('audit log records org.create and sign-ins', audit.includes('org.create') && audit.includes('auth.login'));
  await shot('08-audit');

  await signOut();

  // ---- D. Client account: team and seats ---------------------------------
  await login('owner@demo.test');
  await page.waitForURL('**/app/dashboard');
  check('client account has no Administration section', !(await page.isVisible('.sidebar-section')));
  await page.goto(`${base}/app/admin/organizations`);
  await page.waitForSelector('text=You do not have access to this page');
  check('client visiting an admin URL is told it is not allowed', true);

  await page.goto(`${base}/app/profile`);
  await page.waitForSelector('text=People on this account');
  check('profile shows the plan ceiling for the Standard plan', (await page.textContent('.kv')).includes('100 tenders per day'));
  await page.waitForSelector('table.table');
  await shot('09-profile-client');

  await page.click('button:has-text("Invite person")');
  await page.fill('#invite-form input >> nth=0', 'Third Person');
  await page.fill('#invite-form input >> nth=1', 'third@demo.test');
  await page.click('button:has-text("Invite person") >> nth=-1');
  await page.waitForSelector('text=Invitation sent');
  check('inviting a third login succeeds', true);

  await page.click('button:has-text("Invite person")');
  await page.fill('#invite-form input >> nth=0', 'Fourth Person');
  await page.fill('#invite-form input >> nth=1', 'fourth@demo.test');
  await page.click('button:has-text("Invite person") >> nth=-1');
  await page.waitForSelector('.note-error');
  check('a fourth login is refused with a seat-limit message', (await page.textContent('.note-error')).includes('Seat limit reached'));
  await shot('10-seat-limit');
  await page.click('button:has-text("Cancel")');

  // ---- E. Hindi -----------------------------------------------------------
  await page.click('.lang-btn:has-text("हिं")');
  await page.waitForSelector('text=डैशबोर्ड');
  check('Hindi switches the navigation', await page.isVisible('text=टेंडर खोजें'));
  check('Hindi switches page content', await page.isVisible('text=इस खाते के सदस्य'));
  await shot('11-hindi');
  await page.goto(`${base}/app/help`);
  await page.waitForSelector('details');
  check('Help FAQ renders in Hindi', (await page.textContent('details summary')).includes('क्रमबद्ध'));
  await shot('12-help-hindi');
  await page.click('.lang-btn:has-text("EN")');

  // ---- F. Mobile ------------------------------------------------------------
  const mobile = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const m = await mobile.newPage();
  await m.goto(`${base}/login`);
  await m.fill('input[type=email]', 'subscriber@demo.test');
  await m.fill('input[type=password]', PASSWORD);
  await m.click('button[type=submit]');
  await m.waitForURL('**/app/dashboard');
  check('mobile: sidebar is hidden until the menu button is used', !(await m.isVisible('.dark-navy-sidebar.open')));
  await m.click('.nav-toggle');
  await m.waitForSelector('.dark-navy-sidebar.open');
  await m.screenshot({ path: path.join(shots, '13-mobile-menu.png') });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check('mobile: no horizontal page scroll', !overflow);
  await mobile.close();

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
