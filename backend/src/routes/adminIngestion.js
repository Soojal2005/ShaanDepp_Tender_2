/** Admin controls for the tender-data feeds: status, manual sync, back-fill, Excel upload, master mapping. */
import { Router } from 'express';
import multer from 'multer';
import { requirePermission, withSystemDb } from '../auth/middleware.js';
import { config } from '../config.js';
import { asyncHandler, badRequest, conflict, notFound } from '../errors.js';
import { log } from '../log.js';
import { actorOf, audit } from '../services/audit.js';
import { buildTemplate, excelKinds, importWorkbook } from '../services/ingestion/excelImport.js';
import { runIngestion } from '../services/ingestion/runner.js';
import { backfillMapping } from '../services/ingestion/store.js';
import { createTenderbookClient } from '../services/ingestion/tenderbook.js';
import { slugify } from '../util.js';
import { id, parse, z } from '../validate.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) =>
    /\.xlsx$/i.test(file.originalname) ? cb(null, true) : cb(badRequest('Only .xlsx files can be uploaded')),
});

const MASTER_TABLE = { department: 'departments', category: 'tender_categories', state: 'states' };
const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD').transform((s) => new Date(`${s}T00:00:00+05:30`));

const dayDiff = (iso) => (iso ? Math.ceil((new Date(`${iso}T23:59:59+05:30`).getTime() - Date.now()) / 86_400_000) : null);

/** Start a long run without holding the HTTP request open; progress shows in the runs list. */
function startInBackground(db, options) {
  runIngestion(db, options).catch((err) => log.error('background ingestion failed', { error: err.message }));
}

export function adminIngestionRoutes({ makeClient = createTenderbookClient } = {}) {
  const r = Router();
  r.use(requirePermission('ingestion:manage'));

  r.get(
    '/status',
    asyncHandler(async (req, res) => {
      const data = await withSystemDb(req, async (q) => ({
        providers: await q.many('SELECT * FROM providers ORDER BY id'),
        runs: await q.many(
          `SELECT id, provider_id, kind, trigger, status, fetched, inserted, updated, skipped, errors, error_message,
                  warnings, started_at, finished_at
             FROM ingestion_runs ORDER BY id DESC LIMIT 20`),
        counts: await q.one(`SELECT (SELECT count(*) FROM tenders)::int AS tenders,
                                    (SELECT count(*) FROM historical_awards)::int AS awards,
                                    (SELECT count(*) FROM tenders WHERE department_id IS NULL)::int AS unmapped_departments,
                                    (SELECT count(*) FROM master_suggestions WHERE status = 'open')::int AS open_suggestions`),
        bySource: await q.many(`SELECT provider_id, count(*)::int AS tenders, max(last_source_update) AS latest FROM tenders GROUP BY provider_id`),
      }));
      const latest = (providerId, kind) => data.runs.find((run) => run.provider_id === providerId && run.kind === kind) ?? null;
      const daysLeft = dayDiff(config.tenderbook.validTill);
      res.json({
        tenderbook: {
          configured: Boolean(config.tenderbook.apiKey),
          scheduledSyncEnabled: config.tenderbook.enabled,
          intervalMinutes: config.tenderbook.intervalMinutes,
          keyValidTill: config.tenderbook.validTill ?? null,
          keyDaysLeft: daysLeft,
          keyExpiringSoon: daysLeft !== null && daysLeft <= 14,
          lastTenders: latest('tenderbook', 'tenders'),
          lastResults: latest('tenderbook', 'results'),
        },
        providers: data.providers,
        runs: data.runs,
        counts: data.counts,
        bySource: data.bySource,
      });
    })
  );

  const runBody = z.object({
    kind: z.enum(['tenders', 'results']),
    // Passed to the vendor as-is. Use the filter fields in the vendor's API documentation.
    filter: z.record(z.string(), z.unknown()).default({}),
  });

  r.post(
    '/run',
    asyncHandler(async (req, res) => {
      const input = parse(runBody, req.body);
      if (!config.tenderbook.apiKey) throw conflict('The Tenderbook API key is not configured on the server.');
      const result = await runIngestion(req.app.locals.db, {
        providerId: 'tenderbook', kind: input.kind, trigger: 'manual', filter: input.filter, maxPages: 10, client: makeClient(),
      });
      await withSystemDb(req, (q) => audit(q, actorOf(req), 'ingestion.run', 'ingestion_run', result.runId, { kind: input.kind, status: result.status }));
      res.json({ result });
    })
  );

  r.post(
    '/backfill',
    asyncHandler(async (req, res) => {
      const input = parse(
        runBody.extend({ from: dateInput, to: dateInput }).refine((v) => v.to >= v.from, { message: '"to" must not be before "from"', path: ['to'] }),
        req.body
      );
      if (!config.tenderbook.apiKey) throw conflict('The Tenderbook API key is not configured on the server.');
      const busy = await withSystemDb(req, (q) =>
        q.maybeOne(`SELECT id FROM ingestion_runs WHERE provider_id = 'tenderbook' AND kind = $1 AND status = 'running'`, [input.kind]));
      if (busy) throw conflict('A sync for this feed is already running');
      startInBackground(req.app.locals.db, {
        providerId: 'tenderbook', kind: input.kind, trigger: 'backfill', filter: input.filter,
        from: input.from, to: new Date(input.to.getTime() + 86_400_000 - 1), maxPages: 200, client: makeClient(),
      });
      await withSystemDb(req, (q) => audit(q, actorOf(req), 'ingestion.backfill', 'ingestion_run', null, { kind: input.kind, from: input.from, to: input.to }));
      res.status(202).json({ message: 'Back-fill started. Follow its progress in the run list.' });
    })
  );

  r.get(
    '/templates/:kind.xlsx',
    asyncHandler(async (req, res) => {
      const { kind } = parse(z.object({ kind: z.enum(excelKinds) }), req.params);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${kind}-upload-template.xlsx"`);
      res.send(await buildTemplate(kind));
    })
  );

  r.post(
    '/excel',
    upload.single('file'),
    asyncHandler(async (req, res) => {
      if (!req.file) throw badRequest('Choose an .xlsx file to upload');
      const { kind, dryRun } = parse(
        z.object({ kind: z.enum(excelKinds), dryRun: z.preprocess((v) => v === 'true' || v === '1' || v === true, z.boolean()).default(false) }),
        req.body
      );
      const result = await importWorkbook(req.app.locals.db, { buffer: req.file.buffer, kind, dryRun });
      if (!dryRun) {
        await withSystemDb(req, (q) => audit(q, actorOf(req), 'ingestion.excel', 'upload', null, {
          kind, file: req.file.originalname.slice(0, 120), inserted: result.inserted, updated: result.updated, errors: result.errors.length,
        }));
      }
      res.json({ result });
    })
  );

  // ---- Names that matched no master entry ------------------------------------------
  r.get(
    '/suggestions',
    asyncHandler(async (req, res) => {
      const { status } = parse(z.object({ status: z.enum(['open', 'mapped', 'ignored']).default('open') }), req.query);
      const rows = await withSystemDb(req, (q) =>
        q.many(`SELECT id, kind, raw_value, seen_count, status, mapped_to_id, first_seen_at, last_seen_at
                  FROM master_suggestions WHERE status = $1 ORDER BY seen_count DESC, last_seen_at DESC LIMIT 200`, [status]));
      res.json({ suggestions: rows });
    })
  );

  r.post(
    '/suggestions/:suggestionId/map',
    asyncHandler(async (req, res) => {
      const { suggestionId } = parse(z.object({ suggestionId: id }), req.params);
      const { masterId, create } = parse(
        z.object({ masterId: id.optional(), create: z.object({ name: z.string().trim().min(2).max(200) }).optional() })
          .refine((v) => v.masterId || v.create, { message: 'Choose an existing entry or create a new one' }),
        req.body
      );
      const outcome = await withSystemDb(req, async (q) => {
        const s = await q.maybeOne(`SELECT * FROM master_suggestions WHERE id = $1 AND status = 'open'`, [suggestionId]);
        if (!s) throw notFound('Suggestion not found or already handled');
        const table = MASTER_TABLE[s.kind];
        if (!table) throw badRequest('Cities are added automatically; there is nothing to map');

        let master;
        if (create) {
          if (s.kind === 'state') throw badRequest('States cannot be created from a suggestion; map it to an existing state');
          master = s.kind === 'department'
            ? await q.one(`INSERT INTO departments (slug, name, aliases) VALUES ($1, $2, $3) RETURNING id, name`, [slugify(create.name), create.name, [s.raw_value]])
            : await q.one(`INSERT INTO tender_categories (slug, name, aliases) VALUES ($1, $2, $3) RETURNING id, name`, [slugify(create.name), create.name, [s.raw_value]]);
        } else {
          master = await q.maybeOne(`SELECT id, name FROM ${table} WHERE id = $1`, [masterId]);
          if (!master) throw notFound('That master entry does not exist');
          await q.query(
            `UPDATE ${table} SET aliases = array_append(aliases, $1) WHERE id = $2 AND NOT ($1 = ANY(aliases))`,
            [s.raw_value, master.id]
          );
        }
        const updated = await backfillMapping(q, s.kind, s.raw_value, master);
        await q.query(`UPDATE master_suggestions SET status = 'mapped', mapped_to_id = $2 WHERE id = $1`, [s.id, master.id]);
        await audit(q, actorOf(req), 'master.suggestion.map', s.kind, s.id, { raw: s.raw_value, to: master.name, tendersUpdated: updated });
        return { master, tendersUpdated: updated };
      });
      res.json(outcome);
    })
  );

  r.post(
    '/suggestions/:suggestionId/ignore',
    asyncHandler(async (req, res) => {
      const { suggestionId } = parse(z.object({ suggestionId: id }), req.params);
      const done = await withSystemDb(req, async (q) => {
        const row = await q.query(`UPDATE master_suggestions SET status = 'ignored' WHERE id = $1 AND status = 'open'`, [suggestionId]);
        if (row.rowCount) await audit(q, actorOf(req), 'master.suggestion.ignore', 'suggestion', suggestionId);
        return row.rowCount;
      });
      if (!done) throw notFound('Suggestion not found or already handled');
      res.status(204).end();
    })
  );

  return r;
}
