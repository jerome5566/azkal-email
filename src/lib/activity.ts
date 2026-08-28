import { pool } from "@/db";

export async function logActivity(
  action: string,
  opts: {
    actor?: string;
    entityType?: string;
    entityId?: string | number;
    detail?: unknown;
    ip?: string;
  } = {}
) {
  try {
    await pool.query(
      `INSERT INTO activity_log (actor, action, entity_type, entity_id, detail, ip)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        opts.actor ?? null,
        action,
        opts.entityType ?? null,
        opts.entityId != null ? String(opts.entityId) : null,
        opts.detail ? JSON.stringify(opts.detail) : null,
        opts.ip ?? null,
      ]
    );
  } catch {
    /* Activity logging must never break the action it is describing. */
  }
}
