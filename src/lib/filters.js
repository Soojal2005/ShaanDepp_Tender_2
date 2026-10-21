/**
 * The tender filter set, kept in the URL so searches can be bookmarked, shared,
 * and survive the back button. The same shape is what the API, saved searches
 * and (later) alert profiles use. Amounts are rupees everywhere in this
 * object; the screen converts to lakh for display.
 */
const ID_LISTS = ['departmentIds', 'stateIds', 'cityIds', 'categoryIds'];
const TEXT_LISTS = ['scope', 'tenderTypes'];
const TEXT = ['q', 'exclude', 'valueMin', 'valueMax', 'publishFrom', 'publishTo', 'deadlineFrom', 'deadlineTo', 'status', 'alerts', 'sort'];

export const EMPTY_FILTERS = Object.freeze({
  q: '', scope: [], exclude: '', departmentIds: [], stateIds: [], cityIds: [], categoryIds: [], tenderTypes: [],
  valueMin: '', valueMax: '', publishFrom: '', publishTo: '', deadlineFrom: '', deadlineTo: '', status: 'open', alerts: 'any', sort: '',
});

const asList = (value) => (Array.isArray(value) ? value : value == null || value === '' ? [] : String(value).split(','));

/** Parse URLSearchParams (or a saved-search object) into a complete filter object. */
export function filtersFrom(source) {
  const get = source instanceof URLSearchParams ? (k) => source.get(k) : (k) => source?.[k];
  const out = { ...EMPTY_FILTERS };
  for (const key of TEXT) {
    const v = get(key);
    if (v !== null && v !== undefined && v !== '') out[key] = String(v);
  }
  for (const key of ID_LISTS) {
    out[key] = asList(get(key)).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  }
  for (const key of TEXT_LISTS) out[key] = asList(get(key)).map(String).filter(Boolean);
  return out;
}

/** Only non-default values go in the URL, keeping links short. */
export function toParams(filters, extra = {}) {
  const params = new URLSearchParams();
  for (const key of TEXT) {
    const v = filters[key];
    if (v && !(key === 'status' && v === 'open') && !(key === 'alerts' && v === 'any')) params.set(key, v);
  }
  for (const key of [...ID_LISTS, ...TEXT_LISTS]) if (filters[key]?.length) params.set(key, filters[key].join(','));
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  return params;
}

/** Query object for the API client. */
export function toQuery(filters, extra = {}) {
  const query = {};
  for (const key of TEXT) if (filters[key] && !(key === 'alerts' && filters[key] === 'any')) query[key] = filters[key];
  for (const key of [...ID_LISTS, ...TEXT_LISTS]) if (filters[key]?.length) query[key] = filters[key].join(',');
  return { ...query, ...extra };
}

/** How many things the user has narrowed down (status "open" is the default and does not count). */
export function activeFilterCount(f) {
  let n = 0;
  if (f.q) n++;
  if (f.exclude) n++;
  if (f.scope.length) n++;
  for (const key of [...ID_LISTS, 'tenderTypes']) n += f[key].length ? 1 : 0;
  if (f.valueMin || f.valueMax) n++;
  if (f.publishFrom || f.publishTo) n++;
  if (f.deadlineFrom || f.deadlineTo) n++;
  if (f.status !== 'open') n++;
  if (f.alerts !== 'any') n++;
  return n;
}

export const lakhToRupees = (lakh) => (lakh === '' || lakh == null || Number.isNaN(Number(lakh)) ? '' : String(Math.round(Number(lakh) * 100000)));
export const rupeesToLakh = (rupees) => (rupees === '' || rupees == null ? '' : String(Number(rupees) / 100000));
