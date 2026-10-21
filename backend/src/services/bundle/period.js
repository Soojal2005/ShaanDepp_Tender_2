/**
 * Weeks run Monday to Sunday in India time (IST, UTC+05:30, no daylight saving).
 * A period is identified by its Monday as 'YYYY-MM-DD'.
 */
const IST_OFFSET_MS = 5.5 * 3_600_000;
const DAY = 86_400_000;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** The India calendar date of an instant, as a UTC-midnight Date (for arithmetic on whole days). */
const istDay = (instant) => {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
};

/** Monday (IST) of the week containing `instant`, as 'YYYY-MM-DD'. */
export function mondayOf(instant) {
  const day = istDay(instant);
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return ymd(new Date(day.getTime() - sinceMonday * DAY));
}

/** The most recent complete week as of `now`: the week before the one containing it. */
export function previousWeekStart(now = new Date()) {
  return ymd(new Date(Date.parse(`${mondayOf(now)}T00:00:00Z`) - 7 * DAY));
}

/** The instant a given IST calendar date starts. */
export const istStart = (dateStr) => new Date(Date.parse(`${dateStr}T00:00:00Z`) - IST_OFFSET_MS);

export const addDays = (dateStr, days) => ymd(new Date(Date.parse(`${dateStr}T00:00:00Z`) + days * DAY));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const human = (dateStr) => { const [y, m, d] = dateStr.split('-').map(Number); return { d, m: MONTHS[m - 1], y }; };

/** "12-18 Oct 2026" or "28 Sep - 4 Oct 2026". */
export function periodLabel(startStr) {
  const a = human(startStr);
  const b = human(addDays(startStr, 6));
  if (a.m === b.m && a.y === b.y) return `${a.d}-${b.d} ${b.m} ${b.y}`;
  return `${a.d} ${a.m}${a.y === b.y ? '' : ` ${a.y}`} - ${b.d} ${b.m} ${b.y}`;
}

export const weekShort = (startStr) => { const h = human(startStr); return `${h.d} ${h.m}`; };

export const isMonday = (dateStr) => /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && new Date(`${dateStr}T00:00:00Z`).getUTCDay() === 1;
