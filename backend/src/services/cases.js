/**
 * The submission assistance desk: a client raises a request against a tender,
 * Shan-Deep staff take it through nine stages, and the client follows progress.
 *
 * Two audiences, one case. Staff see everything. A client sees only what is
 * meant for them: the summary, the checklists, shared documents, pre-bid
 * questions, the submission and the result. Internal strategy, analyst notes,
 * internal documents and the activity log never reach a client. That is enforced
 * twice: by row-level security on those tables, and by `caseView` choosing which
 * parts to build for the audience.
 */
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { caseRef, tenderRef } from '../util.js';
import { audit } from './audit.js';
import { button, emailShell, esc } from './mail/html.js';
import { enqueueEmail } from './mail/queue.js';
import { awardFiltersSchema, rateAnalysis } from './results.js';

export const STAGES = Object.freeze([
  { key: 'intake', label: 'Request received' },
  { key: 'detail_study', label: 'Detail study' },
  { key: 'eligibility', label: 'Eligibility & compliance' },
  { key: 'technical_prep', label: 'Technical bid preparation' },
  { key: 'financial_strategy', label: 'Financial bid strategy' },
  { key: 'prebid', label: 'Pre-bid queries' },
  { key: 'submission', label: 'Submission' },
  { key: 'evaluation', label: 'Opening & result' },
  { key: 'follow_up', label: 'Follow-up' },
  { key: 'closed', label: 'Closed' },
]);
export const STAGE_KEYS = STAGES.map((s) => s.key);
const stageLabel = (key) => STAGES.find((s) => s.key === key)?.label ?? key;

export const DOCUMENT_SLOTS = Object.freeze([
  'tender_document', 'compliance_checklist', 'technical_bid', 'boq', 'proof_of_submission', 'emd_receipt', 'work_order', 'other',
]);

const ELIGIBILITY_DEFAULTS = [
  'Registration and GST certificates valid',
  'Minimum annual turnover met',
  'Similar-work experience met',
  'Required licences and certifications held',
  'Not blacklisted or debarred (declaration)',
  'EMD and tender fee arranged or exempted',
];
const TECHNICAL_DEFAULTS = [
  'All tender forms filled and signed',
  'Company profile and experience certificates attached',
  'Technical specification compliance statement',
  'Affidavits and undertakings on required stamp paper',
  'BOQ priced and checked against the tender format',
  'Final review: signatures, seals and page numbering',
];

const n = (v) => (v === null || v === undefined ? null : Number(v));
const OPEN = `c.stage <> 'closed'`;

// ---------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------
const SUMMARY_COLUMNS = `c.id, c.organization_id, c.tender_id, c.tender_ref, c.tender_title, c.department, c.client_name, c.stage, c.outcome,
  c.deadline, c.estimated_value, c.emd_amount, c.assigned_to, c.assigned_name, c.created_at, c.updated_at, c.closed_at`;

const summaryView = (r) => ({
  id: r.id, ref: caseRef(r.id), organizationId: r.organization_id, tenderId: r.tender_id, tenderRef: r.tender_ref ?? (r.tender_id ? tenderRef(r.tender_id) : null),
  title: r.tender_title, department: r.department, client: r.client_name, stage: r.stage, stageLabel: stageLabel(r.stage), stageIndex: STAGE_KEYS.indexOf(r.stage),
  outcome: r.outcome, deadline: r.deadline, estimatedValue: n(r.estimated_value), emdAmount: n(r.emd_amount),
  assignedTo: r.assigned_to, assignedName: r.assigned_name, createdAt: r.created_at, updatedAt: r.updated_at, closedAt: r.closed_at,
  hoursToDeadline: r.deadline ? Math.round((new Date(r.deadline).getTime() - Date.now()) / 3_600_000) : null,
});

/**
 * @param filters {{ scope?: 'open'|'closed'|'all', stage?: string, assignedTo?: number|'unassigned', outcome?: string, text?: string, orgId?: number }}
 */
export async function listCases(q, filters = {}) {
  const params = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };
  const where = [];
  const scope = filters.scope ?? 'open';
  if (scope === 'open') where.push(OPEN);
  if (scope === 'closed') where.push(`c.stage = 'closed'`);
  if (filters.stage) where.push(`c.stage = ${add(filters.stage)}`);
  if (filters.orgId) where.push(`c.organization_id = ${add(filters.orgId)}`);
  if (filters.assignedTo === 'unassigned') where.push('c.assigned_to IS NULL');
  else if (filters.assignedTo) where.push(`c.assigned_to = ${add(filters.assignedTo)}`);
  if (filters.outcome) where.push(`c.outcome = ${add(filters.outcome)}`);
  if (filters.text) {
    const like = add(`%${filters.text.replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(c.tender_title ILIKE ${like} OR c.client_name ILIKE ${like} OR c.tender_ref ILIKE ${like})`);
  }
  const rows = await q.many(
    `SELECT ${SUMMARY_COLUMNS} FROM submission_cases c ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY (c.stage = 'closed'), c.deadline NULLS LAST, c.id DESC LIMIT 300`, params);
  return rows.map(summaryView);
}

/** The case as one audience may see it. `audience` is 'staff' or 'client'. */
export async function caseView(q, caseId, audience, { orgId = null } = {}) {
  const row = await q.maybeOne(
    `SELECT ${SUMMARY_COLUMNS}, c.client_summary, c.request_note, c.sla_note, c.requested_by FROM submission_cases c
      WHERE c.id = $1 AND ($2::int IS NULL OR c.organization_id = $2)`, [caseId, orgId]);
  if (!row) throw notFound('Case not found');
  const staff = audience === 'staff';

  const stages = await q.many('SELECT id, stage, entered_at, completed_at FROM submission_case_stages WHERE case_id = $1 ORDER BY id', [caseId]);
  const checklists = await q.many('SELECT id, kind, label, status, note, updated_at FROM submission_case_checklists WHERE case_id = $1 ORDER BY id', [caseId]);
  const prebid = await q.many(`SELECT id, query_text, raised_at, department_response, responded_at FROM case_prebid_queries WHERE case_id = $1 ORDER BY id`, [caseId]);
  const submission = await q.maybeOne('SELECT mode, portal_reference, courier_name, tracking_number, submitted_at FROM case_submissions WHERE case_id = $1', [caseId]);
  const result = await q.maybeOne(`SELECT technical_status, financial_status, outcome, our_amount, l1_amount, to_char(result_date, 'YYYY-MM-DD') AS result_date, remarks FROM case_results WHERE case_id = $1`, [caseId]);
  const emd = await q.many(`SELECT id, instrument_type, issuing_bank, instrument_number, amount, to_char(valid_till, 'YYYY-MM-DD') AS valid_till, refund_status FROM case_emd_tracking WHERE case_id = $1 ORDER BY id`, [caseId]);
  const followups = await q.many(`SELECT id, kind, status, to_char(due_date, 'YYYY-MM-DD') AS due_date, amount, reference, note, completed_at FROM case_followups WHERE case_id = $1 ORDER BY id`, [caseId]);
  const documents = await q.many(
    `SELECT d.id, d.slot, d.name, d.size_bytes, d.mime_type, d.visibility, d.created_at, u.name AS uploaded_by_name
       FROM case_documents d LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE d.case_id = $1 ${staff ? '' : `AND d.visibility = 'shared'`} ORDER BY d.id`, [caseId]);

  const view = {
    ...summaryView(row),
    summary: row.client_summary,
    requestNote: row.request_note,
    timeline: stages.map((s) => ({ stage: s.stage, label: stageLabel(s.stage), enteredAt: s.entered_at, completedAt: s.completed_at })),
    checklists: {
      eligibility: checklists.filter((c) => c.kind === 'eligibility').map(checkView),
      technical: checklists.filter((c) => c.kind === 'technical').map(checkView),
    },
    prebid: prebid.map((p) => ({ id: p.id, query: p.query_text, raisedAt: p.raised_at, response: p.department_response, respondedAt: p.responded_at })),
    submission: submission && {
      mode: submission.mode, portalReference: submission.portal_reference, courierName: submission.courier_name,
      trackingNumber: submission.tracking_number, submittedAt: submission.submitted_at,
    },
    result: result && {
      technicalStatus: result.technical_status, financialStatus: result.financial_status, outcome: result.outcome,
      ourAmount: n(result.our_amount), l1Amount: n(result.l1_amount), resultDate: result.result_date, remarks: result.remarks,
    },
    emd: emd.map((e) => ({ id: e.id, instrumentType: e.instrument_type, issuingBank: e.issuing_bank, instrumentNumber: e.instrument_number, amount: n(e.amount), validTill: e.valid_till, refundStatus: e.refund_status })),
    followups: followups.map((f) => ({ id: f.id, kind: f.kind, status: f.status, dueDate: f.due_date, amount: n(f.amount), reference: f.reference, note: f.note, completedAt: f.completed_at })),
    documents: documents.map((d) => ({
      id: d.id, slot: d.slot, name: d.name, sizeBytes: n(d.size_bytes), visibility: d.visibility, createdAt: d.created_at, uploadedBy: d.uploaded_by_name,
    })),
    sla: row.sla_note,
  };
  if (!staff) return view;

  const internal = await q.maybeOne('SELECT financial_strategy, rate_analysis, margin_notes, updated_at FROM case_internal WHERE case_id = $1', [caseId]);
  const notes = await q.many(`SELECT n.id, n.note_text, n.created_at, u.name AS author FROM case_analyst_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.case_id = $1 ORDER BY n.id DESC`, [caseId]);
  const activity = await q.many('SELECT id, user_name, action, created_at FROM case_activity_logs WHERE case_id = $1 ORDER BY id DESC LIMIT 100', [caseId]);
  return {
    ...view,
    internal: {
      financialStrategy: internal?.financial_strategy ?? '', marginNotes: internal?.margin_notes ?? '', rateAnalysis: internal?.rate_analysis ?? null,
      updatedAt: internal?.updated_at ?? null,
    },
    notes: notes.map((x) => ({ id: x.id, text: x.note_text, author: x.author, createdAt: x.created_at })),
    activity: activity.map((a) => ({ id: a.id, user: a.user_name, action: a.action, at: a.created_at })),
  };
}

const checkView = (c) => ({ id: c.id, label: c.label, status: c.status, note: c.note, updatedAt: c.updated_at });

// ---------------------------------------------------------------------------------------------------------
// Writing (always called by a route that has already checked who may do what)
// ---------------------------------------------------------------------------------------------------------
const nameOf = (actor) => actor?.user?.name ?? 'System';
async function logActivity(q, caseId, actor, action) {
  await q.query('INSERT INTO case_activity_logs (case_id, user_id, user_name, action) VALUES ($1, $2, $3, $4)', [caseId, actor?.user?.id ?? null, nameOf(actor), action]);
  await q.query('UPDATE submission_cases SET updated_at = now() WHERE id = $1', [caseId]);
}

async function managers(q) {
  return q.many(`SELECT id, name, email FROM users WHERE role IN ('case_manager', 'platform_admin') AND is_active ORDER BY id`);
}

/**
 * A client (or staff on a client's behalf) raises a request.
 * Fills what it can from the tender; the same tender cannot have two open cases for one client.
 */
export async function createCase(q, actor, { orgId, tenderId = null, title = null, note = null, baseUrl }) {
  const org = await q.maybeOne('SELECT id, name FROM organizations WHERE id = $1', [orgId]);
  if (!org) throw badRequest('Unknown organization');
  let tender = null;
  if (tenderId) {
    tender = await q.maybeOne(
      'SELECT id, title, department, estimated_value, emd_amount, submission_deadline FROM tenders WHERE id = $1', [tenderId]);
    if (!tender) throw notFound('Tender not found');
    const open = await q.maybeOne(`SELECT id FROM submission_cases WHERE organization_id = $1 AND tender_id = $2 AND stage <> 'closed'`, [orgId, tenderId]);
    if (open) throw conflict('A request for this tender is already open', { caseId: open.id });
  } else if (!title) {
    throw badRequest('Choose a tender, or give the tender a title');
  }
  const row = await q.one(
    `INSERT INTO submission_cases (organization_id, tender_id, tender_ref, tender_title, department, client_name, requested_by,
                                   deadline, estimated_value, emd_amount, request_note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [orgId, tender?.id ?? null, tender ? tenderRef(tender.id) : null, tender?.title ?? title, tender?.department ?? null, org.name, actor.user?.id ?? null,
      tender?.submission_deadline ?? null, tender?.estimated_value ?? null, tender?.emd_amount ?? null, note]);
  await q.query('INSERT INTO submission_case_stages (case_id, stage, moved_by) VALUES ($1, $2, $3)', [row.id, 'intake', actor.user?.id ?? null]);
  const items = [...ELIGIBILITY_DEFAULTS.map((label) => ['eligibility', label]), ...TECHNICAL_DEFAULTS.map((label) => ['technical', label])];
  for (const [kind, label] of items) await q.query('INSERT INTO submission_case_checklists (case_id, kind, label) VALUES ($1, $2, $3)', [row.id, kind, label]);
  await q.query('INSERT INTO case_internal (case_id) VALUES ($1)', [row.id]);
  await logActivity(q, row.id, actor, 'Request raised');
  await audit(q, actor, 'case.create', 'case', row.id, { orgId, tenderId });

  const title2 = tender?.title ?? title;
  for (const m of await managers(q)) {
    await enqueueEmail(q, {
      kind: 'case_notice', to: m.email, subject: `New submission request: ${title2}`.slice(0, 200), idempotencyKey: `case-new:${row.id}:${m.id}`,
      html: emailShell({
        title: 'New submission-desk request',
        bodyHtml: `<p style="font-size:15px;">Hello ${esc(m.name)},</p>
          <p style="font-size:13.5px;color:#475569;"><b>${esc(org.name)}</b> asked for help with <b>${esc(title2)}</b>${tender?.submission_deadline ? '' : ''}.</p>
          ${note ? `<p style="font-size:13px;color:#475569;">Their note: ${esc(note)}</p>` : ''}
          <p>${button('Open the case', `${baseUrl}/app/desk/${row.id}`)}</p>`,
      }),
    });
  }
  return row.id;
}

const EDITABLE = {
  clientSummary: 'client_summary', deadline: 'deadline', estimatedValue: 'estimated_value', emdAmount: 'emd_amount', slaNote: 'sla_note',
};
export async function updateCase(q, actor, caseId, patch) {
  const sets = [];
  const params = [caseId];
  for (const [key, column] of Object.entries(EDITABLE)) {
    if (patch[key] === undefined) continue;
    params.push(patch[key]);
    sets.push(`${column} = $${params.length}`);
  }
  if (patch.outcome !== undefined) {
    if (!['pending', 'cancelled', 'withdrawn'].includes(patch.outcome)) throw badRequest('Win or loss is recorded with the result, not here');
    params.push(patch.outcome);
    sets.push(`outcome = $${params.length}`);
  }
  if (!sets.length) throw badRequest('Nothing to change');
  const updated = await q.maybeOne(`UPDATE submission_cases SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING id`, params);
  if (!updated) throw notFound('Case not found');
  await logActivity(q, caseId, actor, `Updated ${Object.keys(patch).join(', ')}`);
}

export async function assignCase(q, actor, caseId, userId) {
  let person = null;
  if (userId !== null) {
    person = await q.maybeOne(`SELECT id, name FROM users WHERE id = $1 AND is_active AND role IN ('analyst', 'case_manager', 'platform_admin')`, [userId]);
    if (!person) throw badRequest('Choose an active member of the Shan-Deep team');
  }
  const done = await q.maybeOne('UPDATE submission_cases SET assigned_to = $2, assigned_name = $3, updated_at = now() WHERE id = $1 RETURNING id', [caseId, person?.id ?? null, person?.name ?? null]);
  if (!done) throw notFound('Case not found');
  await logActivity(q, caseId, actor, person ? `Assigned to ${person.name}` : 'Unassigned');
  await audit(q, actor, 'case.assign', 'case', caseId, { userId });
}

async function notifyClient(q, caseRow, { stageRowId, stage, baseUrl }) {
  const people = await q.many(
    `SELECT DISTINCT u.id, u.name, u.email FROM users u
      WHERE u.organization_id = $1 AND u.is_active AND (u.role = 'tenant_admin' OR u.id = $2)`, [caseRow.organization_id, caseRow.requested_by]);
  for (const p of people) {
    await enqueueEmail(q, {
      orgId: caseRow.organization_id, kind: 'case_notice', to: p.email, subject: `Update on your submission request: ${stageLabel(stage)}`,
      idempotencyKey: `case-stage:${stageRowId}:${p.id}`,
      html: emailShell({
        title: 'Your submission request has moved forward',
        bodyHtml: `<p style="font-size:15px;">Hello ${esc(p.name)},</p>
          <p style="font-size:13.5px;color:#475569;">Your request <b>${esc(caseRow.tender_title)}</b> is now at <b>${esc(stageLabel(stage))}</b>.</p>
          <p>${button('See progress', `${baseUrl}/app/desk/${caseRow.id}`)}</p>`,
      }),
    });
  }
}

export async function moveStage(q, actor, caseId, stage, { baseUrl } = {}) {
  if (!STAGE_KEYS.includes(stage)) throw badRequest('Unknown stage');
  const c = await q.maybeOne('SELECT id, organization_id, tender_title, requested_by, stage, outcome FROM submission_cases WHERE id = $1 FOR UPDATE', [caseId]);
  if (!c) throw notFound('Case not found');
  if (c.stage === stage) return;
  if (c.stage === 'closed' && !actor.canReopen) throw forbidden('Only a case manager can reopen a closed case');
  if (stage === 'closed' && c.outcome === 'pending') throw badRequest('Record the result, or mark the case cancelled or withdrawn, before closing it');
  if (stage === 'follow_up' && !(await q.maybeOne('SELECT 1 AS x FROM case_results WHERE case_id = $1 AND outcome <> $2', [caseId, 'pending']))) {
    throw badRequest('Record the result before moving to follow-up');
  }
  if (stage === 'submission' && ['intake', 'detail_study'].includes(c.stage)) throw badRequest('Complete the study and checks before submission');
  await q.query('UPDATE submission_case_stages SET completed_at = now() WHERE case_id = $1 AND completed_at IS NULL', [caseId]);
  const entered = await q.one('INSERT INTO submission_case_stages (case_id, stage, moved_by) VALUES ($1, $2, $3) RETURNING id', [caseId, stage, actor.user?.id ?? null]);
  await q.query('UPDATE submission_cases SET stage = $2, closed_at = CASE WHEN $2 = \'closed\' THEN now() ELSE NULL END, updated_at = now() WHERE id = $1', [caseId, stage]);
  await logActivity(q, caseId, actor, `Moved to ${stageLabel(stage)}`);
  await audit(q, actor, 'case.stage', 'case', caseId, { from: c.stage, to: stage });
  if (baseUrl && stage !== 'closed') await notifyClient(q, c, { stageRowId: entered.id, stage, baseUrl });
}

// ---- checklists ---------------------------------------------------------------------------------------
export async function addChecklistItem(q, actor, caseId, { kind, label }) {
  const row = await q.one('INSERT INTO submission_case_checklists (case_id, kind, label, updated_by) VALUES ($1, $2, $3, $4) RETURNING id', [caseId, kind, label, actor.user?.id ?? null]);
  await logActivity(q, caseId, actor, `Added ${kind} check: ${label}`);
  return row.id;
}
export async function updateChecklistItem(q, actor, caseId, itemId, { status, note, label }) {
  const row = await q.maybeOne(
    `UPDATE submission_case_checklists SET status = coalesce($3, status), note = CASE WHEN $4::boolean THEN $5 ELSE note END, label = coalesce($6, label), updated_by = $7, updated_at = now()
      WHERE id = $2 AND case_id = $1 RETURNING label, status`,
    [caseId, itemId, status ?? null, note !== undefined, note ?? null, label ?? null, actor.user?.id ?? null]);
  if (!row) throw notFound('Checklist item not found');
  await logActivity(q, caseId, actor, `${row.label}: ${row.status}`);
}
export async function removeChecklistItem(q, actor, caseId, itemId) {
  const row = await q.maybeOne('DELETE FROM submission_case_checklists WHERE id = $2 AND case_id = $1 RETURNING label', [caseId, itemId]);
  if (!row) throw notFound('Checklist item not found');
  await logActivity(q, caseId, actor, `Removed check: ${row.label}`);
}

// ---- staff-only working data --------------------------------------------------------------------------
export async function addNote(q, actor, caseId, text) {
  await q.query('INSERT INTO case_analyst_notes (case_id, author_id, note_text) VALUES ($1, $2, $3)', [caseId, actor.user?.id ?? null, text]);
  await logActivity(q, caseId, actor, 'Added an internal note');
}
export async function saveInternal(q, actor, caseId, { financialStrategy, marginNotes }) {
  await q.query(
    `INSERT INTO case_internal (case_id, financial_strategy, margin_notes) VALUES ($1, $2, $3)
     ON CONFLICT (case_id) DO UPDATE SET financial_strategy = coalesce($2, case_internal.financial_strategy), margin_notes = coalesce($3, case_internal.margin_notes), updated_at = now()`,
    [caseId, financialStrategy ?? null, marginNotes ?? null]);
  await logActivity(q, caseId, actor, 'Updated financial strategy notes');
}

/** Pulls the historical-results view for this tender's department and category into the case, as a dated snapshot. */
export async function attachRateAnalysis(q, actor, caseId) {
  const c = await q.maybeOne(
    `SELECT c.estimated_value, t.department_id, t.category_id FROM submission_cases c LEFT JOIN tenders t ON t.id = c.tender_id WHERE c.id = $1`, [caseId]);
  if (!c) throw notFound('Case not found');
  const filters = awardFiltersSchema.parse({ departmentIds: c.department_id ? [c.department_id] : [], categoryIds: c.category_id ? [c.category_id] : [] });
  const analysis = await rateAnalysis(q, filters, { groupBy: 'department', estimatedValue: n(c.estimated_value) });
  const snapshot = { takenAt: new Date().toISOString(), basis: filters.departmentIds.length || filters.categoryIds.length ? 'this tender\'s department and category' : 'all results', overall: analysis.overall, band: analysis.band, bandNote: analysis.bandNote };
  await q.query(
    `INSERT INTO case_internal (case_id, rate_analysis) VALUES ($1, $2::jsonb)
     ON CONFLICT (case_id) DO UPDATE SET rate_analysis = $2::jsonb, updated_at = now()`, [caseId, JSON.stringify(snapshot)]);
  await logActivity(q, caseId, actor, 'Attached rate analysis from published results');
  return snapshot;
}

// ---- pre-bid ----------------------------------------------------------------------------------------------
export async function addPrebid(q, actor, caseId, text) {
  const row = await q.one('INSERT INTO case_prebid_queries (case_id, query_text) VALUES ($1, $2) RETURNING id', [caseId, text]);
  await logActivity(q, caseId, actor, 'Raised a pre-bid query');
  return row.id;
}
export async function respondPrebid(q, actor, caseId, queryId, response) {
  const row = await q.maybeOne('UPDATE case_prebid_queries SET department_response = $3, responded_at = now() WHERE id = $2 AND case_id = $1 RETURNING id', [caseId, queryId, response]);
  if (!row) throw notFound('Query not found');
  await logActivity(q, caseId, actor, 'Recorded the department\'s response to a pre-bid query');
}

// ---- submission, result, EMD, follow-ups --------------------------------------------------------------------
export async function saveSubmission(q, actor, caseId, s) {
  if (s.mode === 'online' && !s.portalReference) throw badRequest('Enter the portal reference of the online submission');
  if (s.mode === 'offline' && !s.trackingNumber) throw badRequest('Enter the courier or speed-post tracking number');
  await q.query(
    `INSERT INTO case_submissions (case_id, mode, portal_reference, courier_name, tracking_number, submitted_at, submitted_by)
     VALUES ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()), $7)
     ON CONFLICT (case_id) DO UPDATE SET mode = $2, portal_reference = $3, courier_name = $4, tracking_number = $5,
       submitted_at = coalesce($6::timestamptz, case_submissions.submitted_at), submitted_by = $7`,
    [caseId, s.mode, s.mode === 'online' ? s.portalReference : null, s.mode === 'offline' ? s.courierName ?? null : null, s.mode === 'offline' ? s.trackingNumber : null, s.submittedAt ?? null, actor.user?.id ?? null]);
  await logActivity(q, caseId, actor, `Recorded ${s.mode} submission`);
}

export async function saveResult(q, actor, caseId, r) {
  await q.query(
    `INSERT INTO case_results (case_id, technical_status, financial_status, outcome, our_amount, l1_amount, result_date, remarks)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (case_id) DO UPDATE SET technical_status = $2, financial_status = $3, outcome = $4, our_amount = $5, l1_amount = $6, result_date = $7, remarks = $8`,
    [caseId, r.technicalStatus ?? 'pending', r.financialStatus ?? 'pending', r.outcome, r.ourAmount ?? null, r.l1Amount ?? null, r.resultDate ?? null, r.remarks ?? null]);
  if (r.outcome !== 'pending') {
    await q.query(`UPDATE submission_cases SET outcome = $2, updated_at = now() WHERE id = $1 AND outcome IN ('pending', 'l1', 'not_l1')`, [caseId, r.outcome]);
    // What has to happen next depends on the result: refund the EMD if we lost, or chase the order and payment if we won.
    const want = r.outcome === 'l1' ? ['purchase_order', 'payment'] : ['emd_refund'];
    for (const kind of want) {
      const exists = await q.maybeOne('SELECT 1 AS x FROM case_followups WHERE case_id = $1 AND kind = $2', [caseId, kind]);
      if (!exists) await q.query(`INSERT INTO case_followups (case_id, kind, due_date) VALUES ($1, $2, current_date + $3::int)`, [caseId, kind, kind === 'payment' ? 60 : 30]);
    }
  }
  await logActivity(q, caseId, actor, `Recorded result: ${r.outcome === 'l1' ? 'won (L1)' : r.outcome === 'not_l1' ? 'not L1' : 'pending'}`);
}

export async function saveEmd(q, actor, caseId, e, emdId = null) {
  if (emdId) {
    const row = await q.maybeOne(
      `UPDATE case_emd_tracking SET instrument_type = $3, issuing_bank = $4, instrument_number = $5, amount = $6, valid_till = $7, refund_status = $8, updated_at = now()
        WHERE id = $2 AND case_id = $1 RETURNING id`,
      [caseId, emdId, e.instrumentType, e.issuingBank ?? null, e.instrumentNumber ?? null, e.amount ?? null, e.validTill ?? null, e.refundStatus ?? 'Pending']);
    if (!row) throw notFound('EMD record not found');
  } else {
    await q.query(
      `INSERT INTO case_emd_tracking (case_id, instrument_type, issuing_bank, instrument_number, amount, valid_till, refund_status) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [caseId, e.instrumentType, e.issuingBank ?? null, e.instrumentNumber ?? null, e.amount ?? null, e.validTill ?? null, e.refundStatus ?? 'Pending']);
  }
  await logActivity(q, caseId, actor, 'Updated EMD details');
}

export async function addFollowup(q, actor, caseId, f) {
  await q.query('INSERT INTO case_followups (case_id, kind, due_date, amount, reference, note) VALUES ($1, $2, $3, $4, $5, $6)', [caseId, f.kind, f.dueDate ?? null, f.amount ?? null, f.reference ?? null, f.note ?? null]);
  await logActivity(q, caseId, actor, `Added follow-up: ${f.kind}`);
}
export async function updateFollowup(q, actor, caseId, followupId, f) {
  const row = await q.maybeOne(
    `UPDATE case_followups SET status = coalesce($3, status), reference = coalesce($4, reference), note = coalesce($5, note), amount = coalesce($6, amount),
            due_date = coalesce($7::date, due_date), completed_at = CASE WHEN $3 = 'done' THEN now() WHEN $3 = 'pending' THEN NULL ELSE completed_at END
      WHERE id = $2 AND case_id = $1 RETURNING kind, status`,
    [caseId, followupId, f.status ?? null, f.reference ?? null, f.note ?? null, f.amount ?? null, f.dueDate ?? null]);
  if (!row) throw notFound('Follow-up not found');
  await logActivity(q, caseId, actor, `Follow-up ${row.kind}: ${row.status}`);
}

// ---- documents -----------------------------------------------------------------------------------------------
export async function addDocument(q, actor, caseId, { slot, name, size, mime, key, visibility }) {
  const row = await q.one(
    `INSERT INTO case_documents (case_id, slot, name, size_bytes, mime_type, storage_key, visibility, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [caseId, slot, name, size, mime ?? null, key, visibility, actor.user?.id ?? null]);
  await logActivity(q, caseId, actor, `Uploaded ${name}`);
  return row.id;
}
export const getDocument = (q, caseId, docId) =>
  q.maybeOne('SELECT id, name, mime_type, storage_key, visibility FROM case_documents WHERE id = $2 AND case_id = $1', [caseId, docId]);
export async function setDocumentVisibility(q, actor, caseId, docId, visibility) {
  const row = await q.maybeOne('UPDATE case_documents SET visibility = $3 WHERE id = $2 AND case_id = $1 RETURNING name', [caseId, docId, visibility]);
  if (!row) throw notFound('Document not found');
  await logActivity(q, caseId, actor, `${visibility === 'shared' ? 'Shared' : 'Withdrew from the client'}: ${row.name}`);
}
export async function removeDocument(q, actor, caseId, docId) {
  const row = await q.maybeOne('DELETE FROM case_documents WHERE id = $2 AND case_id = $1 RETURNING name, storage_key', [caseId, docId]);
  if (!row) throw notFound('Document not found');
  await logActivity(q, caseId, actor, `Deleted ${row.name}`);
  return row.storage_key;
}

// ---------------------------------------------------------------------------------------------------------
// Desk dashboard
// ---------------------------------------------------------------------------------------------------------
export async function deskSummary(q) {
  const byStage = await q.many(`SELECT c.stage, count(*)::int AS n FROM submission_cases c WHERE ${OPEN} GROUP BY c.stage`);
  const risk = await q.many(
    `SELECT ${SUMMARY_COLUMNS} FROM submission_cases c
      WHERE ${OPEN} AND c.deadline IS NOT NULL AND c.deadline < now() + interval '72 hours'
        AND NOT EXISTS (SELECT 1 FROM case_submissions s WHERE s.case_id = c.id)
      ORDER BY c.deadline LIMIT 20`);
  const unassigned = (await q.one(`SELECT count(*)::int AS n FROM submission_cases c WHERE ${OPEN} AND c.assigned_to IS NULL`)).n;
  const emd = await q.one(
    `SELECT coalesce(sum(e.amount), 0) AS total, count(*)::int AS instruments
       FROM case_emd_tracking e JOIN submission_cases c ON c.id = e.case_id WHERE e.refund_status = 'Pending' AND e.amount IS NOT NULL`);
  const record = (groupSql) => q.many(
    `SELECT ${groupSql} AS label, count(*) FILTER (WHERE c.outcome = 'l1')::int AS won, count(*) FILTER (WHERE c.outcome = 'not_l1')::int AS lost,
            count(*) FILTER (WHERE c.outcome = 'pending' AND ${OPEN})::int AS open
       FROM submission_cases c WHERE ${groupSql} IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 15`);
  const followups = await q.many(
    `SELECT f.id, f.case_id, f.kind, to_char(f.due_date, 'YYYY-MM-DD') AS due_date, c.tender_title, c.client_name, c.assigned_name
       FROM case_followups f JOIN submission_cases c ON c.id = f.case_id WHERE f.status = 'pending' AND f.due_date <= current_date + 7 ORDER BY f.due_date LIMIT 20`);
  return {
    stages: STAGES.filter((s) => s.key !== 'closed').map((s) => ({ ...s, count: byStage.find((x) => x.stage === s.key)?.n ?? 0 })),
    open: byStage.reduce((s, x) => s + x.n, 0),
    unassigned,
    atRisk: risk.map(summaryView),
    emdOutstanding: { amount: Number(emd.total), instruments: emd.instruments },
    byClient: await record('c.client_name'),
    byDepartment: await record('c.department'),
    followupsDue: followups.map((f) => ({ id: f.id, caseId: f.case_id, kind: f.kind, dueDate: f.due_date, title: f.tender_title, client: f.client_name, assignedName: f.assigned_name })),
  };
}

export const staffTeam = (q) => q.many(`SELECT id, name, role FROM users WHERE role IN ('analyst', 'case_manager', 'platform_admin') AND is_active ORDER BY name`);
