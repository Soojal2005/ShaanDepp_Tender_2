/**
 * Watchlist reminders: a person who is tracking a tender hears about it as its
 * pre-bid meeting and submission deadline approach. One email per person per
 * run lists everything due; each reminder is recorded so it is sent only once.
 *
 *   submission_72h  deadline in 24..72 hours
 *   submission_24h  deadline within 24 hours
 *   prebid          pre-bid meeting within 48 hours
 */
import { audit } from './audit.js';
import { button, emailShell, esc, safeUrl } from './mail/html.js';
import { enqueueEmail } from './mail/queue.js';
import { tenderRef } from '../util.js';

const KINDS = {
  submission_72h: { title: 'Closing within 3 days', field: 'submission_deadline', note: 'Submission deadline' },
  submission_24h: { title: 'Closing within 24 hours', field: 'submission_deadline', note: 'Submission deadline' },
  prebid: { title: 'Pre-bid meeting within 48 hours', field: 'prebid_date', note: 'Pre-bid meeting' },
};
const SYSTEM_ACTOR = { user: null, ip: null };

const when = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

const DUE_SQL = `
  SELECT w.id AS item_id, w.user_id, u.name AS user_name, u.email, w.organization_id,
         t.id AS tender_id, t.title, t.department, t.state, t.submission_deadline, t.prebid_date, k.kind
    FROM watchlist_items w
    JOIN users u ON u.id = w.user_id AND u.is_active
    JOIN organizations o ON o.id = w.organization_id AND o.status = 'Active'
    JOIN tenders t ON t.id = w.tender_id AND t.status = 'Open'
    JOIN LATERAL (
      SELECT 'submission_24h' AS kind WHERE t.submission_deadline > $1::timestamptz AND t.submission_deadline <= $1::timestamptz + interval '24 hours'
      UNION ALL
      SELECT 'submission_72h' WHERE t.submission_deadline > $1::timestamptz + interval '24 hours' AND t.submission_deadline <= $1::timestamptz + interval '72 hours'
      UNION ALL
      SELECT 'prebid' WHERE t.prebid_date > $1::timestamptz AND t.prebid_date <= $1::timestamptz + interval '48 hours'
    ) k ON true
   WHERE NOT EXISTS (SELECT 1 FROM watchlist_reminders r WHERE r.watchlist_item_id = w.id AND r.kind = k.kind)
   ORDER BY w.user_id, t.submission_deadline`;

export function renderReminderEmail({ name, groups, baseUrl }) {
  const blocks = Object.entries(groups).map(([kind, rows]) => `
    <div style="margin:0 0 16px;">
      <div style="font-size:12.5px;font-weight:700;color:${kind === 'submission_24h' ? '#B91C1C' : '#92400E'};margin-bottom:4px;">${esc(KINDS[kind].title)} (${rows.length})</div>
      ${rows.map((r) => `
        <div style="padding:8px 0;border-bottom:1px solid #E2E8F0;">
          <div style="font-size:11px;color:#64748B;font-family:Consolas,monospace;">${esc(tenderRef(r.tender_id))}</div>
          <a href="${esc(safeUrl(`${baseUrl}/app/search?tender=${r.tender_id}`))}" style="font-size:14px;font-weight:600;color:#0B2545;text-decoration:none;">${esc(r.title)}</a>
          <div style="font-size:12px;color:#475569;">${esc([r.department, r.state].filter(Boolean).join(' · '))}</div>
          <div style="font-size:12px;color:#475569;">${esc(KINDS[kind].note)}: <b>${esc(when.format(new Date(r[KINDS[kind].field])))}</b></div>
        </div>`).join('')}
    </div>`).join('');
  const count = Object.values(groups).reduce((n, rows) => n + rows.length, 0);
  return {
    subject: `Reminder: ${count} tender${count === 1 ? '' : 's'} on your watchlist ${count === 1 ? 'is' : 'are'} due soon`,
    html: emailShell({
      title: 'Watchlist reminder',
      preheader: `${count} tracked tenders need attention`,
      bodyHtml: `<p style="font-size:15px;margin:0 0 14px;">Hello ${esc(name)},</p>
        <p style="font-size:13.5px;color:#475569;margin:0 0 18px;">These tenders on your watchlist have a deadline coming up.</p>
        ${blocks}
        <p style="margin:20px 0 0;">${button('Open my watchlist', `${baseUrl}/app/watchlist`)}</p>`,
    }),
  };
}

export async function queueWatchlistReminders(db, { now = new Date(), baseUrl }) {
  return db.withContext({ scope: 'system' }, async (q) => {
    const due = await q.many(DUE_SQL, [now]);
    const byUser = new Map();
    for (const row of due) {
      if (!byUser.has(row.user_id)) byUser.set(row.user_id, { user: row, groups: {} });
      (byUser.get(row.user_id).groups[row.kind] ??= []).push(row);
    }
    let emails = 0;
    for (const { user, groups } of byUser.values()) {
      const { subject, html } = renderReminderEmail({ name: user.user_name, groups, baseUrl });
      const stamp = now.toISOString().slice(0, 13);
      await enqueueEmail(q, { orgId: user.organization_id, kind: 'reminder', to: user.email, subject, html, idempotencyKey: `reminder:${user.user_id}:${stamp}` });
      emails++;
    }
    if (due.length) {
      await q.query(
        `INSERT INTO watchlist_reminders (watchlist_item_id, kind) SELECT * FROM unnest($1::int[], $2::text[]) ON CONFLICT DO NOTHING`,
        [due.map((r) => r.item_id), due.map((r) => r.kind)]
      );
      await audit(q, SYSTEM_ACTOR, 'reminders.queued', 'watchlist', null, { reminders: due.length, emails });
    }
    return { reminders: due.length, emails };
  });
}
