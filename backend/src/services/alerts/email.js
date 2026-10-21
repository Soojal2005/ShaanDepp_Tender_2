/**
 * The daily digest email. Every value that comes from a tender (titles,
 * departments...) is third-party text, so it is always escaped. A figure the
 * source did not publish is shown as "Not disclosed", never as a number.
 */
import { button, emailShell, esc, safeUrl } from '../mail/html.js';
import { tenderRef } from '../../util.js';

const TZ = 'Asia/Kolkata';
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });

export function inr(value) {
  if (value === null || value === undefined) return 'Not disclosed';
  const n = Number(value);
  if (n >= 1e7) return `₹ ${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹ ${(n / 1e5).toFixed(2)} Lakh`;
  return `₹ ${n.toLocaleString('en-IN')}`;
}

function timeLeftText(deadline, now) {
  if (!deadline) return '';
  const hours = Math.floor((new Date(deadline).getTime() - now.getTime()) / 3_600_000);
  if (hours < 1) return 'closes within the hour';
  if (hours < 48) return `closes in ${hours}h`;
  return `closes in ${Math.floor(hours / 24)} days`;
}

function tenderRow(t, { baseUrl, now, urgent = false }) {
  const link = safeUrl(`${baseUrl}/app/search?tender=${t.id}`);
  const place = [t.city, t.state].filter(Boolean).join(', ');
  const emd = t.emd_status === 'exempted' ? 'Exempted' : inr(t.emd_amount);
  const deadline = t.submission_deadline ? `${dateTimeFmt.format(new Date(t.submission_deadline))} (${timeLeftText(t.submission_deadline, now)})` : 'Not specified';
  return `
  <tr><td style="padding:12px 0;border-bottom:1px solid #E2E8F0;">
    <div style="font-size:11px;color:#64748B;font-family:Consolas,monospace;">${esc(tenderRef(t.id))}${t.tender_no ? ` · ${esc(t.tender_no)}` : ''}${t.score != null ? ` · match ${t.score}/100` : ''}</div>
    <a href="${esc(link)}" style="font-size:14.5px;font-weight:600;color:${urgent ? '#B91C1C' : '#0B2545'};text-decoration:none;line-height:1.35;">${esc(t.title)}</a>
    <div style="font-size:12px;color:#475569;margin-top:4px;">
      ${place ? `${esc(place)} · ` : ''}Value <b>${esc(inr(t.estimated_value))}</b> · EMD ${esc(emd)}
    </div>
    <div style="font-size:12px;color:${urgent ? '#B91C1C' : '#475569'};margin-top:2px;">Deadline: <b>${esc(deadline)}</b></div>
  </td></tr>`;
}

/** Group by department, then state, keeping the best-scoring groups first. */
export function groupTenders(items) {
  const groups = new Map();
  for (const t of items) {
    const key = `${t.department ?? 'Other departments'}|${t.state ?? ''}`;
    if (!groups.has(key)) groups.set(key, { department: t.department ?? 'Other departments', state: t.state ?? null, best: t.score ?? 0, items: [] });
    const g = groups.get(key);
    g.items.push(t);
    g.best = Math.max(g.best, t.score ?? 0);
  }
  return [...groups.values()].sort((a, b) => b.best - a.best || a.department.localeCompare(b.department));
}

/**
 * @returns {{subject: string, html: string}}
 */
export function renderDigestEmail({ profile, orgName, digest, baseUrl, now = new Date(), isTest = false }) {
  const total = digest.closing.length + digest.included.length;
  const groups = groupTenders(digest.included);
  const subject = `${isTest ? '[TEST] ' : ''}Tender alert: ${profile.name} · ${total} tender${total === 1 ? '' : 's'} (${dateFmt.format(now)})`;
  const portal = `${baseUrl}/app/search`;

  const closingBlock = digest.closing.length
    ? `<div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;padding:12px 16px;margin:0 0 18px;">
         <div style="font-size:13px;font-weight:700;color:#92400E;">⚠ Closing within 72 hours (${digest.closing.length})</div>
         <div style="font-size:12px;color:#92400E;">From earlier alerts. Last chance to bid.</div>
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${digest.closing.map((t) => tenderRow(t, { baseUrl, now, urgent: true })).join('')}</table>
       </div>`
    : '';

  const groupBlocks = groups.map((g) => `
    <div style="margin:0 0 6px;padding-top:6px;">
      <div style="font-size:12px;font-weight:700;color:#0B2545;background:#EFF6FF;border-radius:6px;padding:6px 10px;">
        ${esc(g.department)}${g.state ? ` · ${esc(g.state)}` : ''} <span style="font-weight:400;color:#64748B;">(${g.items.length})</span>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${g.items.map((t) => tenderRow(t, { baseUrl, now })).join('')}</table>
    </div>`).join('');

  const overflow = digest.notInDigest > 0
    ? `<p style="font-size:12.5px;color:#475569;margin:16px 0 0;">${digest.notInDigest} more match${digest.notInDigest === 1 ? '' : 'es'} did not fit in this email (ceiling ${digest.cap} per alert). They stay in the portal, marked <i>not in digest</i>.
         <a href="${esc(safeUrl(portal))}" style="color:#0066FF;">Open the portal</a></p>`
    : '';

  const html = emailShell({
    title: subject,
    preheader: `${total} tenders for ${profile.name}`,
    bodyHtml: `
      ${isTest ? '<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:8px 12px;font-size:12px;color:#1E40AF;margin:0 0 14px;">This is a test send. Nothing was recorded, so your next real digest is unaffected.</div>' : ''}
      <p style="font-size:15px;margin:0 0 4px;"><b>${esc(profile.name)}</b></p>
      <p style="font-size:12.5px;color:#64748B;margin:0 0 18px;">${esc(orgName)} · ${digest.included.length} new tender${digest.included.length === 1 ? '' : 's'} ranked by relevance${digest.closing.length ? ` + ${digest.closing.length} closing soon` : ''}</p>
      ${total === 0 ? '<p style="font-size:13.5px;color:#475569;">No new tenders match this alert right now.</p>' : ''}
      ${closingBlock}
      ${groupBlocks}
      ${overflow}
      <p style="margin:22px 0 0;">${button('Open tender portal', portal)}</p>`,
    footerHtml: `You receive this because of the alert "${esc(profile.name)}". <a href="${esc(safeUrl(`${baseUrl}/app/alerts`))}" style="color:#64748B;">Change or pause this alert</a>.`,
  });
  return { subject, html };
}
