/**
 * Module M1, M3, M9 & M10: Security, Role-Based Access Control & FR-CASE-011 Isolation
 * Shan-Deep Tender Intelligence Platform (procure-brain.com)
 */

export const STAFF_ROLES = ['analyst', 'case_manager', 'tenant_admin', 'tenant_owner', 'platform_admin'];
export const PLATFORM_ADMIN_ROLES = ['platform_admin', 'super_admin'];

/**
 * Checks if a given role is platform-level administrator (not just tenant admin)
 */
export function isPlatformAdmin(user) {
  if (!user) return false;
  return PLATFORM_ADMIN_ROLES.includes(user.role) || user.is_platform_admin === true;
}

/**
 * Enforces FR-CASE-011: Role Visibility Isolation
 * Non-staff subscribers CANNOT view analyst notes or internal documents.
 */
export function serializeCaseForRole(caseRecord, userRole = 'subscriber') {
  if (!caseRecord) return null;
  const isStaff = STAFF_ROLES.includes(userRole);

  const serialized = {
    ...caseRecord,
    documents: (caseRecord.documents || []).filter(d => isStaff || d.visibility === 'shared'),
    analystNotes: isStaff ? (caseRecord.analystNotes || caseRecord.analyst_notes) : undefined,
    analyst_notes: isStaff ? (caseRecord.analyst_notes || caseRecord.analystNotes) : undefined
  };

  // Strip confidential internal fields if subscriber
  if (!isStaff) {
    delete serialized.internal_margin_analysis;
    delete serialized.subcontractor_pricing;
    delete serialized.pricingModel;
  }

  return serialized;
}

/**
 * Cross-Tenant Isolation Validator
 */
export function validateTenantAccess(recordOrgId, requestOrgId) {
  if (!recordOrgId || !requestOrgId) return false;
  return Number(recordOrgId) === Number(requestOrgId);
}
