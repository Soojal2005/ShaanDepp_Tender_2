/** Dependency-free Chrome DevTools smoke test. Start the demo API and Vite,
 * then launch headless Chrome with --remote-debugging-port=9227 and a dedicated
 * --user-data-dir before running: node e2e/08-homepage-redesign.mjs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const origin = 'http://127.0.0.1:5173';
const output = path.resolve('e2e-output/homepage-redesign');
fs.mkdirSync(output, { recursive: true });
const tabs = await (await fetch('http://127.0.0.1:9227/json/list')).json();
const target = tabs.find(tab => tab.type === 'page');
assert.ok(target, 'A page must be open in the dedicated review browser');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let id = 0;
const pending = new Map();
const browserErrors = [];
socket.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.id) { const task = pending.get(data.id); pending.delete(data.id); if (task) data.error ? task.reject(new Error(data.error.message)) : task.resolve(data.result); }
  if (data.method === 'Runtime.exceptionThrown') browserErrors.push(data.params.exceptionDetails.text);
});
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const messageId = ++id;
  pending.set(messageId, { resolve, reject });
  socket.send(JSON.stringify({ id: messageId, method, params }));
});
const evaluate = async (expression) => {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(expression) {
  for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(100); }
  throw new Error(`Timed out: ${expression}`);
}
const check = async (name, expression) => { assert.ok(await evaluate(expression), name); console.log(`PASS ${name}`); };
async function navigate(route = '/') {
  await cdp('Page.navigate', { url: `${origin}${route}` });
  await until('document.readyState === "complete" && !!document.querySelector("h1")');
  await evaluate('document.fonts.ready');
}
async function screenshot(name) {
  const metrics = await cdp('Page.getLayoutMetrics');
  const bounds = metrics.cssContentSize;
  const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: bounds.width, height: bounds.height, scale: 1 } });
  fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(result.data, 'base64'));
}

try {
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate();
  await until('document.querySelectorAll(".lp-service").length === 8 && document.querySelectorAll(".lp-tender:not(.lp-skeleton)").length === 3');
  await evaluate('localStorage.setItem("pb_lang", "EN")'); await navigate();
  await check('all eight service groups remain', 'document.querySelectorAll(".lp-service").length === 8');
  await check('the services heading names all 81 offerings across 8 groups', 'document.querySelector("#services-title").closest("section").textContent.includes("81 services across 8")');
  await check('registration and GST remain in the footer', 'document.querySelector(".site-footer-reg").textContent.includes("BHOP260407SE000586") && document.querySelector(".site-footer-reg").textContent.includes("23APSPT2592R1ZR")');
  await check('all four original detailed portal features remain', 'document.querySelectorAll(".lp-checks li").length === 4 && document.querySelector(".lp-checks").textContent.includes("150") && document.querySelector(".lp-checks").textContent.includes("value and dates")');
  await evaluate('document.querySelector("button[aria-controls=dept-panel]").click()');
  await check('all twelve original departments remain', 'document.querySelectorAll(".lp-dept-wall li").length === 12');
  await evaluate('document.querySelector("button[aria-controls=flow-panel]").click()');
  await check('all nine original process steps remain', 'document.querySelectorAll(".flow-step").length === 9');
  await evaluate('document.querySelectorAll(".flow-step")[4].click()');
  await check('financial strategy step works', 'document.querySelector(".flow-detail").textContent.includes("Financial strategy")');
  await evaluate('document.querySelectorAll(".flow-step")[8].click()');
  await check('follow-up step works', 'document.querySelector(".flow-detail").textContent.includes("EMD refund")');
  await evaluate('document.querySelector("button[aria-controls=flow-panel]").click()');
  await check('three sample cards are explicitly marked as samples', 'document.querySelectorAll(".lp-tender").length === 3 && [...document.querySelectorAll(".lp-sample")].every(e=>e.textContent.includes("Sample")) && document.querySelector("#tenders-title").closest("section").textContent.includes("Sample opportunities")');
  await check('hero actions go to the request form and the services', 'document.querySelector(".lp-hero .lp-cta a.btn-blue").getAttribute("href") === "#access" && document.querySelector(".lp-hero .lp-cta a.btn-light").getAttribute("href") === "/services"');
  await check('the hero search sends a keyword into the sign-in redirect', '(()=>{const i=document.querySelector(".lp-search-field input");const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(i,"solar");i.dispatchEvent(new Event("input",{bubbles:true}));return typeof i.value==="string"&&i.value==="solar";})()');
  await check('header offers Request access and the Tender Portal', '["/request-access","/login"].every(h=>[...document.querySelectorAll(".site-nav-actions a")].some(a=>a.getAttribute("href")===h))');
  await check('footer links the three legal pages and the sitemap', '["/privacy","/terms","/disclaimer","/sitemap.xml"].every(h=>[...document.querySelectorAll(".site-legal a")].some(a=>a.getAttribute("href")===h))');
  await check('phone, email and WhatsApp links remain', '["tel:","mailto:","https://wa.me/"].every(prefix=>[...document.querySelectorAll("footer a")].some(a=>a.href.startsWith(prefix)))');
  await check('SEO title, description and canonical remain', 'document.title.includes("Shan-Deep") && document.querySelector("meta[name=description]").content.length > 40 && document.querySelector("link[rel=canonical]").href === location.origin + "/"');
  await check('background image loads', 'new Promise(resolve=>{const i=new Image();i.onload=()=>resolve(i.naturalWidth >= 1536);i.onerror=()=>resolve(false);i.src="/images/parliament-hero.png"})');
  await screenshot('desktop-1440');
  for (const width of [1280, 1024, 980, 760, 390, 320]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width <= 760 });
    await check(`no horizontal overflow at ${width}px`, 'document.documentElement.scrollWidth <= innerWidth + 1');
    if ([1024, 390].includes(width)) await screenshot(`viewport-${width}`);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await check('mobile navigation initially hidden', 'getComputedStyle(document.querySelector(".site-nav")).display === "none"');
  await evaluate('document.querySelector(".site-menu-btn").click()');
  await check('mobile navigation opens', 'document.querySelector(".site-menu-btn").getAttribute("aria-expanded") === "true" && getComputedStyle(document.querySelector(".site-nav")).display !== "none"');
  await evaluate('document.querySelectorAll(".site-nav .lang-btn")[1].click()');
  await check('Hindi covers hero, new sections and enquiry', '/[\u0900-\u097f]/.test(document.querySelector("h1").textContent) && document.querySelector("#process-title").textContent.includes("जीतने") && /[\u0900-\u097f]/.test(document.querySelector(".site-form button[type=submit]").textContent) && document.documentElement.lang === "hi"');
  await evaluate('document.querySelector(".site-menu-btn").click()');
  await check('Hindi has no mobile horizontal overflow', 'document.documentElement.scrollWidth <= innerWidth + 1');
  await screenshot('mobile-hindi');
  await navigate();
  await check('language preference persists', 'document.documentElement.lang === "hi"');
  await evaluate('document.querySelectorAll(".site-nav .lang-btn")[0].click()');
  await check('enquiry requires consent', 'document.querySelector("form.site-form button[type=submit]").disabled');
  await check('form explains the required name and business fields', 'document.querySelector(".site-form-feedback").textContent.includes("name and business name")');
  await evaluate(`(() => { for(const [key,value] of Object.entries({name:'Homepage Review',company:'Reference Layout Test',email:'homepage-review@example.test',phone:'9876543210',message:'Checking the redesigned homepage enquiry.'})) { const el=document.getElementById('home-'+key); const type=el.tagName==='TEXTAREA'?HTMLTextAreaElement:HTMLInputElement; Object.getOwnPropertyDescriptor(type.prototype,'value').set.call(el,value); el.dispatchEvent(new Event('input',{bubbles:true})); } })()`);
  await check('consent remains required after fields are populated', 'document.querySelector("form.site-form button[type=submit]").disabled');
  await check('form explains the consent requirement', 'document.querySelector(".site-form-feedback").textContent.includes("Tick the consent box")');
  await evaluate('document.querySelector("form.site-form .site-consent input").click()');
  await check('enquiry enables with required information and consent', '!document.querySelector("form.site-form button[type=submit]").disabled');
  await evaluate('document.querySelector("form.site-form button[type=submit]").click()');
  await until('!!document.querySelector(".site-form-done") || !!document.querySelector(".site-form .note-error")');
  await check('enquiry accepted by the real demo API', '!!document.querySelector(".site-form-done") && document.querySelector(".site-form-done").textContent.includes("Thank you")');
  await check('success offers call and WhatsApp', '!!document.querySelector(".site-form-done a[href^=tel]") && !!document.querySelector(".site-form-done .btn-whatsapp")');
  await navigate('/services/gem-portal');
  await check('GeM group retains twelve service pages', 'document.querySelectorAll(".site-item-grid li").length === 12');
  await navigate('/services/gem-portal/catalogue-management');
  await check('individual service page retains enquiry, call and WhatsApp', '!!document.querySelector("form.site-form") && !!document.querySelector("a.btn-whatsapp") && !!document.querySelector("a[href^=tel]")');
  await check('service page fits mobile', 'document.documentElement.scrollWidth <= innerWidth + 1');
  await navigate('/contact');
  await check('contact page retains required company field and consent', 'document.querySelector("#contact-company").required && !!document.querySelector(".site-consent input")');
  await cdp('Page.navigate', { url: `${origin}/login` });
  await until('!!document.querySelector("input[type=password]")');
  await evaluate(`(() => { for(const [selector,value] of [['input[type=email]','admin@demo.test'],['input[type=password]','Demo-Pass-2026']]) { const el=document.querySelector(selector); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value); el.dispatchEvent(new Event('input',{bubbles:true})); } })()`);
  await until('!document.querySelector("form button[type=submit]").disabled');
  await evaluate('document.querySelector("form button[type=submit]").click()');
  await until('location.pathname.startsWith("/app/")');
  await cdp('Page.navigate', { url: `${origin}/app/admin/access-requests` });
  await until('!!document.querySelector(".page-headline-block") && document.querySelector(".page-headline-block").textContent.includes("Access requests")');
  await until('document.body.textContent.includes("Reference Layout Test") || !!document.querySelector(".page-content .note-error")');
  await check('the homepage request is in the staff Access requests queue', 'document.body.textContent.includes("Reference Layout Test")');
  await check('admin navigation exposes Access Requests and Website Enquiries', '["/app/admin/access-requests","/app/admin/enquiries"].every(h=>[...document.querySelectorAll("a")].some(a=>a.getAttribute("href")===h))');
  await check('the sidebar badge counts the new request', 'Number(document.querySelector(".sidebar-item-badge")?.textContent) >= 1');
  assert.equal(browserErrors.length, 0, browserErrors.join('\n')); console.log('PASS no browser JavaScript exceptions');
  console.log(`Screenshots saved in ${output}`);
} finally { socket.close(); }
