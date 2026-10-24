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
  await until('!!document.querySelector(".site-group-card")');
  await evaluate('localStorage.setItem("pb_lang", "EN")'); await navigate();
  await check('all eight service groups remain', 'document.querySelectorAll(".site-group-card").length === 8');
  await check('all 81 service offerings remain linked through their groups', '[...document.querySelectorAll(".site-group-foot")].reduce((n,e)=>n+parseInt(e.textContent),0) === 81');
  await check('registration and GST remain in both hero and footer', '[...document.querySelectorAll(".site-trust, .site-footer-registration")].every(e=>e.textContent.includes("BHOP260407SE000586") && e.textContent.includes("23APSPT2592R1ZR"))');
  await check('all four original detailed portal features remain', 'document.querySelectorAll(".site-portal-list li").length === 4 && document.querySelector(".site-portal-list").textContent.includes("150") && document.querySelector(".site-portal-list").textContent.includes("value and dates")');
  await check('all twelve original departments remain', 'document.querySelectorAll(".site-dept-wall li").length === 12');
  await check('all nine original process steps remain', 'document.querySelectorAll(".flow-step").length === 9');
  await evaluate('document.querySelector(".home-process details").open = true; document.querySelectorAll(".flow-step")[4].click()');
  await check('financial strategy step works', 'document.querySelector(".flow-detail").textContent.includes("Financial strategy")');
  await evaluate('document.querySelectorAll(".flow-step")[8].click()');
  await check('follow-up step works', 'document.querySelector(".flow-detail").textContent.includes("EMD refund")');
  await evaluate('document.querySelector(".home-process details").open = false');
  await check('three sample cards are explicitly marked synthetic', 'document.querySelectorAll(".home-sample-card").length === 3 && document.querySelector(".home-samples").textContent.includes("Synthetic")');
  await check('original contact and portal destinations remain', 'document.querySelector(".site-cta-row a.btn-ghost").getAttribute("href") === "/contact" && document.querySelector(".site-cta-row a.btn-primary").getAttribute("href") === "/login"');
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
  await check('Hindi covers hero, new sections and enquiry', '/[\u0900-\u097f]/.test(document.querySelector("h1").textContent) && document.querySelector("#process-title").textContent.includes("प्रक्रिया") && /[\u0900-\u097f]/.test(document.querySelector(".site-form button[type=submit]").textContent) && document.documentElement.lang === "hi"');
  await evaluate('document.querySelector(".site-menu-btn").click()');
  await check('Hindi has no mobile horizontal overflow', 'document.documentElement.scrollWidth <= innerWidth + 1');
  await screenshot('mobile-hindi');
  await navigate();
  await check('language preference persists', 'document.documentElement.lang === "hi"');
  await evaluate('document.querySelectorAll(".site-nav .lang-btn")[0].click()');
  await check('enquiry requires consent', 'document.querySelector("form.site-form button[type=submit]").disabled');
  await evaluate(`(() => { for(const [key,value] of Object.entries({name:'Homepage Review',company:'Reference Layout Test',email:'homepage-review@example.test',phone:'9876543210',message:'Checking the redesigned homepage enquiry.'})) { const el=document.getElementById('home-'+key); const type=el.tagName==='TEXTAREA'?HTMLTextAreaElement:HTMLInputElement; Object.getOwnPropertyDescriptor(type.prototype,'value').set.call(el,value); el.dispatchEvent(new Event('input',{bubbles:true})); } })()`);
  await check('consent remains required after fields are populated', 'document.querySelector("form.site-form button[type=submit]").disabled');
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
  assert.equal(browserErrors.length, 0, browserErrors.join('\n')); console.log('PASS no browser JavaScript exceptions');
  console.log(`Screenshots saved in ${output}`);
} finally { socket.close(); }
