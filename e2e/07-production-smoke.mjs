// Production-mode smoke test: the API serves the built site on one origin, against real PostgreSQL.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = 'http://localhost:4100';
const shots = path.resolve(process.env.E2E_OUT ?? 'e2e-output', '07-production-smoke');
fs.mkdirSync(shots, { recursive: true });
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  -> ' + detail : ''}`);

// ---- plain HTTP checks ---------------------------------------------------------------------
const home = await fetch(`${base}/`);
const csp = home.headers.get('content-security-policy') ?? '';
check('the site is served by the API on one address', home.status === 200 && (await home.text()).includes('<div id="root">'));
check('a content security policy blocks foreign scripts', csp.includes("script-src 'self'") && csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'"), csp);
check('the server does not announce its framework', home.headers.get('x-powered-by') === null);
check('browsers are told not to sniff content types or open it in frames', home.headers.get('x-content-type-options') === 'nosniff' && home.headers.get('permissions-policy')?.includes('camera=()'));
check('a real service page is 200', (await fetch(`${base}/services/gem-portal/catalogue-management`)).status === 200);
check('an unknown address is a real 404', (await fetch(`${base}/no/such/page`)).status === 404);
check('an unknown API address is a JSON 404', (await fetch(`${base}/api/v1/nope`)).status === 404);
check('the API health check answers', (await (await fetch(`${base}/api/v1/health`)).json()).status === 'ok');
check('the sitemap and robots.txt are served', (await fetch(`${base}/sitemap.xml`)).status === 200 && (await (await fetch(`${base}/robots.txt`)).text()).includes('Disallow: /app/'));
const html = await (await fetch(`${base}/`)).text();
const asset = html.match(/\/assets\/[^"']+\.js/)?.[0];
check('built files are cached for a year, the page itself is not', (await fetch(`${base}${asset}`)).headers.get('cache-control')?.includes('immutable') && home.headers.get('cache-control') === 'no-cache');
const anon = await fetch(`${base}/api/v1/cases`);
check('the API refuses a request with no session', anon.status === 401);

// ---- browser ------------------------------------------------------------------------------------------
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[134]|Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const shot = (n) => page.screenshot({ path: path.join(shots, `${n}.png`), fullPage: true });

try {
  await page.goto(`${base}/`);
  await page.waitForSelector('.lp-service');
  check('the home page renders under the policy with no console errors', errors.length === 0, errors.join(' | '));

  // public enquiry
  await page.goto(`${base}/contact`);
  await page.fill('#contact-name', 'Smoke Tester');
  await page.fill('#contact-company', 'Smoke Co');
  await page.fill('#contact-email', 'smoke@example.com');
  await page.fill('#contact-message', 'Production smoke test');
  await page.check('.site-consent input');
  await page.click('form.site-form button[type=submit]');
  await page.waitForSelector('.site-form-done');
  check('an enquiry can be sent', true);

  // sign in as the bootstrap administrator
  await page.goto(`${base}/login`);
  await page.fill('input[type=email]', 'root@shandeep.test');
  await page.fill('input[type=password]', 'Root-Password-2026');
  await page.click('button[type=submit]');
  await page.waitForURL('**/app/**');
  const cookies = await ctx.cookies();
  const session = cookies.find((c) => c.name === 'pb_session');
  check('the session cookie is HttpOnly, Secure and SameSite', session?.httpOnly && session?.secure && ['Lax', 'Strict'].includes(session?.sameSite), JSON.stringify(session));

  const adminPages = ['organizations', 'plans', 'masters', 'ingestion', 'mail', 'jobs', 'enquiries', 'audit', 'reports'];
  for (const p of adminPages) {
    await page.goto(`${base}/app/admin/${p}`);
    await page.waitForSelector('.page-headline-block h2');
    await page.waitForTimeout(500);
    const bad = await page.$('.note-error');
    check(`admin page "${p}" loads from real PostgreSQL`, !bad, bad ? await bad.textContent() : '');
  }
  await page.goto(`${base}/app/admin/enquiries`);
  await page.waitForSelector('text=Smoke Co');
  check('the enquiry reached the admin inbox', true);

  // create a client and invite its first user, through the interface
  await page.goto(`${base}/app/admin/organizations`);
  await page.click('button:has-text("New organization")');
  await page.waitForSelector('.modal');
  await page.fill('#new-org-form input >> nth=0', 'Smoke Infra Pvt Ltd');
  await page.fill('#new-org-form input >> nth=4', 'Smoke Owner');
  await page.fill('#new-org-form input >> nth=5', 'owner@smoke.test');
  await page.click('.modal-footer button:has-text("Create and invite admin")');
  await page.waitForSelector('text=Smoke Infra Pvt Ltd', { timeout: 10000 });
  await page.waitForTimeout(800);
  check('an organization can be created and its first admin invited', (await page.textContent('body')).includes('owner@smoke.test') || (await page.textContent('body')).includes('Smoke Owner'));
  await shot('admin-orgs');

  for (const p of ['desk', 'reports', 'results', 'search', 'dashboard']) {
    await page.goto(`${base}/app/${p}`);
    await page.waitForSelector('.page-headline-block h2');
    await page.waitForTimeout(500);
    const bad = await page.$('.note-error');
    check(`portal page "${p}" loads for staff`, !bad, bad ? await bad.textContent() : '');
  }
  check('no console errors (including policy violations) anywhere', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err) {
  console.log('FAIL  script error  -> ' + err.message.split('\n')[0]);
  await shot('error').catch(() => {});
} finally {
  await browser.close();
}
