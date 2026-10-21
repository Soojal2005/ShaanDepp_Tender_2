/**
 * Append a row to the audit log. `actor` is { user, ip } where user is the
 * signed-in user (or null for anonymous / system actions). Never put secrets,
 * tokens or password material in `metadata`.
 */
export async function audit(q, actor, action, resourceType, resourceId = null, metadata = null) {
  const user = actor?.user ?? null;
  await q.query(
    `INSERT INTO audit_events (organization_id, user_id, actor_email, action, resource_type, resource_id, ip_address, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      user?.orgId ?? null,
      user?.id ?? null,
      user?.email ?? null,
      action,
      resourceType,
      resourceId == null ? null : String(resourceId),
      actor?.ip ?? null,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
}

export const actorOf = (req) => ({ user: req.auth?.user ?? null, ip: req.ip ?? null });
