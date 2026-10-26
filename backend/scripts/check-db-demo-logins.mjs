/** Exercise the real login route against the configured database. */
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db/index.js';
import { DEMO_PASSWORD } from '../src/db/seed.js';

const db = await createDatabase();
const app = createApp({ db, rateLimits: false });
try {
  const results = [];
  for (const email of ['admin@demo.test', 'manager@demo.test', 'analyst@demo.test', 'owner@demo.test', 'subscriber@demo.test']) {
    const response = await request(app).post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD });
    results.push({ email, status: response.status, role: response.body.user?.role || null });
  }
  console.log(JSON.stringify(results, null, 2));
  if (results.some(({ status }) => status !== 200)) process.exitCode = 1;
} catch (error) {
  console.error(`${error.name}: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
