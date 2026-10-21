/**
 * Roles and permissions. The server decides everything from the signed-in
 * user's stored role; nothing about identity is ever read from request headers.
 *
 * Client accounts:  subscriber, tenant_admin
 * Shan-Deep staff:  analyst, case_manager, platform_admin
 */
export const CLIENT_ROLES = Object.freeze(['subscriber', 'tenant_admin']);
export const STAFF_ROLES = Object.freeze(['analyst', 'case_manager', 'platform_admin']);

export const isStaffRole = (role) => STAFF_ROLES.includes(role);

const PERMISSIONS = Object.freeze({
  // Platform administration
  'orgs:manage': ['platform_admin'],
  'users:manage': ['platform_admin'],
  'plans:manage': ['platform_admin'],
  'masters:manage': ['platform_admin'],
  'audit:view': ['platform_admin'],
  'ingestion:manage': ['platform_admin'],
  'queue:manage': ['platform_admin'],
  'reports:release': ['platform_admin', 'case_manager'],
  // Staff working areas
  'enquiries:view': ['platform_admin', 'analyst', 'case_manager'],
  'cases:work': ['platform_admin', 'analyst', 'case_manager'],
  'cases:assign': ['platform_admin', 'case_manager'],
  // Inside a client organization
  'members:manage': ['tenant_admin'],
});

export function can(user, permission) {
  if (!user) return false;
  const allowed = PERMISSIONS[permission];
  if (!allowed) throw new Error(`Unknown permission: ${permission}`);
  return allowed.includes(user.role);
}

/** Database context for a signed-in user: staff see across organizations, clients see their own. */
export function contextFor(user) {
  return isStaffRole(user.role)
    ? { scope: 'staff', orgId: user.orgId, userId: user.id }
    : { scope: 'tenant', orgId: user.orgId, userId: user.id };
}
