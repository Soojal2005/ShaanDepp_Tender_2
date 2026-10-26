import { createDatabase } from '../src/db/index.js';
import { verifyPassword } from '../src/auth/password.js';

const emails = ['admin@demo.test', 'manager@demo.test', 'analyst@demo.test', 'owner@demo.test', 'subscriber@demo.test'];
const db = await createDatabase();
try {
  const identity = await db.admin.query('SELECT current_database() AS database, current_user AS role');
  const accounts = await db.withContext({ scope: 'system' }, (q) => q.many(
    `SELECT u.email, u.role, u.is_active, o.name AS organization, o.status AS organization_status,
            c.password_hash, c.locked_until
       FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id
       LEFT JOIN user_credentials c ON c.user_id = u.id
      WHERE u.email = ANY($1::text[])
      ORDER BY u.email`, [emails]
  ));
  const inventory = await db.withContext({ scope: 'system' }, async (q) => ({
    users: (await q.one('SELECT count(*)::int AS count FROM users')).count,
    staffOrganizations: await q.many('SELECT id, name, status FROM organizations WHERE is_staff_org'),
    demoOrganizations: await q.many("SELECT id, name, status FROM organizations WHERE name = 'Demo Infra Projects Pvt Ltd'"),
    standardPlans: await q.many("SELECT id, code FROM plans WHERE code = 'standard'"),
    sampleTenders: (await q.one("SELECT count(*)::int AS count FROM tenders WHERE provider_id = 'sample'")).count,
    sampleResults: (await q.one("SELECT count(*)::int AS count FROM historical_awards WHERE provider = 'sample'")).count,
  }));
  for (const account of accounts) {
    account.hasCredential = Boolean(account.password_hash);
    account.demoPasswordMatches = account.password_hash
      ? await verifyPassword('Demo-Pass-2026', account.password_hash) : false;
    account.locked = Boolean(account.locked_until && new Date(account.locked_until) > new Date());
    delete account.password_hash;
    delete account.locked_until;
  }
  console.log(JSON.stringify({ database: identity.rows[0], inventory, accounts }, null, 2));
} catch (error) {
  console.error(`${error.name}: ${error.message}`);
  for (const cause of error.errors || []) {
    console.error(`${cause.code || cause.name}: ${cause.message}`);
  }
  process.exitCode = 1;
} finally {
  await db.close();
}
