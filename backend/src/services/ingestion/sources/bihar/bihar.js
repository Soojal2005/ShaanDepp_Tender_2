/**
 * Crawler client for Bihar's e-Procurement portal (eproc2.bihar.gov.in, EPSV2).
 *
 * Bihar runs an AngularJS 1.x + Struts app. The public tender listing page
 * loads tenders via XHR to /rest/openarea/getTenderList (and related endpoints).
 * The JWT used for auth is generated dynamically by AngularJS (not in the static
 * HTML), so we use Playwright to:
 *   1. Load the page and let AngularJS initialise
 *   2. Intercept the XHR responses to capture the raw JSON tender data
 *   3. Fall back to scraping the rendered DOM if interception misses
 *
 * Playwright also handles Bihar's broken SSL certificate chain (ignoreHTTPSErrors).
 *
 * Each tender object is reshaped (parseBiharTender) into the same dto shape
 * the shared normalizer (normalizeCpppTender) understands.
 *
 * parseBiharTender is pure and exported for fixture-based tests.
 */
import { config } from '../../../../config.js';
import { log } from '../../../../log.js';
import { cleanText } from '../../normalize.js';
import { SourceError } from '../../tenderbook.js';

const IST_OFFSET_MS = 5.5 * 3600_000;

/**
 * Convert a Bihar API date value to a string toCpppDate can parse.
 * The Java/AngularJS API returns dates as epoch milliseconds (numbers).
 * toCpppDate expects "DD-MM-YYYY HH:MM:SS" (interpreted as IST).
 */
export function toBiharDateStr(val) {
  if (val == null || val === '' || val === 0) return null;
  // Epoch milliseconds (number or numeric string)
  if (typeof val === 'number' || /^\d{10,13}$/.test(String(val))) {
    const ms = Number(val);
    if (ms > 946684800000 && ms < 4102444800000) {
      const d = new Date(ms + IST_OFFSET_MS);
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    }
  }
  // "YYYY-MM-DD HH:mm" or "YYYY-MM-DD" → flip to "DD-MM-YYYY HH:mm"
  const iso = String(val);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}${m[4] ? ' ' + m[4] : ''}`;
  return cleanText(iso) || null;
}

/**
 * Turn one tender object from the Bihar REST API into a dto for normalizeCpppTender.
 *
 * API fields (from AngularJS template bindings):
 *   currenttenderid, currenttenderrefno, currentdescription,
 *   currentdeptid, currentorgid, currentTenderPublishDate,
 *   currentbidStartDate, currentbidEndDate, pacamt
 */
export function parseBiharTender(obj, state = 'Bihar') {
  const tenderId = cleanText(String(obj.currenttenderid ?? obj.currentTenderId ?? '')) || null;
  const refNo = cleanText(obj.currenttenderrefno ?? obj.currentTenderRefNo) || null;
  const title = cleanText(obj.currentdescription ?? obj.currentDescription) || null;
  const department = cleanText(obj.orgName ?? obj.deptName)
    || cleanText(obj.currentorgid ?? obj.currentOrgId)
    || null;
  const publishedDate = toBiharDateStr(obj.currentTenderPublishDate) || null;
  const closingDate = toBiharDateStr(obj.currentbidEndDate ?? obj.currentBidEndDate) || null;
  // pacamt is the estimated value (PAC = Probable Amount of Contract)
  const tenderValue = obj.pacamt != null && obj.pacamt !== '' && obj.pacamt !== 0
    ? String(obj.pacamt) : null;

  return { tenderId, refNo, title, organisationChain: department, publishedDate, closingDate, tenderValue, state };
}

async function launchChromium({ headless = true, launchImpl = null } = {}) {
  if (launchImpl) return launchImpl();
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { throw new SourceError('Playwright is not installed. Run `npm i playwright && npx playwright install chromium`.'); }
  return chromium.launch({ headless, executablePath: config.crawler?.chromiumPath || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}

/**
 * Build the Bihar client. Same interface as the other crawlers:
 * tenders({ page }) -> { content, totalElements, totalPages, page }.
 */
export function createBiharClient(opts = {}) {
  const {
    baseUrl = 'https://eproc2.bihar.gov.in',
    state = 'Bihar',
    timeoutMs = config.crawler?.timeoutMs ?? 45_000,
    requestDelayMs = config.crawler?.requestDelayMs ?? 1_500,
    headless = true,
    launchImpl = null,
  } = opts;

  async function tenders({ page = 0 } = {}) {
    if (page > 0) return { content: [], totalElements: 0, totalPages: 1, page };
    const browser = await launchChromium({ headless, launchImpl });
    try {
      // ignoreHTTPSErrors handles Bihar's broken SSL certificate chain.
      const ctx = await browser.newContext({ locale: 'en-IN', ignoreHTTPSErrors: true });
      const pg = await ctx.newPage();
      pg.setDefaultTimeout(timeoutMs * 2);

      // Intercept XHR responses to capture the raw JSON tender data.
      const captured = [];
      pg.on('response', async (response) => {
        const url = response.url();
        if (url.includes('/rest/openarea/') && url.includes('Tender')) {
          try {
            const json = await response.json();
            captured.push({ url, data: json });
          } catch { /* not JSON, ignore */ }
        }
      });

      // Step 1: load the public tender listing page.
      log.info('bihar loading page', { baseUrl });
      await pg.goto(`${baseUrl}/EPSV2Web/openarea/tenderListingPage.action`, {
        waitUntil: 'networkidle', timeout: timeoutMs,
      }).catch((e) => log.warn('bihar nav partial', { error: e.message }));

      // Step 2: wait for AngularJS to render tenders.
      // The page uses {{tender.currentOrgTenderId}} bindings. Wait for those to resolve.
      const rendered = await pg.waitForFunction(
        () => {
          // Check that AngularJS has rendered (no {{ in the tender list area)
          const body = document.body?.innerText || '';
          return !body.includes('{{') && body.length > 500;
        },
        { timeout: timeoutMs },
      ).then(() => true).catch(() => false);

      if (!rendered) {
        log.warn('bihar angularjs did not finish rendering');
      }

      // Give AngularJS a moment for any remaining XHRs.
      await pg.waitForTimeout(3000);

      // Step 3: collect from intercepted API responses.
      const byId = new Map();
      for (const { data } of captured) {
        const list = Array.isArray(data) ? data
          : Array.isArray(data?.tenderList) ? data.tenderList
          : Array.isArray(data?.data) ? data.data
          : [];
        for (const raw of list) {
          const dto = parseBiharTender(raw, state);
          if (dto.tenderId && !byId.has(dto.tenderId)) byId.set(dto.tenderId, dto);
        }
      }
      log.info('bihar intercepted api responses', { captured: captured.length, tenders: byId.size });

      // Step 4: if interception didn't catch enough, try extracting from the AngularJS scope.
      if (byId.size === 0) {
        log.info('bihar falling back to scope extraction');
        const scopeData = await pg.evaluate(() => {
          try {
            // Access AngularJS scope from the tender list element
            const el = document.querySelector('[ng-controller*="openareaTenderList"]')
              || document.querySelector('[ng-controller]')
              || document.querySelector('.table-responsive');
            if (!el) return [];
            const scope = window.angular?.element(el)?.scope?.();
            if (!scope) return [];
            // The controller stores tenders in scope.tenderList or similar
            const list = scope.tenderList || scope.tenders || scope.openareaTenderList || [];
            return Array.isArray(list) ? list : [];
          } catch { return []; }
        }).catch(() => []);

        for (const raw of scopeData) {
          const dto = parseBiharTender(raw, state);
          if (dto.tenderId && !byId.has(dto.tenderId)) byId.set(dto.tenderId, dto);
        }
        log.info('bihar scope extraction', { tenders: byId.size });
      }

      // Step 5: if still empty, scrape the rendered table rows as last resort.
      if (byId.size === 0) {
        log.info('bihar falling back to DOM scraping');
        const rows = await pg.evaluate(() => {
          const results = [];
          document.querySelectorAll('table tbody tr, .tender-row').forEach((tr) => {
            const cells = tr.querySelectorAll('td');
            if (cells.length >= 3) {
              results.push({
                currenttenderid: cells[0]?.textContent?.trim(),
                currenttenderrefno: cells[1]?.textContent?.trim(),
                currentdescription: cells[2]?.textContent?.trim(),
                currentbidEndDate: cells[3]?.textContent?.trim() || null,
                pacamt: null,
              });
            }
          });
          return results;
        }).catch(() => []);

        for (const raw of rows) {
          const dto = parseBiharTender(raw, state);
          if (dto.tenderId && !byId.has(dto.tenderId)) byId.set(dto.tenderId, dto);
        }
        log.info('bihar DOM scrape', { tenders: byId.size });
      }

      // Step 6: try clicking "Upcoming" tab for additional tenders.
      if (byId.size > 0 && requestDelayMs > 0) {
        try {
          await new Promise((r) => setTimeout(r, requestDelayMs));
          const clicked = await pg.evaluate(() => {
            const tabs = [...document.querySelectorAll('a, li, [ng-click]')];
            const upcomingTab = tabs.find((el) =>
              /upcoming/i.test(el.textContent || '') || /upcoming/i.test(el.getAttribute('ng-click') || '')
            );
            if (upcomingTab) { upcomingTab.click(); return true; }
            return false;
          }).catch(() => false);

          if (clicked) {
            await pg.waitForTimeout(4000);
            // Check for new intercepted data
            for (const { data } of captured) {
              const list = Array.isArray(data) ? data
                : Array.isArray(data?.tenderList) ? data.tenderList
                : Array.isArray(data?.data) ? data.data
                : [];
              for (const raw of list) {
                const dto = parseBiharTender(raw, state);
                if (dto.tenderId && !byId.has(dto.tenderId)) byId.set(dto.tenderId, dto);
              }
            }
          }
        } catch (e) {
          log.warn('bihar upcoming tab failed (non-fatal)', { error: e.message });
        }
      }

      const content = [...byId.values()];
      if (!content.length) throw new SourceError('Bihar returned no parseable tenders.');
      log.info('bihar crawl complete', { baseUrl, total: content.length });
      return { content, totalElements: content.length, totalPages: 1, page: 0 };
    } finally {
      await browser.close().catch(() => {});
    }
  }

  return { tenders };
}
