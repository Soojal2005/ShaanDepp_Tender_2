/**
 * Explicitly provision the five published demo-role logins on a selected
 * Supabase project. This does not run as part of production startup and never
 * changes an existing user's password or role.
 *
 * Usage: node scripts/seed-demo-accounts.mjs --project-ref=PROJECT_REF --apply
 */
import { config } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { DEMO_PASSWORD } from '../src/db/seed.js';

const projectRef = process.argv.find((arg) => arg.startsWith('--project-ref='))?.split('=')[1];
const apply = process.argv.includes('--apply');
const target = config.db.url ? new URL(config.db.url) : null;

if (!apply || !projectRef || !/^[a-z0-9]{20}$/.test(projectRef) ||
    config.db.driver !== 'pg' || !target ||
    !target.hostname.endsWith('.supabase.com') ||
    !target.username.endsWith(`.${projectRef}`)) {
  console.error('Refusing to seed: supply --apply and --project-ref=<matching Supabase project ref> with a PostgreSQL DATABASE_URL.');
  process.exit(1);
}

const people = [
  { name: 'Demo Platform Admin', email: 'admin@demo.test', role: 'platform_admin', org: 'staff' },
  { name: 'Vikram Joshi', email: 'analyst@demo.test', role: 'analyst', org: 'staff' },
  { name: 'Meera Case Manager', email: 'manager@demo.test', role: 'case_manager', org: 'staff' },
  { name: 'Ravi Kumar', email: 'owner@demo.test', role: 'tenant_admin', org: 'demo' },
  { name: 'Sanjay Verma', email: 'subscriber@demo.test', role: 'subscriber', org: 'demo' },
];

const db = await createDatabase();
try {
  const result = await db.withContext({ scope: 'system' }, async (q) => {
    const staff = await q.one('SELECT id FROM organizations WHERE is_staff_org AND status = $1', ['Active']);
    const plan = await q.one('SELECT id FROM plans WHERE code = $1', ['standard']);
    const existing = await q.many(
      `SELECT u.email, u.role, u.organization_id, c.password_hash
         FROM users u LEFT JOIN user_credentials c ON c.user_id = u.id
        WHERE u.email = ANY($1::text[])`,
      [people.map(({ email }) => email)]
    );
    const byEmail = new Map(existing.map((row) => [row.email, row]));
    for (const person of people) {
      const row = byEmail.get(person.email);
      if (row && (row.role !== person.role || !row.password_hash ||
        !(await verifyPassword(DEMO_PASSWORD, row.password_hash)))) {
        throw new Error(`Existing ${person.email} differs from the published demo login; no records changed.`);
      }
    }

    let demo = await q.maybeOne('SELECT id FROM organizations WHERE name = $1', ['Demo Infra Projects Pvt Ltd']);
    if (!demo) {
      demo = await q.one(
        `INSERT INTO organizations (name, gstin, contact_name, plan_id, status)
         VALUES ($1, $2, $3, $4, 'Active') RETURNING id`,
        ['Demo Infra Projects Pvt Ltd', '23APSPT2592R1ZR', 'Ravi Kumar', plan.id]
      );
    }
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const created = [];
    for (const person of people) {
      const orgId = person.org === 'staff' ? staff.id : demo.id;
      const row = byEmail.get(person.email);
      if (row) {
        if (row.organization_id !== orgId) {
          throw new Error(`Existing ${person.email} has a different organization; no records changed.`);
        }
        continue;
      }
      const user = await q.one(
        'INSERT INTO users (organization_id, name, email, role) VALUES ($1, $2, $3, $4) RETURNING id',
        [orgId, person.name, person.email, person.role]
      );
      await q.query('INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)', [user.id, passwordHash]);
      created.push({ email: person.email, role: person.role });
    }
    return { created, alreadyPresent: people.length - created.length };
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`${error.name}: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
