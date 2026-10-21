import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import request from 'supertest';
import { serveFrontend } from '../src/app.js';

describe('serving the built website', () => {
  let dir, app;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
    fs.writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    fs.writeFileSync(path.join(dir, 'robots.txt'), 'User-agent: *');
    app = express();
    app.get('/api/v1/ping', (req, res) => res.json({ ok: true }));
    serveFrontend(app, dir);
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('serves the page at the addresses the app knows, with no caching so a new release shows at once', async () => {
    for (const p of ['/', '/services', '/services/gem-portal/catalogue-management', '/about', '/contact', '/login', '/app/admin/reports']) {
      const res = await request(app).get(p).set('Accept', 'text/html');
      assert.equal(res.status, 200, p);
      assert.match(res.text, /id="root"/);
      assert.equal(res.headers['cache-control'], 'no-cache');
    }
  });

  it('returns a true 404 status for addresses that do not exist (still showing the friendly page)', async () => {
    const res = await request(app).get('/wp-admin/setup.php').set('Accept', 'text/html');
    assert.equal(res.status, 404);
    assert.match(res.text, /id="root"/);
  });

  it('caches hashed build files for a year and serves other static files normally', async () => {
    const asset = await request(app).get('/assets/app-abc123.js');
    assert.equal(asset.status, 200);
    assert.match(asset.headers['cache-control'], /max-age=31536000, immutable/);
    assert.equal((await request(app).get('/robots.txt')).status, 200);
  });

  it('leaves the API alone: its own answers and its own JSON 404', async () => {
    assert.deepEqual((await request(app).get('/api/v1/ping')).body, { ok: true });
    const missing = await request(app).get('/api/v1/nothing-here').set('Accept', 'text/html');
    assert.doesNotMatch(missing.text ?? '', /id="root"/);
  });

  it('does not serve the page to non-browser requests for unknown paths', async () => {
    const res = await request(app).get('/no/such/file.json').set('Accept', 'application/json');
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.text, /id="root"/);
  });

  it('refuses to climb out of the site folder', async () => {
    const res = await request(app).get('/..%2f..%2fetc/passwd').set('Accept', 'text/html');
    assert.ok(!res.text.includes('root:x'));
  });
});
