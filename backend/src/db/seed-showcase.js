/** Optional synthetic records for a managed demo database (including Supabase). */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoResults, demoTenders } from '../../seed/demoData.js';
import { loadMasterIndex } from '../services/ingestion/masters.js';
import { normalizeTenderbookResult, normalizeTenderbookTender } from '../services/ingestion/normalize.js';
import { upsertAward, upsertTender } from '../services/ingestion/store.js';
import { createDatabase } from './index.js';
import { config } from '../config.js';
import { migrate } from './migrate.js';
import { seedBaseline } from './seed.js';

const PROVIDER = 'sample';
const SYSTEM = { scope: 'system' };

/** Inserts a small, labelled data set once; later runs leave existing sample rows untouched. */
export async function seedShowcase(db) {
  return db.withContext(SYSTEM, async (q) => {
    await q.query(
      `INSERT INTO providers (id, name, type, status, sync_frequency_minutes)
       VALUES ($1, 'Synthetic sample records', 'excel', 'Inactive', 0)
       ON CONFLICT (id) DO NOTHING`,
      [PROVIDER]
    );
    await q.query(
      `INSERT INTO organizations (name, domain, contact_name, plan_id)
       SELECT 'Sample Infrastructure (synthetic)', 'sample.invalid', 'Sample contact', id
         FROM plans WHERE code = 'standard'
         AND NOT EXISTS (SELECT 1 FROM organizations WHERE domain = 'sample.invalid')`
    );

    const index = await loadMasterIndex(q);
    let tenders = 0;
    let results = 0;
    for (const dto of demoTenders().slice(0, 12)) {
      const { record, problems } = normalizeTenderbookTender(dto);
      if (problems.length) throw new Error(`Invalid sample tender ${dto.tender_id}: ${problems.join(', ')}`);
      record.title = `[Sample] ${record.title}`;
      const existing = await q.maybeOne('SELECT id FROM tenders WHERE provider_id = $1 AND source_id = $2', [PROVIDER, record.sourceId]);
      if (!existing) {
        await upsertTender(q, PROVIDER, record, index, dto);
        tenders++;
      }
    }
    for (const dto of demoResults().slice(0, 5)) {
      const { record, problems } = normalizeTenderbookResult(dto);
      if (problems.length) throw new Error(`Invalid sample result ${dto.tender_result_id}: ${problems.join(', ')}`);
      record.title = `[Sample] ${record.title}`;
      const existing = await q.maybeOne('SELECT id FROM historical_awards WHERE provider = $1 AND source_id = $2', [PROVIDER, record.sourceId]);
      if (!existing) {
        await upsertAward(q, PROVIDER, record, index, dto);
        results++;
      }
    }
    return { provider: PROVIDER, tenders, results };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = await createDatabase();
  try {
    if (config.db.migrateOnStart) await migrate(db);
    await seedBaseline(db);
    const result = await seedShowcase(db);
    console.log(`Sample data ready: ${result.tenders} tenders, ${result.results} award results added (provider: ${result.provider}).`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
