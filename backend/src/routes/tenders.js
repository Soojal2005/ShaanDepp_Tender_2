import ExcelJS from 'exceljs';
import { Router } from 'express';
import { requireAuth, withUserDb } from '../auth/middleware.js';
import { asyncHandler, conflict, notFound } from '../errors.js';
import { exportTenders, filtersSchema, getTender, pagingSchema, searchTenders, tenderFacets } from '../services/tenderSearch.js';
import { tenderRef } from '../util.js';
import { id as idSchema, parse, z } from '../validate.js';

const MAX_SAVED_SEARCHES = 50;

const parseFilters = (query) => parse(filtersSchema, query);

export function tendersRoutes() {
  const r = Router();
  r.use(requireAuth);

  // ---- Search ----------------------------------------------------------------
  r.get(
    '/',
    asyncHandler(async (req, res) => {
      const filters = parseFilters(req.query);
      const paging = parse(pagingSchema, req.query);
      const wantFacets = req.query.facets === '1';
      const started = Date.now();
      const result = await withUserDb(req, async (q) => {
        const found = await searchTenders(q, filters, paging, { userId: req.auth.user.id });
        const facets = wantFacets ? await tenderFacets(q, filters) : undefined;
        // Keep a light record of what people search for (used to tune filters and masters).
        if (paging.page === 1 && (filters.q || filters.departmentIds.length || filters.stateIds.length)) {
          await q.query(
            `INSERT INTO search_query_logs (organization_id, user_id, query_text, filters_applied, results_count, latency_ms)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
            [req.auth.user.orgId, req.auth.user.id, filters.q ?? null, JSON.stringify(filters), found.total, Date.now() - started]
          );
        }
        return { ...found, facets };
      });
      res.json(result);
    })
  );

  r.get(
    '/export.xlsx',
    asyncHandler(async (req, res) => {
      const filters = parseFilters(req.query);
      const rows = await withUserDb(req, (q) => exportTenders(q, filters, { userId: req.auth.user.id }));

      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="tenders-${stamp}.xlsx"`);

      const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
      const ws = wb.addWorksheet('Tenders', { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = [
        { header: 'Ref', key: 'ref', width: 12 }, { header: 'Tender number', key: 'tenderNo', width: 22 },
        { header: 'Title', key: 'title', width: 60 }, { header: 'Department', key: 'department', width: 34 },
        { header: 'State', key: 'state', width: 18 }, { header: 'City', key: 'city', width: 18 },
        { header: 'Category', key: 'category', width: 26 }, { header: 'Type', key: 'type', width: 12 },
        { header: 'Estimated value (INR)', key: 'value', width: 20, style: { numFmt: '#,##0' } },
        { header: 'EMD (INR)', key: 'emd', width: 14, style: { numFmt: '#,##0' } },
        { header: 'Tender fee (INR)', key: 'fee', width: 14, style: { numFmt: '#,##0' } },
        { header: 'Published', key: 'published', width: 13, style: { numFmt: 'dd-mmm-yyyy' } },
        { header: 'Submission deadline', key: 'deadline', width: 20, style: { numFmt: 'dd-mmm-yyyy hh:mm' } },
        { header: 'Opening', key: 'opening', width: 13, style: { numFmt: 'dd-mmm-yyyy' } },
        { header: 'Status', key: 'status', width: 14 }, { header: 'Source link', key: 'link', width: 40 },
      ];
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2545' } };
      ws.getRow(1).commit();

      // A figure the source did not publish is written as text, never as 0.
      const figure = (v, note = 'Not disclosed') => (v === null || v === undefined ? note : Number(v));
      for (const t of rows) {
        ws.addRow({
          ref: tenderRef(t.id), tenderNo: t.tender_no ?? '', title: t.title, department: t.department ?? '',
          state: t.state ?? '', city: t.city ?? '', category: t.category ?? '', type: t.tender_type ?? '',
          value: figure(t.estimated_value),
          emd: t.emd_status === 'exempted' ? 'Exempted' : figure(t.emd_amount),
          fee: figure(t.tender_fee), published: t.publish_date ?? '', deadline: t.submission_deadline ?? '',
          opening: t.opening_date ?? '', status: t.status, link: t.source_url ?? '',
        }).commit();
      }
      ws.commit();
      await wb.commit();
    })
  );

  r.get(
    '/:tenderId',
    asyncHandler(async (req, res) => {
      const { tenderId } = parse(z.object({ tenderId: idSchema }), req.params);
      res.json({ tender: await withUserDb(req, (q) => getTender(q, tenderId, { userId: req.auth.user.id })) });
    })
  );

  // ---- Watchlist -------------------------------------------------------------
  r.put(
    '/:tenderId/watch',
    asyncHandler(async (req, res) => {
      const { tenderId } = parse(z.object({ tenderId: idSchema }), req.params);
      const { notes } = parse(z.object({ notes: z.string().trim().max(1000).nullish() }), req.body);
      await withUserDb(req, async (q) => {
        const exists = await q.maybeOne('SELECT 1 AS x FROM tenders WHERE id = $1', [tenderId]);
        if (!exists) throw notFound('Tender not found');
        await q.query(
          `INSERT INTO watchlist_items (organization_id, user_id, tender_id, notes) VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, tender_id) DO UPDATE SET notes = coalesce(EXCLUDED.notes, watchlist_items.notes)`,
          [req.auth.user.orgId, req.auth.user.id, tenderId, notes ?? null]
        );
      });
      res.status(204).end();
    })
  );

  r.delete(
    '/:tenderId/watch',
    asyncHandler(async (req, res) => {
      const { tenderId } = parse(z.object({ tenderId: idSchema }), req.params);
      await withUserDb(req, (q) => q.query('DELETE FROM watchlist_items WHERE user_id = $1 AND tender_id = $2', [req.auth.user.id, tenderId]));
      res.status(204).end();
    })
  );

  return r;
}

export function savedSearchRoutes() {
  const r = Router();
  r.use(requireAuth);

  // ---- Saved searches ----------------------------------------------------------
  r.get(
    '/',
    asyncHandler(async (req, res) => {
      const rows = await withUserDb(req, (q) =>
        q.many('SELECT id, name, query_params, created_at FROM saved_searches WHERE user_id = $1 ORDER BY created_at DESC', [req.auth.user.id])
      );
      res.json({ searches: rows.map((s) => ({ id: s.id, name: s.name, filters: s.query_params, createdAt: s.created_at })) });
    })
  );

  r.post(
    '/',
    asyncHandler(async (req, res) => {
      const { name, filters: rawFilters } = parse(
        z.object({ name: z.string().trim().min(1).max(150), filters: z.record(z.string(), z.unknown()) }),
        req.body
      );
      const filters = parseFilters(rawFilters);
      const saved = await withUserDb(req, async (q) => {
        const { n } = await q.one('SELECT count(*)::int AS n FROM saved_searches WHERE user_id = $1', [req.auth.user.id]);
        if (n >= MAX_SAVED_SEARCHES) throw conflict(`You can keep up to ${MAX_SAVED_SEARCHES} saved searches. Delete one first.`);
        return q.one(
          `INSERT INTO saved_searches (organization_id, user_id, name, query_params) VALUES ($1, $2, $3, $4::jsonb)
           RETURNING id, name, query_params, created_at`,
          [req.auth.user.orgId, req.auth.user.id, name, JSON.stringify(filters)]
        );
      });
      res.status(201).json({ search: { id: saved.id, name: saved.name, filters: saved.query_params, createdAt: saved.created_at } });
    })
  );

  r.delete(
    '/:searchId',
    asyncHandler(async (req, res) => {
      const { searchId } = parse(z.object({ searchId: idSchema }), req.params);
      const done = await withUserDb(req, (q) => q.query('DELETE FROM saved_searches WHERE id = $1 AND user_id = $2', [searchId, req.auth.user.id]));
      if (!done.rowCount) throw notFound('Saved search not found');
      res.status(204).end();
    })
  );

  return r;
}

