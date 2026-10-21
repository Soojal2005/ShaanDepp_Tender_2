/**
 * Submission desk API.
 *
 * Staff (permission cases:work) work every case. A client sees and acts only on
 * its own organization's cases: reads run under the client's own database
 * context so row-level security applies, and the few client writes (raise a
 * request, add a shared document) run after an explicit ownership check.
 */
import multer from 'multer';
import { Router } from 'express';
import { requireAuth, requirePermission, withSystemDb, withUserDb } from '../auth/middleware.js';
import { can, isStaffRole } from '../auth/permissions.js';
import { config } from '../config.js';
import { asyncHandler, badRequest, forbidden, notFound } from '../errors.js';
import { actorOf } from '../services/audit.js';
import * as cases from '../services/cases.js';
import { caseRef } from '../util.js';
import { cleanFileName, extensionOf, MAX_UPLOAD_BYTES, openFile, removeFile, saveFile } from '../services/storage.js';
import { id, parse, z } from '../validate.js';

const text = (max) => z.string().trim().max(max);
const money = z.number().positive().max(1e13);
const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();

const createSchema = z.object({
  tenderId: id.optional(), title: text(300).min(3).optional(), note: text(2000).optional(), orgId: id.optional(),
});
const patchSchema = z.object({
  clientSummary: text(5000).nullable().optional(), deadline: isoDateTime.nullable().optional(),
  estimatedValue: money.nullable().optional(), emdAmount: money.nullable().optional(), slaNote: text(500).nullable().optional(),
  outcome: z.enum(['pending', 'cancelled', 'withdrawn']).optional(),
});
const listSchema = z.object({
  scope: z.enum(['open', 'closed', 'all']).default('open'), stage: z.enum(cases.STAGE_KEYS).optional(), outcome: z.enum(['pending', 'l1', 'not_l1', 'cancelled', 'withdrawn']).optional(),
  assignedTo: z.union([z.literal('unassigned'), id]).optional(), text: text(100).optional(), orgId: id.optional(),
});
const checkKinds = z.enum(['eligibility', 'technical']);
const checkStatus = z.enum(['pending', 'pass', 'fail', 'na']);
const CLIENT_SLOTS = ['tender_document', 'boq', 'emd_receipt', 'other'];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8' };

export function caseRoutes() {
  const r = Router();
  r.use(requireAuth);
  const isStaff = (req) => isStaffRole(req.auth.user.role);
  const work = requirePermission('cases:work');
  const actor = (req) => ({ ...actorOf(req), canReopen: can(req.auth.user, 'cases:assign') });
  const caseId = (req) => parse(z.object({ caseId: id }), req.params).caseId;
  const sub = (req, key) => parse(z.object({ [key]: id }), req.params)[key];
  const staffCase = (fn) => [work, asyncHandler(async (req, res) => {
    const cid = caseId(req);
    const out = await withSystemDb(req, async (q) => {
      if (!(await q.maybeOne('SELECT 1 AS x FROM submission_cases WHERE id = $1', [cid]))) throw notFound('Case not found');
      return fn(req, q, cid);
    });
    res.json(out ?? { ok: true });
  })];

  // ---- lists and the dashboard ------------------------------------------------------------------
  r.get('/', asyncHandler(async (req, res) => {
    const f = parse(listSchema, req.query);
    const own = req.auth.user.orgId;
    const items = await withUserDb(req, (q) => cases.listCases(q, { ...f, orgId: isStaff(req) ? f.orgId : own }));
    res.json({ cases: items });
  }));

  r.get('/summary', work, asyncHandler(async (req, res) => {
    res.json(await withUserDb(req, (q) => cases.deskSummary(q)));
  }));

  r.get('/team', work, asyncHandler(async (req, res) => {
    res.json({ team: await withUserDb(req, (q) => cases.staffTeam(q)) });
  }));

  r.get('/clients', work, asyncHandler(async (req, res) => {
    res.json({ clients: await withUserDb(req, (q) => q.many(`SELECT id, name FROM organizations WHERE NOT is_staff_org AND status = 'Active' ORDER BY name`)) });
  }));

  // ---- raise a request --------------------------------------------------------------------------
  r.post('/', asyncHandler(async (req, res) => {
    const body = parse(createSchema, req.body);
    let orgId = req.auth.user.orgId;
    if (isStaff(req)) {
      if (!can(req.auth.user, 'cases:work') || !body.orgId) throw badRequest('Choose the client this request is for');
      orgId = body.orgId;
    }
    const idNew = await withSystemDb(req, (q) => cases.createCase(q, actor(req), { orgId, tenderId: body.tenderId ?? null, title: body.title ?? null, note: body.note || null, baseUrl: config.publicBaseUrl }));
    res.status(201).json({ id: idNew, ref: caseRef(idNew) });
  }));

  // ---- read one -----------------------------------------------------------------------------------
  r.get('/:caseId', asyncHandler(async (req, res) => {
    const cid = caseId(req);
    const audience = isStaff(req) ? 'staff' : 'client';
    res.json({ case: await withUserDb(req, (q) => cases.caseView(q, cid, audience, { orgId: isStaff(req) ? null : req.auth.user.orgId })), stages: cases.STAGES, slots: cases.DOCUMENT_SLOTS });
  }));

  // ---- staff working actions ----------------------------------------------------------------------
  r.patch('/:caseId', ...staffCase((req, q, cid) => cases.updateCase(q, actor(req), cid, parse(patchSchema, req.body))));
  r.post('/:caseId/stage', ...staffCase((req, q, cid) =>
    cases.moveStage(q, actor(req), cid, parse(z.object({ stage: z.enum(cases.STAGE_KEYS) }), req.body).stage, { baseUrl: config.publicBaseUrl })));
  r.post('/:caseId/assign', requirePermission('cases:assign'), ...staffCase((req, q, cid) =>
    cases.assignCase(q, actor(req), cid, parse(z.object({ userId: id.nullable() }), req.body).userId)));

  r.post('/:caseId/checklist', ...staffCase(async (req, q, cid) => ({ id: await cases.addChecklistItem(q, actor(req), cid, parse(z.object({ kind: checkKinds, label: text(300).min(2) }), req.body)) })));
  r.patch('/:caseId/checklist/:itemId', ...staffCase((req, q, cid) =>
    cases.updateChecklistItem(q, actor(req), cid, sub(req, 'itemId'), parse(z.object({ status: checkStatus.optional(), note: text(500).nullable().optional(), label: text(300).min(2).optional() }), req.body))));
  r.delete('/:caseId/checklist/:itemId', ...staffCase((req, q, cid) => cases.removeChecklistItem(q, actor(req), cid, sub(req, 'itemId'))));

  r.post('/:caseId/notes', ...staffCase((req, q, cid) => cases.addNote(q, actor(req), cid, parse(z.object({ text: text(4000).min(1) }), req.body).text)));
  r.put('/:caseId/internal', ...staffCase((req, q, cid) =>
    cases.saveInternal(q, actor(req), cid, parse(z.object({ financialStrategy: text(8000).optional(), marginNotes: text(4000).optional() }), req.body))));
  r.post('/:caseId/rate-analysis', ...staffCase(async (req, q, cid) => ({ rateAnalysis: await cases.attachRateAnalysis(q, actor(req), cid) })));

  r.post('/:caseId/prebid', ...staffCase(async (req, q, cid) => ({ id: await cases.addPrebid(q, actor(req), cid, parse(z.object({ query: text(3000).min(3) }), req.body).query) })));
  r.patch('/:caseId/prebid/:queryId', ...staffCase((req, q, cid) =>
    cases.respondPrebid(q, actor(req), cid, sub(req, 'queryId'), parse(z.object({ response: text(3000).min(1) }), req.body).response)));

  r.put('/:caseId/submission', ...staffCase((req, q, cid) => cases.saveSubmission(q, actor(req), cid, parse(z.object({
    mode: z.enum(['online', 'offline']), portalReference: text(200).optional(), courierName: text(100).optional(), trackingNumber: text(100).optional(), submittedAt: isoDateTime.optional(),
  }), req.body))));
  r.put('/:caseId/result', ...staffCase((req, q, cid) => cases.saveResult(q, actor(req), cid, parse(z.object({
    technicalStatus: z.enum(['pending', 'qualified', 'disqualified']).optional(), financialStatus: z.enum(['pending', 'opened', 'evaluated']).optional(),
    outcome: z.enum(['pending', 'l1', 'not_l1']), ourAmount: money.nullable().optional(), l1Amount: money.nullable().optional(), resultDate: isoDate.nullable().optional(), remarks: text(2000).nullable().optional(),
  }), req.body))));

  const emdSchema = z.object({
    instrumentType: z.enum(['Bank Guarantee', 'FDR', 'Demand Draft', 'Online Portal', 'Exempted']), issuingBank: text(150).optional(), instrumentNumber: text(100).optional(),
    amount: money.nullable().optional(), validTill: isoDate.nullable().optional(), refundStatus: z.enum(['Pending', 'Refunded', 'Forfeited', 'Converted to PBG']).optional(),
  });
  r.post('/:caseId/emd', ...staffCase((req, q, cid) => cases.saveEmd(q, actor(req), cid, parse(emdSchema, req.body))));
  r.patch('/:caseId/emd/:emdId', ...staffCase((req, q, cid) => cases.saveEmd(q, actor(req), cid, parse(emdSchema, req.body), sub(req, 'emdId'))));

  r.post('/:caseId/followups', ...staffCase((req, q, cid) => cases.addFollowup(q, actor(req), cid, parse(z.object({
    kind: z.enum(['emd_refund', 'purchase_order', 'payment']), dueDate: isoDate.nullable().optional(), amount: money.nullable().optional(), reference: text(150).optional(), note: text(500).optional(),
  }), req.body))));
  r.patch('/:caseId/followups/:followupId', ...staffCase((req, q, cid) => cases.updateFollowup(q, actor(req), cid, sub(req, 'followupId'), parse(z.object({
    status: z.enum(['pending', 'done']).optional(), reference: text(150).optional(), note: text(500).optional(), amount: money.optional(), dueDate: isoDate.optional(),
  }), req.body))));

  // ---- documents ---------------------------------------------------------------------------------------
  r.post('/:caseId/documents', upload.single('file'), asyncHandler(async (req, res) => {
    const cid = caseId(req);
    if (!req.file) throw badRequest('Choose a file to upload');
    const staff = isStaff(req);
    if (staff && !can(req.auth.user, 'cases:work')) throw forbidden();
    const body = parse(z.object({ slot: z.enum(cases.DOCUMENT_SLOTS).default('other'), visibility: z.enum(['shared', 'internal_only']).default('internal_only') }), req.body);
    if (!staff && !CLIENT_SLOTS.includes(body.slot)) throw badRequest('Choose where this document belongs');
    const visibility = staff ? body.visibility : 'shared';
    const name = cleanFileName(req.file.originalname);
    const out = await withSystemDb(req, async (q) => {
      const c = await q.maybeOne('SELECT id, stage FROM submission_cases WHERE id = $1 AND ($2::int IS NULL OR organization_id = $2)', [cid, staff ? null : req.auth.user.orgId]);
      if (!c) throw notFound('Case not found');
      if (c.stage === 'closed') throw badRequest('This case is closed');
      const saved = await saveFile(`cases/${cid}`, name, req.file.buffer);
      try {
        const docId = await cases.addDocument(q, actor(req), cid, { slot: body.slot, name, size: saved.size, mime: MIME[extensionOf(name)] ?? null, key: saved.key, visibility });
        return { id: docId };
      } catch (err) {
        await removeFile(saved.key);
        throw err;
      }
    });
    res.status(201).json(out);
  }));

  r.get('/:caseId/documents/:docId/file', asyncHandler(async (req, res) => {
    const cid = caseId(req);
    const doc = await withUserDb(req, (q) => cases.getDocument(q, cid, sub(req, 'docId')));
    // A client's database context already hides anything not shared; the check below is a second, explicit one.
    if (!doc || (!isStaff(req) && doc.visibility !== 'shared')) throw notFound('Document not found');
    const ext = extensionOf(doc.name);
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    const stream = openFile(doc.storage_key);
    stream.on('error', () => { if (!res.headersSent) res.status(404).json({ error: { message: 'The file is no longer available', code: 'not_found' } }); else res.destroy(); });
    stream.pipe(res);
  }));

  r.patch('/:caseId/documents/:docId', ...staffCase((req, q, cid) =>
    cases.setDocumentVisibility(q, actor(req), cid, sub(req, 'docId'), parse(z.object({ visibility: z.enum(['shared', 'internal_only']) }), req.body).visibility)));
  r.delete('/:caseId/documents/:docId', ...staffCase(async (req, q, cid) => {
    const key = await cases.removeDocument(q, actor(req), cid, sub(req, 'docId'));
    await removeFile(key);
  }));

  return r;
}
