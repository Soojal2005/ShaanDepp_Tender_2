/**
 * Module M4: Production Data Ingestion & Normalization Engine
 * Shan-Deep Tender Intelligence Platform (procure-brain.com)
 * Supports Tenderbook B2B API, GeM, CPPP & State e-Procurement Feeds
 */

import crypto from 'node:crypto';

/**
 * Normalizes raw tender payloads from various Indian procurement sources into standard Shan-Deep schema
 */
export function normalizeTenderPayload(raw, provider = 'Tenderbook_API') {
  const sourceId = raw.source_tender_id || raw.tenderId || raw.sourceId || raw.ref_no || `GEN-${Date.now()}`;
  const title = (raw.title || raw.work_description || '').trim();
  const department = raw.department_name || raw.department || raw.dept || 'Public Sector Procurement';
  const category = raw.category_name || raw.category || 'Civil Works & Infrastructure';
  const state = raw.state_name || raw.state || 'All India';
  
  // Parse financial value
  let estimatedValue = null;
  let estimatedValueDisplay = 'Not Disclosed by Department';
  if (raw.estimated_value !== undefined && raw.estimated_value !== null && raw.estimated_value !== '') {
    const val = Number(raw.estimated_value);
    if (!isNaN(val) && val > 0) {
      estimatedValue = val;
      if (val >= 10000000) {
        estimatedValueDisplay = `₹ ${(val / 10000000).toFixed(2)} Cr`;
      } else if (val >= 100000) {
        estimatedValueDisplay = `₹ ${(val / 100000).toFixed(2)} Lakh`;
      } else {
        estimatedValueDisplay = `₹ ${val.toLocaleString('en-IN')}`;
      }
    }
  }

  // Parse EMD (FR-RESULT-002: Do not invent zeroes if missing)
  let emdAmount = null;
  let emdStatus = 'not_published';
  let emdDisplay = 'Not Disclosed by Department';
  if (raw.emd_amount !== undefined && raw.emd_amount !== null && raw.emd_amount !== '') {
    const emd = Number(raw.emd_amount);
    if (!isNaN(emd) && emd > 0) {
      emdAmount = emd;
      emdStatus = 'present';
      if (emd >= 10000000) {
        emdDisplay = `₹ ${(emd / 10000000).toFixed(2)} Cr`;
      } else if (emd >= 100000) {
        emdDisplay = `₹ ${(emd / 100000).toFixed(2)} Lakh`;
      } else {
        emdDisplay = `₹ ${emd.toLocaleString('en-IN')}`;
      }
    } else if (raw.emd_exempted === true || raw.emd_status === 'exempted') {
      emdStatus = 'exempted';
      emdDisplay = 'Exempted (MSME / Start-up)';
    }
  }

  // Parse Deadlines
  const deadlineStr = raw.submission_deadline || raw.closing_date || raw.deadline || null;
  const deadlineDate = deadlineStr ? new Date(deadlineStr) : null;
  const now = new Date();
  let daysLeft = 14;
  let isUrgent = false;
  let urgencyText = '14 days remaining';

  if (deadlineDate && !isNaN(deadlineDate.getTime())) {
    const diffHours = (deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    daysLeft = Math.max(0, Math.ceil(diffHours / 24));
    if (diffHours <= 72 && diffHours > 0) {
      isUrgent = true;
      urgencyText = diffHours <= 48 ? 'Closes in 48h' : 'Closes in 72h';
    } else if (diffHours <= 0) {
      urgencyText = 'Closed';
    } else {
      urgencyText = `${daysLeft} days remaining`;
    }
  }

  // Compute checksum for idempotency
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex');

  return {
    id: `TND-2026-${Math.abs(crc16(sourceId))}`,
    sourceId,
    provider,
    title,
    department,
    dept: department.split(' ')[0],
    category,
    category_name: category,
    state,
    city: raw.city || 'District HQ',
    orgType: raw.org_type || 'State Government',
    estimatedValue,
    estimatedValueDisplay,
    emdAmount,
    emdStatus,
    emdDisplay,
    tenderFee: raw.tender_fee ? `₹ ${raw.tender_fee}` : 'Exempted',
    publishDate: raw.publish_date || new Date().toISOString().split('T')[0],
    deadline: deadlineStr || '2026-11-15',
    daysLeft,
    isUrgent,
    urgencyText,
    urgencyType: isUrgent ? 'crimson' : daysLeft <= 5 ? 'amber' : 'emerald',
    status: 'Open',
    hasBoq: Boolean(raw.boq_items?.length || raw.has_boq),
    hasDocuments: Boolean(raw.documents?.length || raw.has_documents !== false),
    description: raw.description || raw.scope_of_work || title,
    eligibilitySummary: raw.eligibility || 'Standard CPWD/State technical registration and audited financial turnover required.',
    boqItems: raw.boq_items || [],
    documents: raw.documents || [
      { name: 'Notice_Inviting_Tender_NIT.pdf', size: '2.8 MB', type: 'NIT' }
    ],
    historicalContext: raw.historical_context || {
      hasHistoricalData: false,
      reason: 'No historical award records published by department.'
    },
    payloadChecksum: payloadHash,
    ingestedAt: new Date().toISOString()
  };
}

/**
 * Lightweight deterministic numeric hash
 */
function crc16(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash % 9000) + 1000;
}

/**
 * Idempotent Ingestion Sync Engine
 * Enforces deduplication on (provider, source_id)
 */
export function syncTenderBatch(rawBatch, targetCatalog, providerName = 'Tenderbook_API') {
  let inserted = 0;
  let updated = 0;
  let duplicatesSkipped = 0;

  for (const raw of rawBatch) {
    const normalized = normalizeTenderPayload(raw, providerName);
    const existingIndex = targetCatalog.findIndex(
      t => t.provider === normalized.provider && t.sourceId === normalized.sourceId
    );

    if (existingIndex >= 0) {
      if (targetCatalog[existingIndex].payloadChecksum === normalized.payloadChecksum) {
        duplicatesSkipped++;
      } else {
        targetCatalog[existingIndex] = { ...targetCatalog[existingIndex], ...normalized, updatedAt: new Date().toISOString() };
        updated++;
      }
    } else {
      targetCatalog.unshift(normalized);
      inserted++;
    }
  }

  return {
    success: true,
    provider: providerName,
    totalReceived: rawBatch.length,
    inserted,
    updated,
    duplicatesSkipped,
    catalogTotal: targetCatalog.length,
    syncTimestamp: new Date().toISOString()
  };
}

// ============================================================================
// LIVE TENDERBOOK VENDOR API CONNECTOR
// Provider: Metalbook (dev-api.tenderbook.in)
// Key Valid Till: 2026-10-25
// ============================================================================
export const TENDERBOOK_CONFIG = {
  baseUrl: process.env.TENDERBOOK_API_URL || 'https://dev-api.tenderbook.in',
  apiKey: process.env.TENDERBOOK_API_KEY || '',
  docsUrl: 'https://dev-api.tenderbook.in/doc/vendor',
  validTill: '2026-10-25'
};

/**
 * Normalizes Tenderbook VendorTenderDto into Shan-Deep enterprise schema
 */
export function normalizeTenderbookVendorDto(dto) {
  const sourceId = dto.tender_id || dto.tender_no || dto.tender_reference_id || String(dto.our_ref_no || `TB-${Date.now()}`);
  const title = (dto.tender_summary || dto.work_desc || `Tender ${dto.tender_no || ''}`).trim();
  const department = dto.authority || 'Government Authority';
  const category = dto.category || dto.sector || 'Civil Works & Infrastructure';
  const state = dto.state || 'All India';
  const city = dto.city || '';

  // Parse financial value
  let estimatedValue = null;
  let estimatedValueDisplay = 'Not Disclosed by Department';
  if (dto.tender_value && Number(dto.tender_value) > 0) {
    estimatedValue = Number(dto.tender_value);
    if (estimatedValue >= 10000000) {
      estimatedValueDisplay = `₹ ${(estimatedValue / 10000000).toFixed(2)} Cr`;
    } else if (estimatedValue >= 100000) {
      estimatedValueDisplay = `₹ ${(estimatedValue / 100000).toFixed(2)} Lakh`;
    } else {
      estimatedValueDisplay = `₹ ${estimatedValue.toLocaleString('en-IN')}`;
    }
  }

  // Parse EMD
  let emdAmount = null;
  let emdStatus = 'not_published';
  let emdDisplay = 'Not Disclosed by Department';
  if (dto.earnest_amount && Number(dto.earnest_amount) > 0) {
    emdAmount = Number(dto.earnest_amount);
    emdStatus = 'present';
    if (emdAmount >= 10000000) {
      emdDisplay = `₹ ${(emdAmount / 10000000).toFixed(2)} Cr`;
    } else if (emdAmount >= 100000) {
      emdDisplay = `₹ ${(emdAmount / 100000).toFixed(2)} Lakh`;
    } else {
      emdDisplay = `₹ ${emdAmount.toLocaleString('en-IN')}`;
    }
  }

  // Parse Deadlines
  let deadlineStr = null;
  let daysLeft = 14;
  let isUrgent = false;
  let urgencyText = 'Open Tender';
  if (dto.due_date) {
    const d = new Date(dto.due_date);
    deadlineStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const diffHours = (d.getTime() - Date.now()) / (1000 * 60 * 60);
    daysLeft = Math.max(0, Math.ceil(diffHours / 24));
    if (diffHours <= 72 && diffHours > 0) {
      isUrgent = true;
      urgencyText = diffHours <= 48 ? 'Closes in 48h' : 'Closes in 72h';
    } else if (diffHours <= 0) {
      urgencyText = 'Submission Closed';
    } else {
      urgencyText = `${daysLeft} days remaining`;
    }
  }

  let publishDateStr = null;
  if (dto.pub_date) {
    publishDateStr = new Date(dto.pub_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  const documents = (dto.s3_document_path || []).map(doc => ({
    name: doc.file_name || 'Tender Document.pdf',
    size: 'PDF',
    type: 'NIT',
    downloadId: doc.download_id
  }));

  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(dto)).digest('hex');

  return {
    id: `TND-TB-${dto.our_ref_no || crc16(sourceId)}`,
    sourceId,
    provider: `Tenderbook (${dto.procurement_source_name || 'Central Portal'})`,
    title,
    department,
    dept: department.split(' ').slice(0, 2).join(' '),
    category,
    category_name: category,
    state,
    city,
    orgType: dto.ownership || 'Government',
    estimatedValue,
    estimatedValueDisplay,
    emdAmount,
    emdStatus,
    emdDisplay,
    tenderFee: dto.doc_cost ? `₹ ${Number(dto.doc_cost).toLocaleString('en-IN')}` : 'Exempted / Free',
    publishDate: publishDateStr || 'Recently Published',
    deadline: deadlineStr || 'Open',
    daysLeft,
    isUrgent,
    urgencyText,
    urgencyType: isUrgent ? 'crimson' : daysLeft <= 5 ? 'amber' : 'emerald',
    status: dto.tender_status === 'OPEN' ? 'Open' : 'Closed',
    hasBoq: Boolean(dto.boq_details),
    hasDocuments: documents.length > 0,
    description: dto.work_desc || dto.tender_summary || title,
    eligibilitySummary: `Procurement Type: ${dto.procurement_type || 'Works'} · Authority: ${department}. Standard bidding compliance required.`,
    boqItems: [],
    documents: documents.length > 0 ? documents : [{ name: 'NIT_Tender_Notice.pdf', size: '2.4 MB', type: 'NIT' }],
    historicalContext: {
      hasHistoricalData: false,
      reason: 'Live Tenderbook feed record. Award results will sync upon technical/financial bid opening.'
    },
    payloadChecksum: payloadHash,
    ingestedAt: new Date().toISOString()
  };
}

/**
 * Live Fetcher: Calls Tenderbook POST /mb/vendor/getTenders
 */
export async function fetchTenderbookLiveTenders({ page = 0, size = 20, fetchAll = true, filter = {} } = {}) {
  const url = `${TENDERBOOK_CONFIG.baseUrl}/mb/vendor/getTenders?fetchAll=${fetchAll}&page=${page}&size=${size}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': TENDERBOOK_CONFIG.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(filter)
    });

    if (!res.ok) {
      throw new Error(`Tenderbook API responded with HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const normalized = (data.content || []).map(normalizeTenderbookVendorDto);

    return {
      success: true,
      provider: 'Tenderbook (Metalbook)',
      totalElements: data.total_elements || 0,
      totalPages: data.total_pages || 0,
      page: data.number || 0,
      pageSize: data.size || size,
      count: normalized.length,
      tenders: normalized
    };
  } catch (err) {
    return {
      success: false,
      provider: 'Tenderbook (Metalbook)',
      error: err.message
    };
  }
}

/**
 * Live Fetcher: Calls Tenderbook POST /mb/vendor/getTenderResults
 */
export async function fetchTenderbookLiveResults({ page = 0, size = 20, fetchAll = true, filter = {} } = {}) {
  const url = `${TENDERBOOK_CONFIG.baseUrl}/mb/vendor/getTenderResults?fetchAll=${fetchAll}&page=${page}&size=${size}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': TENDERBOOK_CONFIG.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(filter)
    });

    if (!res.ok) {
      throw new Error(`Tenderbook API responded with HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    return {
      success: true,
      provider: 'Tenderbook (Metalbook)',
      totalElements: data.total_elements || 0,
      totalPages: data.total_pages || 0,
      page: data.number || 0,
      pageSize: data.size || size,
      count: (data.content || []).length,
      results: data.content || []
    };
  } catch (err) {
    return {
      success: false,
      provider: 'Tenderbook (Metalbook)',
      error: err.message
    };
  }
}

