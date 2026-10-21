/**
 * Baseline data: Shan-Deep's own (staff) organization, the starter master
 * lists, and the first platform administrator. Safe to run repeatedly: it only
 * inserts what is missing, so anything the client has since edited stays put.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoResults, demoTenders } from '../../seed/demoData.js';
import { CATEGORIES, CITIES, DEPARTMENTS, STATES } from '../../seed/masters.js';
import { loadProfileContext, sendDigestForProfile } from '../services/alerts/digest.js';
import { createProfile, createProfileSchema } from '../services/alerts/profiles.js';
import { addPrebid, assignCase, createCase, moveStage, saveInternal, saveResult, saveSubmission, updateCase, updateChecklistItem } from '../services/cases.js';
import { generateBundle, releaseBundle } from '../services/bundle/index.js';
import { addDays, previousWeekStart } from '../services/bundle/period.js';
import { loadMasterIndex } from '../services/ingestion/masters.js';
import { normalizeTenderbookResult, normalizeTenderbookTender } from '../services/ingestion/normalize.js';
import { upsertAward, upsertTender } from '../services/ingestion/store.js';
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

/** Three sample submission-desk cases at different points of the workflow. */
async function seedDemoCases(q, orgId) {
  if ((await q.one('SELECT count(*)::int AS n FROM submission_cases WHERE organization_id = $1', [orgId])).n) return;
  const person = async (email) => {
    const u = await q.one('SELECT id, name, email, organization_id AS "orgId", role FROM users WHERE email = $1', [email]);
    return { user: u, ip: null, canReopen: true };
  };
  const client = await person('owner@demo.test');
  const manager = await person('manager@demo.test');
  const tenders = await q.many(`SELECT id FROM tenders WHERE status = 'Open' AND submission_deadline > now() + interval '4 days' ORDER BY submission_deadline LIMIT 3`);
  const base = config.publicBaseUrl;
  const opts = { orgId, baseUrl: base };

  const a = await createCase(q, client, { ...opts, tenderId: tenders[0]?.id, title: 'Sample request A', note: 'Please check whether our turnover qualifies.' });
  await assignCase(q, manager, a, manager.user.id);
  await updateCase(q, manager, a, { clientSummary: 'Works tender, 18 months. Needs Class A registration and two similar works of 40% value. Our check shows turnover qualifies.' });
  await moveStage(q, manager, a, 'detail_study');
  await moveStage(q, manager, a, 'eligibility');
  const checks = await q.many(`SELECT id FROM submission_case_checklists WHERE case_id = $1 AND kind = 'eligibility' ORDER BY id LIMIT 3`, [a]);
  for (const c of checks) await updateChecklistItem(q, manager, a, c.id, { status: 'pass' });
  await addPrebid(q, manager, a, 'Is a joint venture permitted for this tender?');
  await saveInternal(q, manager, a, { financialStrategy: 'Quote about 7% below the estimate; recent winning bids in this department sit there.', marginNotes: 'Expected margin 11%' });

  if (tenders[1]) {
    await createCase(q, client, { ...opts, tenderId: tenders[1].id, note: 'Urgent, deadline is close.' });
  }
  const closed = await createCase(q, client, { ...opts, title: 'Sample request C: supply of transformers, completed example' });
  await assignCase(q, manager, closed, manager.user.id);
  await saveSubmission(q, manager, closed, { mode: 'online', portalReference: 'MPT-2026-DEMO-17' });
  await saveResult(q, manager, closed, { technicalStatus: 'qualified', financialStatus: 'evaluated', outcome: 'not_l1', ourAmount: 5_100_000, l1Amount: 4_900_000, resultDate: new Date().toISOString().slice(0, 10) });
  await moveStage(q, manager, closed, 'follow_up');
}

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
    const index = await loadMasterIndex(q);
    let tenders = 0;
    for (const dto of demoTenders()) {
      const { record, problems } = normalizeTenderbookTender(dto);
      if (!problems.length && (await upsertTender(q, 'excel', record, index, dto)) === 'inserted') tenders++;
    }
    let results = 0;
    for (const dto of demoResults()) {
      const { record, problems } = normalizeTenderbookResult(dto);
      if (!problems.length && (await upsertAward(q, 'excel', record, index, dto)) === 'inserted') results++;
    }
    // Two sample alerts for the demo client, each with a first digest so flags and counts have something to show.
    const existingProfiles = (await q.one('SELECT count(*)::int AS n FROM alert_profiles WHERE organization_id = $1', [demoOrg.id])).n;
    if (existingProfiles === 0) {
      const owner = await q.one(`SELECT id, email FROM users WHERE email = 'owner@demo.test'`);
      const idOf = async (table, name) => (await q.maybeOne(`SELECT id FROM ${table} WHERE name = $1`, [name]))?.id;
      const civil = await idOf('tender_categories', 'Civil Works & Infrastructure');
      const phed = await idOf('departments', 'Public Health Engineering Department');
      const states = (await q.many(`SELECT id FROM states WHERE name IN ('Madhya Pradesh', 'Maharashtra', 'Gujarat')`)).map((s) => s.id);
      const samples = [
        { name: 'Roads, bridges & highways', keywords: ['road', 'highway', 'bridge'], excludeKeywords: ['cctv'], categoryIds: civil ? [civil] : [] },
        { name: 'Smart water & AMR meters', keywords: ['water meter', 'ultrasonic', 'amr'], departmentIds: phed ? [phed] : [], stateIds: states },
      ];
      for (const sample of samples) {
        const view = await createProfile(q, { user: null }, { orgId: demoOrg.id, userId: owner.id, userEmail: owner.email }, createProfileSchema.parse(sample));
        const profile = await loadProfileContext(q, view.id);
        await sendDigestForProfile(q, profile, { baseUrl: config.publicBaseUrl });
      }
    }
    await seedDemoCases(q, demoOrg.id);
    // The last two weekly reports, generated and released, so the Reports locker has something to open.
    const lastWeek = previousWeekStart();
    for (const periodStart of [addDays(lastWeek, -7), lastWeek]) {
      const bundleId = await generateBundle(q, { id: demoOrg.id, name: 'Demo Infra Projects Pvt Ltd' }, periodStart);
      await releaseBundle(q, { user: null }, bundleId);
    }
    return { demoOrgId: demoOrg.id, tenders, results, accounts: people.map(([, , email, role]) => ({ email, role })) };
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
      console.log(`Demo data: ${demo.tenders} tenders, ${demo.results} results.`);
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
