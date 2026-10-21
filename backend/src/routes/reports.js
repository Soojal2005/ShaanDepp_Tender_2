import { Router } from 'express';
import { requireAuth, requirePermission, withSystemDb, withUserDb } from '../auth/middleware.js';
import { config } from '../config.js';
import { asyncHandler, badRequest, notFound } from '../errors.js';
import { actorOf } from '../services/audit.js';
import { generateForOrganizations, releaseBundle, releaseToPlan } from '../services/bundle/index.js';
import { isMonday, previousWeekStart } from '../services/bundle/period.js';
import { bundlePdf } from '../services/bundle/pdf.js';
import { bundleWorkbook } from '../services/bundle/xlsx.js';
import { id, parse, z } from '../validate.js';

const view = (r) => ({
  id: r.id, title: r.title, periodStart: r.period_start, periodEnd: r.period_end, generatedAt: r.generated_at,
  organizationId: r.organization_id, organization: r.organization_name, releasedAt: r.released_at ?? null,
});

const periodStart = z.string().refine(isMonday, 'must be a Monday (YYYY-MM-DD)');

/** The client's Reports locker. Row-level security shows a client only bundles that have been released to it. */
export function reportRoutes() {
  const r = Router();
  r.use(requireAuth);

  r.get('/bundles', asyncHandler(async (req, res) => {
    const rows = await withUserDb(req, (q) => q.many(
      `SELECT b.id, b.organization_id, b.title, b.period_start, b.period_end, b.generated_at, o.name AS organization_name, rel.released_at
         FROM report_bundles b JOIN organizations o ON o.id = b.organization_id
         JOIN report_releases rel ON rel.bundle_id = b.id AND rel.organization_id = b.organization_id
        WHERE b.organization_id = $1 ORDER BY b.period_start DESC LIMIT 100`, [req.auth.user.orgId]));
    res.json({ bundles: rows.map(view) });
  }));

  const load = async (req, bundleId) => {
    const row = await withUserDb(req, (q) => q.maybeOne('SELECT id, organization_id, title, period_start, snapshot FROM report_bundles WHERE id = $1 AND organization_id = $2', [bundleId, req.auth.user.orgId]));
    if (!row) throw notFound('Report not found');
    return row;
  };

  r.get('/bundles/:bundleId', asyncHandler(async (req, res) => {
    const { bundleId } = parse(z.object({ bundleId: id }), req.params);
    const row = await load(req, bundleId);
    res.json({ bundle: { id: row.id, title: row.title, snapshot: row.snapshot } });
  }));

  const download = (format, contentType, build) => asyncHandler(async (req, res) => {
    const { bundleId } = parse(z.object({ bundleId: id }), req.params);
    const row = await load(req, bundleId);
    const file = await build(row.snapshot);
    await withUserDb(req, (q) => q.query(
      'INSERT INTO report_downloads (bundle_id, organization_id, user_id, format) VALUES ($1, $2, $3, $4)', [row.id, req.auth.user.orgId, req.auth.user.id, format]));
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="weekly-tender-intelligence-${row.period_start}.${format}"`);
    res.send(file);
  });
  r.get('/bundles/:bundleId/pdf', download('pdf', 'application/pdf', bundlePdf));
  r.get('/bundles/:bundleId/xlsx', download('xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bundleWorkbook));

  return r;
}

/** Staff side: generate, review and release. */
export function adminReportRoutes() {
  const r = Router();

  r.get('/bundles', requirePermission('reports:release'), asyncHandler(async (req, res) => {
    const q2 = parse(z.object({ period: periodStart.optional(), orgId: z.coerce.number().int().positive().optional() }), req.query);
    const rows = await withSystemDb(req, (q) => q.many(
      `SELECT b.id, b.organization_id, b.title, b.period_start, b.period_end, b.generated_at, o.name AS organization_name, pl.code AS plan_code,
              (SELECT min(rel.released_at) FROM report_releases rel WHERE rel.bundle_id = b.id AND rel.organization_id = b.organization_id) AS released_at,
              (SELECT count(*)::int FROM report_downloads d WHERE d.bundle_id = b.id) AS downloads
         FROM report_bundles b JOIN organizations o ON o.id = b.organization_id LEFT JOIN plans pl ON pl.id = o.plan_id
        WHERE ($1::date IS NULL OR b.period_start = $1) AND ($2::int IS NULL OR b.organization_id = $2)
        ORDER BY b.period_start DESC, o.name LIMIT 300`, [q2.period ?? null, q2.orgId ?? null]));
    res.json({ bundles: rows.map((x) => ({ ...view(x), planCode: x.plan_code, downloads: x.downloads })), defaultPeriod: previousWeekStart() });
  }));

  r.get('/bundles/:bundleId', requirePermission('reports:release'), asyncHandler(async (req, res) => {
    const { bundleId } = parse(z.object({ bundleId: id }), req.params);
    const row = await withSystemDb(req, (q) => q.maybeOne('SELECT id, title, snapshot FROM report_bundles WHERE id = $1', [bundleId]));
    if (!row) throw notFound('Bundle not found');
    res.json({ bundle: { id: row.id, title: row.title, snapshot: row.snapshot } });
  }));

  r.post('/generate', requirePermission('reports:generate'), asyncHandler(async (req, res) => {
    const body = parse(z.object({ periodStart: periodStart.optional(), orgId: z.number().int().positive().optional() }), req.body);
    const result = await generateForOrganizations(req.app.locals.db, { periodStart: body.periodStart, orgId: body.orgId ?? null });
    res.json({ result });
  }));

  r.post('/release', requirePermission('reports:release'), asyncHandler(async (req, res) => {
    const body = parse(z.object({ bundleId: id.optional(), planCode: z.string().min(1).max(50).optional(), periodStart: periodStart.optional(), notify: z.boolean().default(false) })
      .refine((v) => v.bundleId || (v.planCode && v.periodStart), { message: 'Give a bundleId, or a planCode and periodStart' }), req.body);
    const out = await withSystemDb(req, (q) => (body.bundleId
      ? releaseBundle(q, actorOf(req), body.bundleId, { notify: body.notify, baseUrl: config.publicBaseUrl })
      : releaseToPlan(q, actorOf(req), { planCode: body.planCode, periodStart: body.periodStart, notify: body.notify, baseUrl: config.publicBaseUrl })));
    res.json({ result: out });
  }));

  r.get('/releases', requirePermission('reports:release'), asyncHandler(async (req, res) => {
    const rows = await withSystemDb(req, (q) => q.many(
      `SELECT rel.id, rel.organization_id, o.name AS organization_name, rel.bundle_id, rel.bundle_title, rel.scope, rel.plan_code, rel.released_by_name, rel.released_at
         FROM report_releases rel LEFT JOIN organizations o ON o.id = rel.organization_id ORDER BY rel.id DESC LIMIT 200`));
    res.json({ releases: rows });
  }));

  r.use((req, res, next) => next(badRequest('Unknown reports endpoint')));
  return r;
}
