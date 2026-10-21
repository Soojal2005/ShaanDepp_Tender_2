/** Small pure helpers shared across modules. */

/** Display reference for a tender / case: TND-000123, CASE-00045. Never stored. */
export const tenderRef = (id) => `TND-${String(id).padStart(6, '0')}`;
export const caseRef = (id) => `CASE-${String(id).padStart(5, '0')}`;

export const slugify = (text) =>
  String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
