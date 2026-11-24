/**
 * Industry catalogue shared by registration and the matching engine.
 *
 * `value` is the canonical label stored on the enquiry / organization / user and
 * shown in the registration dropdown; it must stay byte-for-byte in sync with
 * src/content/industries.js on the frontend. `seed` are the keyword terms an
 * industry expands into so that choosing an industry already matches real tender
 * titles and BOQ text (tenders carry no "industry" column, so the industry is
 * matched through these keywords and the subscriber's own keywords).
 */
export const INDUSTRIES = Object.freeze([
  { value: 'Information Technology & Hardware', seed: ['computer', 'laptop', 'desktop', 'server', 'printer', 'scanner', 'software', 'networking', 'ups', 'projector'] },
  { value: 'CCTV & Security Systems', seed: ['cctv', 'surveillance', 'camera', 'access control', 'security system', 'biometric'] },
  { value: 'Electrical Equipment & Supplies', seed: ['transformer', 'cable', 'switchgear', 'panel', 'lighting', 'electrical', 'wiring', 'motor'] },
  { value: 'Civil Construction & Works', seed: ['construction', 'building', 'road', 'civil work', 'renovation', 'bridge', 'drainage'] },
  { value: 'Furniture & Interiors', seed: ['furniture', 'chair', 'table', 'almirah', 'desk', 'interior', 'modular'] },
  { value: 'Medical & Healthcare Equipment', seed: ['medical', 'hospital', 'surgical', 'diagnostic', 'equipment', 'patient', 'laboratory'] },
  { value: 'Pharmaceuticals & Drugs', seed: ['medicine', 'drug', 'pharmaceutical', 'tablet', 'injection', 'consumable'] },
  { value: 'Office Supplies & Stationery', seed: ['stationery', 'paper', 'printing', 'toner', 'cartridge', 'office'] },
  { value: 'Housekeeping & Facility Management', seed: ['housekeeping', 'cleaning', 'facility management', 'sanitation', 'pest control'] },
  { value: 'Manpower & Security Services', seed: ['manpower', 'security guard', 'outsourcing', 'staffing', 'deployment'] },
  { value: 'Vehicles & Transport Services', seed: ['vehicle', 'car', 'bus', 'taxi', 'hiring', 'transport', 'ambulance'] },
  { value: 'Water Supply & Sanitation', seed: ['water', 'pipe', 'pump', 'sanitation', 'plumbing', 'borewell', 'sewage'] },
  { value: 'HVAC & Air Conditioning', seed: ['air conditioner', 'hvac', 'chiller', 'cooling', 'ventilation'] },
  { value: 'Solar & Renewable Energy', seed: ['solar', 'renewable', 'photovoltaic', 'inverter', 'battery'] },
  { value: 'Laboratory & Scientific Equipment', seed: ['laboratory', 'scientific', 'reagent', 'chemical', 'microscope'] },
  { value: 'Printing & Publishing', seed: ['printing', 'publishing', 'press', 'binding', 'flex', 'banner'] },
  { value: 'Agriculture & Allied', seed: ['agriculture', 'seed', 'fertilizer', 'irrigation', 'tractor', 'pesticide'] },
  { value: 'Uniforms & Textiles', seed: ['uniform', 'textile', 'cloth', 'garment', 'footwear', 'fabric'] },
  { value: 'Food & Catering', seed: ['food', 'catering', 'ration', 'kitchen', 'mess'] },
  { value: 'Fire & Safety Equipment', seed: ['fire', 'extinguisher', 'safety', 'fire fighting'] },
  { value: 'Consultancy & Professional Services', seed: ['consultancy', 'audit', 'survey', 'design', 'professional'] },
  { value: 'Other', seed: [] },
]);

const BY_VALUE = new Map(INDUSTRIES.map((i) => [i.value.toLowerCase(), i]));

/** The keyword terms an industry label expands into (empty for unknown / "Other"). */
export function seedKeywordsForIndustry(industry) {
  if (!industry) return [];
  return BY_VALUE.get(String(industry).trim().toLowerCase())?.seed ?? [];
}

/**
 * Build the keyword list for a subscriber's seed alert profile: their own
 * free-text keywords (split on commas / newlines) first, then any industry
 * seed terms, de-duplicated case-insensitively and capped at 30.
 */
export function matchingKeywords({ keywords, industry }) {
  const fromText = String(keywords ?? '')
    .split(/[\n,]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  // A custom industry typed in the subscriber's own words (not in the catalogue,
  // and not the catch-all "Other") carries no seed terms, so the typed phrase is
  // itself used as a keyword — otherwise "their own words" would not match anything.
  const ind = String(industry ?? '').trim();
  const customIndustry = ind && ind.toLowerCase() !== 'other' && !BY_VALUE.has(ind.toLowerCase()) ? [ind] : [];
  const all = [...fromText, ...customIndustry, ...seedKeywordsForIndustry(industry)];
  const seen = new Set();
  const out = [];
  for (const w of all) {
    const key = w.toLowerCase();
    if (seen.has(key) || w.length > 80) continue;
    seen.add(key);
    out.push(w);
    if (out.length >= 30) break;
  }
  return out;
}
