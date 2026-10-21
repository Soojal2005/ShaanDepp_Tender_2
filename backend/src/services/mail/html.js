/** HTML helpers shared by every outgoing email. */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for safe inclusion in HTML (tender titles are third-party data). */
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Allow only http(s) URLs in links; anything else becomes '#'. */
export const safeUrl = (url) => (/^https?:\/\//i.test(String(url ?? '')) ? String(url) : '#');

/** Branded wrapper used by all transactional emails. */
export function emailShell({ title, preheader = '', bodyHtml, footerHtml = '' }) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#F4F7FC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1E293B;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FC;padding:20px 0;">
  <tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">
      <tr><td style="background:#0B2545;padding:22px 24px;color:#ffffff;">
        <div style="font-size:18px;font-weight:700;">Shan-Deep Tender Intelligence</div>
        <div style="font-size:12px;color:#94A3B8;margin-top:4px;">procure-brain.com</div>
      </td></tr>
      <tr><td style="padding:24px;">${bodyHtml}</td></tr>
      <tr><td style="padding:16px 24px;background:#F8FAFC;font-size:11px;color:#94A3B8;text-align:center;">
        ${footerHtml || 'Sent by Shan-Deep Management Advisory, Bhopal. Replies to this email reach our team.'}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export function button(label, href) {
  return `<a href="${esc(safeUrl(href))}" style="display:inline-block;background:#0066FF;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:600;">${esc(label)}</a>`;
}
