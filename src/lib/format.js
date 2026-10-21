/**
 * Display formatting. A missing figure is never shown as zero or estimated:
 * callers pass `fallback` (usually the translated "Not Disclosed by
 * Department") for values the source did not publish.
 */
const LOCALES = { EN: 'en-IN', HI: 'hi-IN' };
const TZ = 'Asia/Kolkata';

/** Rupee amount in Indian units: crore, lakh, or grouped digits. */
export function formatInr(value, fallback = '-') {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return fallback;
  const n = Number(value);
  if (n >= 1e7) return `₹ ${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹ ${(n / 1e5).toFixed(2)} Lakh`;
  return `₹ ${n.toLocaleString('en-IN')}`;
}

export function formatDate(value, lang = 'EN', fallback = '-') {
  if (!value) return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return new Intl.DateTimeFormat(LOCALES[lang] ?? 'en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ }).format(d);
}

export function formatDateTime(value, lang = 'EN', fallback = '-') {
  if (!value) return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return new Intl.DateTimeFormat(LOCALES[lang] ?? 'en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ,
  }).format(d);
}

export const formatNumber = (n, lang = 'EN') => Number(n ?? 0).toLocaleString(LOCALES[lang] ?? 'en-IN');

/** Time left to a deadline: { days, hours, expired, level } where level is crimson < 72h, amber < 7d, else emerald. */
export function timeLeft(deadline, now = Date.now()) {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - now;
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return { days: 0, hours: 0, expired: true, level: 'slate' };
  const hours = Math.floor(ms / 3600e3);
  const days = Math.floor(hours / 24);
  const level = hours < 72 ? 'crimson' : days < 7 ? 'amber' : 'emerald';
  return { days, hours, expired: false, level };
}

export const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
