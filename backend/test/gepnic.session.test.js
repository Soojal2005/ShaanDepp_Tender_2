import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GepnicSessionManager, SessionError } from '../src/services/gepnic/sessionManager.js';
import { DocumentUnavailableError, fetchTenderDocumentWithRetry } from '../src/services/gepnic/download.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORTAL = { id: 'cppp', baseUrl: 'https://eprocure.gov.in', startPath: '/eprocure/app', listPath: '/eprocure/app?page=FrontEndListTendersbyDate&service=page', tableSelector: '#table' };

/** A fake Playwright browser just rich enough for the session manager. */
function fakeBrowserFactory() {
  const state = { launches: 0 };
  const launchImpl = () => {
    state.launches++;
    const browser = {
      connected: true,
      isConnected: () => browser.connected,
      newContext: async () => ({
        newPage: async () => ({
          goto: async () => {},
          close: async () => {},
          $: async () => ({}),            // health check: table present
          setDefaultTimeout: () => {},
          waitForTimeout: async () => {},
        }),
        close: async () => {},
      }),
      close: async () => { browser.connected = false; },
    };
    return browser;
  };
  return { state, launchImpl };
}

describe('GepnicSessionManager lifecycle', () => {
  it('initializes once and reuses the same context', async () => {
    const { state, launchImpl } = fakeBrowserFactory();
    const m = new GepnicSessionManager({ launchImpl, maxConcurrent: 2 });
    await m.ensurePortal(PORTAL);
    await m.ensurePortal(PORTAL);
    assert.equal(state.launches, 1, 'second ensurePortal reuses the warm context');
    await m.shutdown();
  });

  it('runs work on a pooled page and returns its result', async () => {
    const { launchImpl } = fakeBrowserFactory();
    const m = new GepnicSessionManager({ launchImpl });
    const out = await m.executeWithPage(PORTAL, async (page) => { assert.ok(page); return 'done'; });
    assert.equal(out, 'done');
    await m.shutdown();
  });

  it('caps concurrency so a second request waits for the first', async () => {
    const { launchImpl } = fakeBrowserFactory();
    const m = new GepnicSessionManager({ launchImpl, maxConcurrent: 1 });
    const order = [];
    const a = m.executeWithPage(PORTAL, async () => { order.push('a-start'); await sleep(40); order.push('a-end'); });
    const b = m.executeWithPage(PORTAL, async () => { order.push('b-start'); });
    await Promise.all([a, b]);
    assert.deepEqual(order, ['a-start', 'a-end', 'b-start'], 'b only runs after a releases the slot');
    await m.shutdown();
  });

  it('reports a healthy session after init', async () => {
    const { launchImpl } = fakeBrowserFactory();
    const m = new GepnicSessionManager({ launchImpl, healthIntervalMs: 60000 });
    await m.ensurePortal(PORTAL);
    assert.equal(await m.checkHealth(PORTAL), true);
    await m.shutdown();
  });

  it('relaunches after a browser crash/disconnect', async () => {
    const { state, launchImpl } = fakeBrowserFactory();
    const m = new GepnicSessionManager({ launchImpl });
    await m.ensurePortal(PORTAL);
    const st = m.portals.get(PORTAL.baseUrl);
    st.browser.connected = false; // simulate a crash
    await m.executeWithPage(PORTAL, async () => 'ok');
    assert.equal(state.launches, 2, 'a dead browser is rebuilt on next use');
    await m.shutdown();
  });

  it('refreshes by launching a new browser', async () => {
    const { state, launchImpl } = fakeBrowserFactory();
    const m = new GepnicSessionManager({ launchImpl });
    await m.ensurePortal(PORTAL);
    await m.refresh(PORTAL);
    assert.equal(state.launches, 2);
    await m.shutdown();
  });

  it('rejects work after shutdown', async () => {
    const { launchImpl } = fakeBrowserFactory();
    const m = new GepnicSessionManager({ launchImpl });
    await m.ensurePortal(PORTAL);
    await m.shutdown();
    await assert.rejects(m.executeWithPage(PORTAL, async () => 'x'), (e) => e instanceof SessionError);
  });
});

describe('download retry orchestration', () => {
  // Stub manager: executeWithPage ignores the navigation fn and yields a scripted
  // outcome, so we test the retry/refresh wrapper without a full browser fake.
  const stubManager = (outcomes) => {
    const calls = { exec: 0, refresh: 0 };
    return {
      calls,
      executeWithPage: async () => {
        const o = outcomes[calls.exec++];
        if (o instanceof Error) throw o;
        return o;
      },
      refresh: async () => { calls.refresh++; },
    };
  };

  it('retries once after a session error, refreshing in between', async () => {
    const m = stubManager([new SessionError('session gone'), { tempPath: '/tmp/x.pdf', filename: 'x.pdf' }]);
    const out = await fetchTenderDocumentWithRetry(m, { providerId: 'cppp', tenderSourceId: '2026_X_1', docName: 'NIT.pdf' });
    assert.deepEqual(out, { tempPath: '/tmp/x.pdf', filename: 'x.pdf' });
    assert.equal(m.calls.exec, 2, 'one retry');
    assert.equal(m.calls.refresh, 1, 'session refreshed before the retry');
  });

  it('does not retry when the document is genuinely unavailable', async () => {
    const m = stubManager([new DocumentUnavailableError('aged out')]);
    await assert.rejects(
      fetchTenderDocumentWithRetry(m, { providerId: 'cppp', tenderSourceId: '2026_X_2', docName: 'NIT.pdf' }),
      (e) => e instanceof DocumentUnavailableError,
    );
    assert.equal(m.calls.exec, 1, 'no retry');
    assert.equal(m.calls.refresh, 0, 'no refresh');
  });

  it('rejects an unknown (non-GePNIC) provider', async () => {
    const m = stubManager([]);
    await assert.rejects(
      fetchTenderDocumentWithRetry(m, { providerId: 'tenderbook', tenderSourceId: 'x', docName: 'y' }),
      (e) => e instanceof DocumentUnavailableError,
    );
  });
});
