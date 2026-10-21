/**
 * Writes normalized tenders and awards. Every function takes an open
 * transaction `q` (staff/system scope) and is idempotent: re-sending an
 * identical record changes nothing, re-sending a changed one updates it.
 */
import { recordSuggestion } from './masters.js';

const isoDate = (date) => (date ? date.toISOString().slice(0, 10) : null);

/** Resolve a record's names to master ids, queueing anything unrecognised. */
async function resolveMasters(q, providerId, rec, index) {
  const state = rec.state ? index.state(rec.state) : null;
  const department = rec.department ? index.department(rec.department) : null;
  const category = rec.category ? index.category(rec.category) : null;
  const city = state && rec.city ? await index.city(q, state.id, rec.city) : null;

  if (rec.state && !state) await recordSuggestion(q, 'state', rec.state, providerId);
  if (rec.department && !department) await recordSuggestion(q, 'department', rec.department, providerId);
  if (rec.category && !category) await recordSuggestion(q, 'category', rec.category, providerId);
  return { state, department, category, city };
}

async function saveRawPayload(q, providerId, kind, sourceId, raw, checksum) {
  await q.query(
    `INSERT INTO raw_tender_payloads (provider, kind, source_id, raw_json, checksum)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (provider, kind, source_id)
     DO UPDATE SET raw_json = EXCLUDED.raw_json, checksum = EXCLUDED.checksum, ingested_at = now()`,
    [providerId, kind, sourceId, JSON.stringify(raw), checksum]
  );
}

/** @returns {Promise<'inserted'|'updated'|'skipped'>} */
export async function upsertTender(q, providerId, rec, index, raw = null) {
  const m = await resolveMasters(q, providerId, rec, index);
  const row = await q.maybeOne(
    `INSERT INTO tenders
       (provider_id, source_id, source_url, tender_no, title, description,
        department, department_id, category, category_id, state, state_id, city, city_id,
        org_type, tender_type, estimated_value, emd_amount, emd_status, tender_fee,
        publish_date, prebid_date, submission_deadline, opening_date, status,
        has_boq, has_documents, eligibility_summary, payment_terms, delivery_terms, penalty_terms,
        boq_text, payload_checksum, last_source_update)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33, now())
     ON CONFLICT (provider_id, source_id) DO UPDATE SET
       source_url = EXCLUDED.source_url, tender_no = EXCLUDED.tender_no, title = EXCLUDED.title,
       description = EXCLUDED.description, department = EXCLUDED.department, department_id = EXCLUDED.department_id,
       category = EXCLUDED.category, category_id = EXCLUDED.category_id, state = EXCLUDED.state,
       state_id = EXCLUDED.state_id, city = EXCLUDED.city, city_id = EXCLUDED.city_id,
       org_type = EXCLUDED.org_type, tender_type = EXCLUDED.tender_type,
       estimated_value = EXCLUDED.estimated_value, emd_amount = EXCLUDED.emd_amount,
       emd_status = EXCLUDED.emd_status, tender_fee = EXCLUDED.tender_fee,
       publish_date = EXCLUDED.publish_date, prebid_date = EXCLUDED.prebid_date,
       submission_deadline = EXCLUDED.submission_deadline, opening_date = EXCLUDED.opening_date,
       status = EXCLUDED.status, has_boq = EXCLUDED.has_boq, has_documents = EXCLUDED.has_documents,
       eligibility_summary = EXCLUDED.eligibility_summary, payment_terms = EXCLUDED.payment_terms,
       delivery_terms = EXCLUDED.delivery_terms, penalty_terms = EXCLUDED.penalty_terms,
       boq_text = EXCLUDED.boq_text, payload_checksum = EXCLUDED.payload_checksum, last_source_update = now()
     WHERE tenders.payload_checksum IS DISTINCT FROM EXCLUDED.payload_checksum
     RETURNING id, (xmax = 0) AS inserted`,
    [
      providerId, rec.sourceId, rec.sourceUrl, rec.tenderNo, rec.title, rec.description,
      m.department?.name ?? rec.department, m.department?.id ?? null,
      m.category?.name ?? rec.category, m.category?.id ?? null,
      m.state?.name ?? rec.state, m.state?.id ?? null,
      m.city?.name ?? rec.city, m.city?.id ?? null,
      rec.orgType, rec.tenderType, rec.estimatedValue, rec.emdAmount, rec.emdStatus, rec.tenderFee,
      rec.publishDate, rec.prebidDate, rec.submissionDeadline, rec.openingDate, rec.status,
      rec.hasBoq, rec.hasDocuments, rec.eligibilitySummary, rec.paymentTerms, rec.deliveryTerms, rec.penaltyTerms,
      rec.boqText, rec.checksum,
    ]
  );
  if (!row) return 'skipped';

  await q.query('DELETE FROM tender_documents WHERE tender_id = $1', [row.id]);
  for (const d of rec.documents) {
    await q.query(
      'INSERT INTO tender_documents (tender_id, name, doc_type, url, external_id) VALUES ($1,$2,$3,$4,$5)',
      [row.id, d.name, d.type, d.url, d.externalId]
    );
  }
  await q.query('DELETE FROM tender_boq_items WHERE tender_id = $1', [row.id]);
  for (const i of rec.boqItems) {
    await q.query(
      `INSERT INTO tender_boq_items (tender_id, item_code, item_name, quantity, unit, estimated_rate, total_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [row.id, i.code ?? null, i.name, i.quantity ?? null, i.unit ?? null, i.rate ?? null, i.total ?? null]
    );
  }
  if (raw) await saveRawPayload(q, providerId, 'tender', rec.sourceId, raw, rec.checksum);
  return row.inserted ? 'inserted' : 'updated';
}

/** @returns {Promise<'inserted'|'updated'|'skipped'>} */
export async function upsertAward(q, providerId, rec, index, raw = null) {
  const previous = await q.maybeOne(
    `SELECT checksum FROM raw_tender_payloads WHERE provider = $1 AND kind = 'result' AND source_id = $2`,
    [providerId, rec.sourceId]
  );
  if (previous?.checksum === rec.checksum) return 'skipped';

  const m = await resolveMasters(q, providerId, rec, index);
  // Tie the award back to the tender it came from, when we hold that tender.
  const refs = [rec.tenderRef, rec.sourceTenderRef].filter(Boolean);
  const tender = refs.length
    ? await q.maybeOne(
        `SELECT id, estimated_value FROM tenders WHERE tender_no = ANY($1::text[]) OR source_id = ANY($1::text[]) LIMIT 1`,
        [refs]
      )
    : null;

  const row = await q.one(
    `INSERT INTO historical_awards
       (provider, source_id, tender_id, tender_ref, source_tender_ref, tender_title,
        department, department_id, category, category_id, state, state_id, city,
        estimated_value, awarded_value, winner_name, l1_amount, l2_bidder_name, l2_amount, rate_status,
        item_name, unit, unit_rate, bidder_count, qualified_count, award_date, work_order_ref, source_portal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
     ON CONFLICT (provider, source_id) DO UPDATE SET
       tender_id = EXCLUDED.tender_id, tender_ref = EXCLUDED.tender_ref, source_tender_ref = EXCLUDED.source_tender_ref,
       tender_title = EXCLUDED.tender_title, department = EXCLUDED.department, department_id = EXCLUDED.department_id,
       category = EXCLUDED.category, category_id = EXCLUDED.category_id, state = EXCLUDED.state,
       state_id = EXCLUDED.state_id, city = EXCLUDED.city, estimated_value = EXCLUDED.estimated_value,
       awarded_value = EXCLUDED.awarded_value, winner_name = EXCLUDED.winner_name, l1_amount = EXCLUDED.l1_amount,
       l2_bidder_name = EXCLUDED.l2_bidder_name, l2_amount = EXCLUDED.l2_amount, rate_status = EXCLUDED.rate_status,
       item_name = EXCLUDED.item_name, unit = EXCLUDED.unit, unit_rate = EXCLUDED.unit_rate,
       bidder_count = EXCLUDED.bidder_count, qualified_count = EXCLUDED.qualified_count,
       award_date = EXCLUDED.award_date, work_order_ref = EXCLUDED.work_order_ref, source_portal = EXCLUDED.source_portal
     RETURNING id, (xmax = 0) AS inserted`,
    [
      providerId, rec.sourceId, tender?.id ?? null, rec.tenderRef, rec.sourceTenderRef, rec.title,
      m.department?.name ?? rec.department, m.department?.id ?? null,
      m.category?.name ?? rec.category, m.category?.id ?? null,
      m.state?.name ?? rec.state, m.state?.id ?? null, rec.city,
      rec.estimatedValue ?? tender?.estimated_value ?? null, rec.awardedValue, rec.winnerName, rec.l1Amount,
      rec.l2BidderName, rec.l2Amount, rec.rateStatus, rec.itemName, rec.unit, rec.unitRate,
      rec.bidderCount, rec.qualifiedCount, isoDate(rec.awardDate), rec.workOrderRef, rec.sourcePortal,
    ]
  );

  await q.query('DELETE FROM award_bidders WHERE award_id = $1', [row.id]);
  for (const b of rec.bidders ?? []) {
    await q.query(
      `INSERT INTO award_bidders (award_id, bidder_name, quoted_amount, rank_position, technically_qualified, is_l1)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [row.id, b.name, b.amount, b.rank, b.technicallyQualified, b.isL1]
    );
  }
  if (raw) await saveRawPayload(q, providerId, 'result', rec.sourceId, raw, rec.checksum);
  return row.inserted ? 'inserted' : 'updated';
}

/**
 * After an administrator maps a suggestion, point existing rows that carry the
 * same raw text at the chosen master entry.
 */
export async function backfillMapping(q, kind, rawValue, master) {
  const table = { department: 'department', category: 'category', state: 'state' }[kind];
  if (!table) return 0;
  const tendersResult = await q.query(
    `UPDATE tenders SET ${table}_id = $1, ${table} = $2
      WHERE ${table}_id IS NULL AND lower(${table}) = lower($3)`,
    [master.id, master.name, rawValue]
  );
  await q.query(
    `UPDATE historical_awards SET ${table}_id = $1, ${table} = $2
      WHERE ${table}_id IS NULL AND lower(${table}) = lower($3)`,
    [master.id, master.name, rawValue]
  );
  return tendersResult.rowCount;
}
