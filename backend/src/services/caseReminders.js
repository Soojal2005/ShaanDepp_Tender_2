/**
 * Reminders for the submission-desk team, so a deadline or a follow-up is not
 * missed. Each reminder is recorded in case_reminders and sent once.
 *
 *   deadline_72h / deadline_24h  a case whose bid has not been submitted is close to its deadline
 *   followup                     an EMD refund, purchase order or payment is due
 *   unassigned                   a new request has waited four hours without an owner
 *
 * The email goes to the person the case is assigned to, or to the case managers
 * when nobody owns it yet.
 */
import { caseRef } from '../util.js';
import { audit } from './audit.js';
import { button, emailShell, esc } from './mail/html.js';
import { enqueueEmail } from './mail/queue.js';

const SYSTEM_ACTOR = { user: null, ip: null };
const when = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

const COPY = {
  deadline_24h: (c) => ({ subject: `Deadline within 24 hours: ${c.title}`, lead: `The bid for <b>${esc(c.title)}</b> (${esc(c.client)}) is due ${esc(when.format(new Date(c.deadline)))} and has not been submitted.` }),
  deadline_72h: (c) => ({ subject: `Deadline within 3 days: ${c.title}`, lead: `The bid for <b>${esc(c.title)}</b> (${esc(c.client)}) is due ${esc(when.format(new Date(c.deadline)))} and has not been submitted.` }),
  followup: (c) => ({ subject: `Follow-up due: ${c.followKind} for ${c.title}`, lead: `A <b>${esc(c.followKind)}</b> follow-up for <b>${esc(c.title)}</b> (${esc(c.client)}) is due.` }),
  unassigned: (c) => ({ subject: `Unassigned request: ${c.title}`, lead: `<b>${esc(c.client)}</b> raised a request for <b>${esc(c.title)}</b> more than four hours ago and it has no owner.` }),
};
const FOLLOW_LABEL = { emd_refund: 'EMD refund', purchase_order: 'purchase order', payment: 'payment' };

export async function queueCaseReminders(db, { now = new Date(), baseUrl }) {
  return db.withContext({ scope: 'system' }, async (q) => {
    const candidates = [];
    const open = `c.stage <> 'closed'`;

    for (const r of await q.many(
      `SELECT c.id, c.tender_title AS title, c.client_name AS client, c.assigned_to, c.deadline,
              CASE WHEN c.deadline <= $1::timestamptz + interval '24 hours' THEN 'deadline_24h' ELSE 'deadline_72h' END AS kind
         FROM submission_cases c
        WHERE ${open} AND c.deadline > $1::timestamptz AND c.deadline <= $1::timestamptz + interval '72 hours'
          AND NOT EXISTS (SELECT 1 FROM case_submissions s WHERE s.case_id = c.id)`, [now])) {
      candidates.push({ ...r, ref: '' });
    }
    for (const r of await q.many(
      `SELECT c.id, c.tender_title AS title, c.client_name AS client, c.assigned_to, f.id AS follow_id, f.kind AS follow_kind
         FROM case_followups f JOIN submission_cases c ON c.id = f.case_id
        WHERE f.status = 'pending' AND f.due_date IS NOT NULL AND f.due_date <= ($1::timestamptz AT TIME ZONE 'Asia/Kolkata')::date`, [now])) {
      candidates.push({ ...r, kind: 'followup', followKind: FOLLOW_LABEL[r.follow_kind] ?? r.follow_kind, ref: String(r.follow_id) });
    }
    for (const r of await q.many(
      `SELECT c.id, c.tender_title AS title, c.client_name AS client, c.assigned_to FROM submission_cases c
        WHERE ${open} AND c.assigned_to IS NULL AND c.created_at < $1::timestamptz - interval '4 hours'`, [now])) {
      candidates.push({ ...r, kind: 'unassigned', ref: '' });
    }

    let reminders = 0;
    let emails = 0;
    let managers = null;
    for (const c of candidates) {
      const fresh = await q.maybeOne('INSERT INTO case_reminders (case_id, kind, ref) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id', [c.id, c.kind, c.ref]);
      if (!fresh) continue;
      reminders++;
      let to;
      if (c.assigned_to) to = await q.many('SELECT id, name, email FROM users WHERE id = $1 AND is_active', [c.assigned_to]);
      if (!to?.length) to = managers ??= await q.many(`SELECT id, name, email FROM users WHERE role IN ('case_manager', 'platform_admin') AND is_active`);
      const { subject, lead } = COPY[c.kind](c);
      for (const person of to) {
        await enqueueEmail(q, {
          kind: 'case_notice', to: person.email, subject: subject.slice(0, 200), idempotencyKey: `case-reminder:${fresh.id}:${person.id}`,
          html: emailShell({
            title: 'Submission desk reminder',
            bodyHtml: `<p style="font-size:15px;">Hello ${esc(person.name)},</p><p style="font-size:13.5px;color:#475569;">${lead}</p>
              <p style="font-size:12px;color:#64748B;">${esc(caseRef(c.id))}</p><p>${button('Open the case', `${baseUrl}/app/desk/${c.id}`)}</p>`,
          }),
        });
        emails++;
      }
    }
    if (reminders) await audit(q, SYSTEM_ACTOR, 'case.reminders.queued', 'case', null, { reminders, emails });
    return { reminders, emails };
  });
}
