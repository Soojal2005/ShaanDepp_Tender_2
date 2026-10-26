/** Check a deployed API without printing session cookies or CSRF tokens. */
import { DEMO_PASSWORD } from '../src/db/seed.js';

const base = process.argv.find((arg) => arg.startsWith('--url='))?.slice(6);
if (!base || !/^https:\/\/[^/]+$/.test(base)) {
  console.error('Usage: node scripts/check-live-demo-logins.mjs --url=https://your-site.example');
  process.exit(1);
}

const emails = ['admin@demo.test', 'manager@demo.test', 'analyst@demo.test', 'owner@demo.test', 'subscriber@demo.test'];
const results = [];
for (const email of emails) {
  try {
    const response = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: DEMO_PASSWORD }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await response.json().catch(() => ({}));
    const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
    const me = response.ok && cookie ? await fetch(`${base}/api/v1/auth/me`, {
      headers: { cookie },
      signal: AbortSignal.timeout(30000),
    }) : null;
    const meBody = me ? await me.json().catch(() => ({})) : {};
    results.push({ email, status: response.status, role: body.user?.role || null,
      sessionStatus: me?.status || null, sessionRole: meBody.user?.role || null,
      error: body.error?.message || body.message || null });
  } catch (error) {
    results.push({ email, error: `${error.name}: ${error.cause?.code || error.message}` });
  }
}
console.log(JSON.stringify(results, null, 2));
if (results.some((result) => result.status !== 200 || result.sessionStatus !== 200)) process.exitCode = 1;
