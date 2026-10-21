import ExcelJS from 'exceljs';
import { Router } from 'express';
import { requireAuth, withUserDb } from '../auth/middleware.js';
import { asyncHandler } from '../errors.js';
import {
  awardFiltersSchema, awardPaging, bidderDetail, bidderProfiles, departmentPatterns, exportAwards,
  getAward, rateAnalysis, rateTrend, searchAwards, unitRates,
} from '../services/results.js';
import { id as idSchema, parse, z } from '../validate.js';

const NOT_PUBLISHED = 'Not published';

export function resultsRoutes() {
  const r = Router();
  r.use(requireAuth);
  const filtersOf = (req) => parse(awardFiltersSchema, req.query);
  const groupBy = z.enum(['department', 'category', 'state']).default('department');

  r.get('/', asyncHandler(async (req, res) => {
    const filters = filtersOf(req);
    res.json(await withUserDb(req, (q) => searchAwards(q, filters, parse(awardPaging, req.query))));
  }));

  r.get('/export.xlsx', asyncHandler(async (req, res) => {
    const rows = await withUserDb(req, (q) => exportAwards(q, filtersOf(req)));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="tender-results-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
    const ws = wb.addWorksheet('Results', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Ref', key: 'ref', width: 12 }, { header: 'Tender', key: 'title', width: 56 }, { header: 'Tender number', key: 'tenderRef', width: 22 },
      { header: 'Department', key: 'department', width: 32 }, { header: 'State', key: 'state', width: 18 }, { header: 'Category', key: 'category', width: 24 },
      { header: 'Estimated value (INR)', key: 'estimated', width: 20, style: { numFmt: '#,##0' } },
      { header: 'Award value (INR)', key: 'awarded', width: 18, style: { numFmt: '#,##0' } },
      { header: 'L1 bidder', key: 'winner', width: 30 }, { header: 'L1 amount (INR)', key: 'l1', width: 18, style: { numFmt: '#,##0' } },
      { header: 'L2 bidder', key: 'l2Bidder', width: 30 }, { header: 'L2 amount (INR)', key: 'l2', width: 18, style: { numFmt: '#,##0' } },
      { header: 'L1 vs estimate (%)', key: 'spread', width: 16, style: { numFmt: '0.00' } },
      { header: 'Bidders', key: 'bidders', width: 9 }, { header: 'Technically qualified', key: 'qualified', width: 12 },
      { header: 'Award date', key: 'date', width: 13 }, { header: 'Work order', key: 'workOrder', width: 20 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2545' } };
    ws.getRow(1).commit();
    // Anything the source did not publish is written as text, never as 0 or a guess.
    const figure = (v) => (v === null || v === undefined ? NOT_PUBLISHED : v);
    for (const a of rows) {
      ws.addRow({
        ref: a.ref, title: a.title, tenderRef: a.tenderRef ?? '', department: a.department ?? '', state: a.state ?? '', category: a.category ?? '',
        estimated: figure(a.estimatedValue), awarded: figure(a.awardedValue), winner: a.winner ?? NOT_PUBLISHED, l1: figure(a.l1Amount),
        l2Bidder: a.l2Bidder ?? '', l2: a.l2Bidder ? figure(a.l2Amount) : '', spread: a.spreadPct === null ? 'Unavailable' : a.spreadPct,
        bidders: a.bidders ?? '', qualified: a.qualified ?? '', date: a.awardDate ?? '', workOrder: a.workOrderRef ?? '',
      }).commit();
    }
    ws.commit();
    await wb.commit();
  }));

  // ---- Rate analysis -------------------------------------------------------------------------------
  r.get('/analysis/rates', asyncHandler(async (req, res) => {
    const { by, estimatedValue } = parse(z.object({ by: groupBy, estimatedValue: z.coerce.number().positive().max(1e13).optional() }), req.query);
    res.json(await withUserDb(req, (q) => rateAnalysis(q, filtersOf(req), { groupBy: by, estimatedValue: estimatedValue ?? null })));
  }));

  r.get('/analysis/trend', asyncHandler(async (req, res) => {
    res.json({ months: await withUserDb(req, (q) => rateTrend(q, filtersOf(req))) });
  }));

  r.get('/analysis/unit-rates', asyncHandler(async (req, res) => {
    const { by, item, unit } = parse(z.object({ by: groupBy, item: z.string().trim().max(200).optional(), unit: z.string().trim().max(50).optional() }), req.query);
    res.json(await withUserDb(req, (q) => unitRates(q, filtersOf(req), { item, unit, groupBy: by })));
  }));

  // ---- Tender analysis ---------------------------------------------------------------------------------
  r.get('/analysis/departments', asyncHandler(async (req, res) => {
    res.json({ departments: await withUserDb(req, (q) => departmentPatterns(q, filtersOf(req))) });
  }));

  r.get('/analysis/bidders', asyncHandler(async (req, res) => {
    const { name, min } = parse(z.object({ name: z.string().trim().max(150).optional(), min: z.coerce.number().int().min(1).max(100).default(1) }), req.query);
    res.json({ bidders: await withUserDb(req, (q) => bidderProfiles(q, filtersOf(req), { name, minParticipations: min })) });
  }));

  r.get('/analysis/bidders/detail', asyncHandler(async (req, res) => {
    const { key } = parse(z.object({ key: z.string().trim().min(1).max(200) }), req.query);
    res.json(await withUserDb(req, (q) => bidderDetail(q, key, filtersOf(req))));
  }));

  r.get('/:resultId', asyncHandler(async (req, res) => {
    const { resultId } = parse(z.object({ resultId: idSchema }), req.params);
    res.json({ result: await withUserDb(req, (q) => getAward(q, resultId)) });
  }));

  return r;
}
