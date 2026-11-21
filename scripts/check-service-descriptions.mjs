// Fails the build if a service in the catalogue has no description (or a description has no service).
import { GROUPS, itemsOf } from '../src/content/services.js';
import { DESCRIPTION_KEYS } from '../src/content/serviceDescriptions.js';

const want = GROUPS.flatMap((g) => itemsOf(g).map((i) => `${g.slug}/${i.slug}`));
const missing = want.filter((k) => !DESCRIPTION_KEYS.includes(k));
const extra = DESCRIPTION_KEYS.filter((k) => !want.includes(k));
if (missing.length || extra.length) {
  console.error('Service descriptions out of sync with src/content/services.js');
  if (missing.length) console.error('  missing:', missing.join(', '));
  if (extra.length) console.error('  no such service:', extra.join(', '));
  process.exit(1);
}
console.log(`service descriptions: ${want.length}/${want.length}`);
