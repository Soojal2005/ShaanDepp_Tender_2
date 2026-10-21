/**
 * Baseline data: Shan-Deep's own (staff) organization, the starter master
 * lists, and the first platform administrator. Safe to run repeatedly: it only
 * inserts what is missing, so anything the client has since edited stays put.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, CITIES, DEPARTMENTS, STATES } from '../../seed/masters.js';
import { hashPassword } from '../auth/password.js';
import { config } from '../config.js';
import { log } from '../log.js';
import { slugify } from '../util.js';
import { password as passwordRule } from '../validate.js';
import { createDatabase } from './index.js';
import { migrate } from './migrate.js';

const SYSTEM = { scope: 'system' };

export async function seedMasters(q) {
  for (const [name, nameHi, code, aliases] of STATES) {
    await q.query(
      `INSERT INTO states (name, name_hi, code, aliases) VALUES ($1, $2, $3, $4) ON CONFLICT (name) DO NOTHING`,
      [name, nameHi, code, aliases]
    );
  }
  for (const [state, city] of CITIES) {
    await q.query(
      `INSERT INTO cities (state_id, name) SELECT id, $2 FROM states WHERE name = $1 ON CONFLICT (state_id, name) DO NOTHING`,
      [state, city]
    );
  }
  for (const [name, nameHi, tier, aliases] of DEPARTMENTS) {
    await q.query(
      `INSERT INTO departments (slug, name, name_hi, tier, aliases) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (slug) DO NOTHING`,
      [slugify(name), name, nameHi, tier, aliases]
    );
  }
  for (const [name, nameHi, aliases] of CATEGORIES) {
    await q.query(
      `INSERT INTO tender_categories (slug, name, name_hi, aliases) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING`,
      [slugify(name), name, nameHi, aliases]
    );
  }
}

/** Returns the id of the staff organization, creating it on first run. */
export async function ensureStaffOrganization(q) {
  const existing = await q.maybeOne('SELECT id FROM organizations WHERE is_staff_org');
  if (existing) return existing.id;
  const row = await q.one(
    `INSERT INTO organizations (name, domain, is_staff_org, status)
     VALUES ('Shan-Deep Management Advisory', 'procure-brain.com', true, 'Active') RETURNING id`
  );
  return row.id;
}

/** Creates the first platform admin from BOOTSTRAP_ADMIN_* when no user exists with that email. */
export async function ensureBootstrapAdmin(q, orgId, { email, password, name } = config.bootstrapAdmin) {
  if (!email || !password) return null;
  const strength = passwordRule.safeParse(password);
  if (!strength.success) {
    throw new Error(`BOOTSTRAP_ADMIN_PASSWORD is too weak: ${strength.error.issues[0].message}`);
  }
  const existing = await q.maybeOne('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) return null;
  const user = await q.one(
    `INSERT INTO users (organization_id, name, email, role) VALUES ($1, $2, $3, 'platform_admin') RETURNING id`,
    [orgId, name, email]
  );
  await q.query('INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)', [
    user.id,
    await hashPassword(password),
  ]);
  return user.id;
}

export async function seedBaseline(db) {
  return db.withContext(SYSTEM, async (q) => {
    const orgId = await ensureStaffOrganization(q);
    await seedMasters(q);
    const adminId = await ensureBootstrapAdmin(q, orgId);
    if (adminId) log.info('bootstrap platform admin created', { email: config.bootstrapAdmin.email });
    return { staffOrgId: orgId, adminCreated: Boolean(adminId) };
  });
}

export const DEMO_PASSWORD = 'Demo-Pass-2026';

/**
 * Development-only sample accounts so every role can be tried locally. All use
 * DEMO_PASSWORD. Refuses to run in production.
 */
export async function seedDemo(db) {
  if (config.isProd) throw new Error('Demo data must never be created in production.');
  const hash = await hashPassword(DEMO_PASSWORD);
  return db.withContext(SYSTEM, async (q) => {
    const staffOrg = await ensureStaffOrganization(q);
    let demoOrg = await q.maybeOne(`SELECT id FROM organizations WHERE name = 'Demo Infra Projects Pvt Ltd'`);
    demoOrg ??= await q.one(
      `INSERT INTO organizations (name, gstin, contact_name, plan_id)
       VALUES ('Demo Infra Projects Pvt Ltd', '23APSPT2592R1ZR', 'Ravi Kumar', (SELECT id FROM plans WHERE code = 'standard'))
       RETURNING id`
    );
    const people = [
      [staffOrg, 'Demo Platform Admin', 'admin@demo.test', 'platform_admin'],
      [staffOrg, 'Vikram Joshi', 'analyst@demo.test', 'analyst'],
      [staffOrg, 'Meera Case Manager', 'manager@demo.test', 'case_manager'],
      [demoOrg.id, 'Ravi Kumar', 'owner@demo.test', 'tenant_admin'],
      [demoOrg.id, 'Sanjay Verma', 'subscriber@demo.test', 'subscriber'],
    ];
    for (const [orgId, name, email, role] of people) {
      const existing = await q.maybeOne('SELECT id FROM users WHERE email = $1', [email]);
      if (existing) continue;
      const user = await q.one(
        'INSERT INTO users (organization_id, name, email, role) VALUES ($1, $2, $3, $4) RETURNING id',
        [orgId, name, email, role]
      );
      await q.query('INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)', [user.id, hash]);
    }
    return { demoOrgId: demoOrg.id, accounts: people.map(([, , email, role]) => ({ email, role })) };
  });
}

// CLI: `npm run seed` (add --demo for development sample accounts)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = await createDatabase();
  try {
    await migrate(db);
    const result = await seedBaseline(db);
    console.log('Baseline ready.', result);
    if (!config.bootstrapAdmin.email) {
      console.log('Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD, then re-run, to create the first admin.');
    }
    if (process.argv.includes('--demo')) {
      const demo = await seedDemo(db);
      console.log(`Demo accounts created (password: ${DEMO_PASSWORD}):`);
      for (const a of demo.accounts) console.log(`  ${a.role.padEnd(15)} ${a.email}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
