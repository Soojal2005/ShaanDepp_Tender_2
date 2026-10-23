/**
 * Maps the free-text names sources send (department, category, state, city)
 * onto the client-controlled master lists.
 *
 * Matching is deliberately conservative and explainable:
 *   1. exact match on the name or any alias (ignoring case and punctuation);
 *   2. for departments, an exact match on a bracketed abbreviation, e.g.
 *      "National Highways Authority of India (NHAI)";
 *   3. for departments, an alias (3+ characters) appearing as a whole word.
 * Anything else is NOT guessed: the raw text is kept on the tender and queued
 * in master_suggestions for an administrator to map or ignore.
 */
import { normalizeKey, titleCase } from './normalize.js';

const wholeWord = (haystack, needle) => ` ${haystack} `.includes(` ${needle} `);

function buildLookup(rows) {
  const exact = new Map();
  const aliasList = [];
  for (const row of rows) {
    exact.set(normalizeKey(row.name), row);
    for (const alias of row.aliases ?? []) {
      const key = normalizeKey(alias);
      if (!key) continue;
      if (!exact.has(key)) exact.set(key, row);
      if (key.length >= 3) aliasList.push([key, row]);
    }
  }
  aliasList.sort((a, b) => b[0].length - a[0].length); // longest alias wins
  return { exact, aliasList };
}

export async function loadMasterIndex(q) {
  // q is one PostgreSQL transaction/connection; issue its queries sequentially.
  const states = await q.many('SELECT id, name, aliases FROM states');
  const departments = await q.many('SELECT id, name, aliases FROM departments WHERE is_active');
  const categories = await q.many('SELECT id, name, aliases FROM tender_categories WHERE is_active');
  const cities = await q.many('SELECT id, state_id, name FROM cities');
  const stateLookup = buildLookup(states);
  const deptLookup = buildLookup(departments);
  const catLookup = buildLookup(categories);
  const cityByKey = new Map(cities.map((c) => [`${c.state_id}:${normalizeKey(c.name)}`, c]));

  const find = (lookup, raw, { fuzzy }) => {
    const key = normalizeKey(raw);
    if (!key) return null;
    const direct = lookup.exact.get(key);
    if (direct) return direct;
    if (!fuzzy) return null;
    for (const token of String(raw).match(/\(([^)]+)\)/g) ?? []) {
      const hit = lookup.exact.get(normalizeKey(token));
      if (hit) return hit;
    }
    for (const [alias, row] of lookup.aliasList) if (wholeWord(key, alias)) return row;
    return null;
  };

  return {
    state: (raw) => find(stateLookup, raw, { fuzzy: true }),
    department: (raw) => find(deptLookup, raw, { fuzzy: true }),
    category: (raw) => find(catLookup, raw, { fuzzy: false }),
    /** Cities are free-form; an unknown one is created under its state rather than queued. */
    async city(q, stateId, raw) {
      const name = titleCase(String(raw ?? '').trim());
      if (!stateId || !name || name.length < 2 || name.length > 100) return null;
      const key = `${stateId}:${normalizeKey(name)}`;
      const known = cityByKey.get(key);
      if (known) return known;
      const row = await q.one(
        `INSERT INTO cities (state_id, name) VALUES ($1, $2)
         ON CONFLICT (state_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id, state_id, name`,
        [stateId, name]
      );
      cityByKey.set(key, row);
      return row;
    },
  };
}

/** Remember a value that matched nothing, counting how often it is seen. */
export async function recordSuggestion(q, kind, raw, providerId) {
  const value = String(raw ?? '').trim();
  if (!value || value.length > 250) return;
  await q.query(
    `INSERT INTO master_suggestions (kind, raw_value, provider_id) VALUES ($1, $2, $3)
     ON CONFLICT (kind, raw_value) DO UPDATE
       SET seen_count = master_suggestions.seen_count + 1, last_seen_at = now()
     WHERE master_suggestions.status = 'open'`,
    [kind, value, providerId]
  );
}
