/**
 * Generating and releasing weekly bundles.
 *
 * Generation is automatic every Monday for every client organization. A bundle
 * is NOT visible to the client, and NOT emailed, until staff release it (to one
 * client, or in bulk to everyone on a plan). Each release is written to an
 * append-only log. The database enforces the visibility rule itself (see the
 * report_bundles row-level-security policy), not just this code.
 */
import { badRequest, notFound } from '../../errors.js';
import { audit } from '../audit.js';
import { button, emailShell, esc } from '../mail/html.js';
import { enqueueEmail } from '../mail/queue.js';
import { computeBundle } from './compute.js';
import { isMonday, previousWeekStart } from './period.js';

export const bundleTitle = (snapshot) => `Weekly tender intelligence · ${snapshot.period.label}`;

/** Create or refresh one organization's bundle for a week. Returns the bundle id. */
export async function generateBundle(q, org, periodStart, { now = new Date() } = {}) {
  if (!isMonday(periodStart)) throw badRequest('A weekly period must start on a Monday');
  const snapshot = await computeBundle(q, org, periodStart, { now });
  const row = await q.one(
    `INSERT INTO report_bundles (organization_id, period_start, period_end, title, snapshot, status, generated_at)
     VALUES ($1, $2::date, $2::date + 6, $3, $4::jsonb, 'generated', now())
     ON CONFLICT (organization_id, period_start)
     DO UPDATE SET snapshot = EXCLUDED.snapshot, title = EXCLUDED.title, generated_at = now(), status = 'generated'
     RETURNING id`,
    [org.id, periodStart, bundleTitle(snapshot), JSON.stringify(snapshot)]
  );
  return row.id;
}

/** Generate for every active client organization (or one). Each runs on its own so one failure does not stop the rest. */
export async function generateForOrganizations(db, { periodStart = previousWeekStart(), orgId = null, now = new Date() } = {}) {
  const orgs = await db.withContext({ scope: 'system' }, (q) =>
    q.many(`SELECT id, name FROM organizations WHERE status = 'Active' AND NOT is_staff_org AND ($1::int IS NULL OR id = $1) ORDER BY id`, [orgId]));
  const result = { periodStart, generated: 0, failed: 0, errors: [] };
  for (const org of orgs) {
    try {
      await db.withContext({ scope: 'system' }, (q) => generateBundle(q, org, periodStart, { now }));
      result.generated++;
    } catch (err) {
      result.failed++;
      result.errors.push(`${org.name}: ${err.message}`);
    }
  }
  return result;
}

async function notifyAdmins(q, { orgId, snapshot, baseUrl }) {
  const admins = await q.many(`SELECT email, name FROM users WHERE organization_id = $1 AND is_active AND role = 'tenant_admin'`, [orgId]);
  for (const a of admins) {
    const html = emailShell({
      title: 'Your weekly report is ready',
      bodyHtml: `<p style="font-size:15px;">Hello ${esc(a.name)},</p>
        <p style="font-size:13.5px;color:#475569;">Your tender intelligence report for <b>${esc(snapshot.period.label)}</b> is now in your Reports locker, as interactive charts, a PDF and an Excel sheet.</p>
        <p>${button('Open reports', `${baseUrl}/app/reports`)}</p>`,
    });
    await enqueueEmail(q, { orgId, kind: 'bundle_notice', to: a.email, subject: `Your weekly report is ready (${snapshot.period.label})`, html, idempotencyKey: `bundle-notice:${orgId}:${snapshot.period.start}:${a.email}` });
  }
}

/** Release one bundle to its own client. Idempotent: releasing twice records once. */
export async function releaseBundle(q, actor, bundleId, { notify = false, baseUrl } = {}) {
  const bundle = await q.maybeOne('SELECT id, organization_id, title, snapshot FROM report_bundles WHERE id = $1', [bundleId]);
  if (!bundle) throw notFound('Bundle not found');
  const row = await q.maybeOne(
    `INSERT INTO report_releases (organization_id, bundle_id, bundle_title, scope, released_by_user_id, released_by_name)
     VALUES ($1, $2, $3, 'client', $4, $5) ON CONFLICT (organization_id, bundle_id) DO NOTHING RETURNING id`,
    [bundle.organization_id, bundle.id, bundle.title, actor.user?.id ?? null, actor.user?.name ?? null]
  );
  if (row) {
    await audit(q, actor, 'report.release', 'report_bundle', bundle.id, { orgId: bundle.organization_id, scope: 'client' });
    if (notify) await notifyAdmins(q, { orgId: bundle.organization_id, snapshot: bundle.snapshot, baseUrl });
  }
  return { released: Boolean(row), orgId: bundle.organization_id };
}

/** Release a week's bundle to every active organization on a plan. */
export async function releaseToPlan(q, actor, { planCode, periodStart, notify = false, baseUrl }) {
  const plan = await q.maybeOne('SELECT id, code FROM plans WHERE code = $1', [planCode]);
  if (!plan) throw badRequest(`Unknown plan: ${planCode}`);
  const bundles = await q.many(
    `SELECT b.id, b.organization_id, b.title, b.snapshot FROM report_bundles b JOIN organizations o ON o.id = b.organization_id
      WHERE o.plan_id = $1 AND o.status = 'Active' AND b.period_start = $2::date`, [plan.id, periodStart]);
  let released = 0;
  for (const b of bundles) {
    const row = await q.maybeOne(
      `INSERT INTO report_releases (organization_id, bundle_id, bundle_title, scope, plan_code, released_by_user_id, released_by_name)
       VALUES ($1, $2, $3, 'plan', $4, $5, $6) ON CONFLICT (organization_id, bundle_id) DO NOTHING RETURNING id`,
      [b.organization_id, b.id, b.title, plan.code, actor.user?.id ?? null, actor.user?.name ?? null]
    );
    if (row) {
      released++;
      if (notify) await notifyAdmins(q, { orgId: b.organization_id, snapshot: b.snapshot, baseUrl });
    }
  }
  await audit(q, actor, 'report.release_plan', 'plan', plan.code, { periodStart, bundles: bundles.length, released });
  return { bundles: bundles.length, released, alreadyReleased: bundles.length - released };
}
