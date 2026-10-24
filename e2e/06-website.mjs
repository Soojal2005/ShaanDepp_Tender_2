import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = 'http://localhost:5173';
const shots = path.resolve(process.env.E2E_OUT ?? 'e2e-output', '06-website');
fs.mkdirSync(shots, { recursive: true });
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  -> ' + detail : ''}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[134]|Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const shot = (n, full = true) => page.screenshot({ path: path.join(shots, `${n}.png`), fullPage: full });
const meta = (sel, attr) => page.$eval(sel, (el, a) => el.getAttribute(a), attr).catch(() => null);

try {
  // ---- Home ----------------------------------------------------------------------------------
  await page.goto(`${base}/`);
  await page.waitForSelector('.site-group-card');
  check('the website is at "/" and shows the hero', (await page.textContent('h1')).includes('government tenders'));
  check('eight service groups are shown', (await page.$$('.site-group-card')).length === 8);
  check('registration and GST numbers are shown', (await page.textContent('.site-trust')).includes('BHOP260407SE000586') && (await page.textContent('.site-trust')).includes('23APSPT2592R1ZR'));
  check('page title and description are set for search engines', (await page.title()).includes('Shan-Deep') && (await meta('meta[name=description]', 'content'))?.length > 40);
  check('a canonical address is set', (await meta('link[rel=canonical]', 'href')) === `${base}/`);
  check('the department wall lists names without claiming logos', (await page.$$('.site-dept-wall li')).length === 12);
  await shot('01-home');

  // interactive flow chart
  await page.click('.home-process details > summary');
  await page.click('.flow-step >> nth=4');
  check('the flow chart explains the chosen step', (await page.textContent('.flow-detail')).includes('Financial strategy'));
  await page.click('.flow-step >> nth=8');
  check('the flow chart has nine steps and updates', (await page.$$('.flow-step')).length === 9 && (await page.textContent('.flow-detail')).includes('EMD refund'));

  // ---- Group and service pages -------------------------------------------------------------------
  await page.click('.site-group-card:has-text("GeM Portal Specialist")');
  await page.waitForSelector('.site-item-grid');
  check('the GeM group lists all 12 services', (await page.$$('.site-item-grid li')).length === 12);
  check('the group page title names the group', (await page.title()).includes('GeM Portal Specialist'));
  await shot('02-group');
  await page.click('.site-item-grid a:has-text("Catalogue management")');
  await page.waitForSelector('h1:has-text("Catalogue management")');
  check('a service has its own address', page.url().endsWith('/services/gem-portal/catalogue-management'));
  check('the service page has an enquiry form, a WhatsApp button and a call button',
    (await page.$('form.site-form')) && (await page.$('a.btn-whatsapp')) && (await page.$('a[href^="tel:"]')) ? true : false);
  const wa = await page.getAttribute('a.btn-whatsapp', 'href');
  check('the WhatsApp link names the service', wa.startsWith('https://wa.me/') && decodeURIComponent(wa).includes('Catalogue management'), wa);
  await shot('03-service');

  // consent is required, then the enquiry is accepted
  const send = page.locator('form.site-form button[type=submit]');
  check('the form cannot be sent without consent', await send.isDisabled());
  await page.fill('#service-name', 'Ramesh Patel');
  await page.fill('#service-company', 'Patel Traders');
  await page.fill('#service-email', 'ramesh@pateltraders.example');
  await page.fill('#service-phone', '9876543210');
  await page.fill('#service-message', 'Need help with GeM catalogue upload');
  await page.check('form.site-form .site-consent input');
  check('the form can be sent once consent is given', await send.isEnabled());
  await send.click();
  await page.waitForSelector('.site-form-done');
  check('the visitor is thanked', (await page.textContent('.site-form-done')).includes('Thank you'));

  // ---- Search -----------------------------------------------------------------------------------------
  await page.goto(`${base}/services`);
  await page.waitForSelector('.site-index-group');
  check('the services page lists all eight groups', (await page.$$('.site-index-group')).length === 8);
  await page.fill('.site-search', 'ISO 27001');
  await page.waitForSelector('.site-result-list');
  check('searching finds a service by name', (await page.textContent('.site-result-list')).includes('ISO 27001'));
  await page.fill('.site-search', 'zzzzzz');
  check('a search with no match says so', (await page.textContent('.site-page')).includes('No service matches'));

  // ---- Not found --------------------------------------------------------------------------------------
  await page.goto(`${base}/services/gem-portal/not-a-service`);
  await page.waitForSelector('h1:has-text("Page not found")');
  await page.goto(`${base}/no/such/page`);
  await page.waitForSelector('h1:has-text("Page not found")');
  check('unknown addresses show a proper not-found page', true);

  // ---- Hindi --------------------------------------------------------------------------------------------
  await page.goto(`${base}/`);
  await page.waitForSelector('.site-group-card');
  await page.click('.lang-btn >> nth=1');
  await page.waitForTimeout(400);
  check('the whole home page switches to Hindi', /[ऀ-ॿ]/.test(await page.textContent('h1')) && /[ऀ-ॿ]/.test(await page.textContent('.site-group-card')));
  check('the page title is in Hindi', /[ऀ-ॿ]/.test(await page.title()));
  await shot('04-home-hindi');
  await page.goto(`${base}/services/business-setup`);
  await page.waitForSelector('.site-item-grid');
  check('service names are shown in Hindi on a group page', /[ऀ-ॿ]/.test(await page.textContent('.site-item-grid li')));
  await shot('05-group-hindi');
  await page.click('.lang-btn >> nth=0');

  // ---- The portal is a click away and robots/sitemap exist ---------------------------------------------------
  await page.goto(`${base}/`);
  await page.click('.site-nav a:has-text("Tender Portal")');
  await page.waitForURL('**/login');
  check('the portal link goes to sign-in', true);
  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  check('the sitemap lists every service page', sitemap.includes('/services/iso-certifications/iso-27001') && (sitemap.match(/<loc>/g) ?? []).length === 93);
  const robots = await (await fetch(`${base}/robots.txt`)).text();
  check('robots.txt keeps the portal out of search results', robots.includes('Disallow: /app/') && robots.includes('Sitemap:'));

  // ---- Staff see the enquiry ---------------------------------------------------------------------------------
  await page.fill('input[type=email]', 'admin@demo.test');
  await page.fill('input[type=password]', 'Demo-Pass-2026');
  await page.click('button[type=submit]');
  await page.waitForURL('**/app/**');
  await page.goto(`${base}/app/admin/enquiries`);
  await page.waitForSelector('text=Patel Traders');
  check('the enquiry reaches the admin inbox with its service', (await page.textContent('body')).includes('Catalogue management'));
  await shot('06-inbox', false);

  // ---- Mobile ---------------------------------------------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${base}/`);
  await page.waitForSelector('.site-group-card');
  check('home has no horizontal scroll on mobile', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  check('the menu is hidden until opened', !(await page.isVisible('.site-nav a:has-text("Services")')));
  await page.click('.site-menu-btn');
  check('the menu opens', await page.isVisible('.site-nav a:has-text("Services")'));
  await shot('07-mobile-menu', false);
  await page.click('.site-nav a:has-text("Services")');
  await page.waitForSelector('.site-index-group');
  await page.goto(`${base}/services/iso-certifications/iso-9001`);
  await page.waitForSelector('form.site-form');
  check('a service page has no horizontal scroll on mobile', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot('08-mobile-service');
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err) {
  console.log('FAIL  script error  -> ' + err.message.split('\n')[0]);
  await shot('error').catch(() => {});
} finally {
  await browser.close();
}
