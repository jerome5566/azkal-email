/**
 * Recipient selection.
 *
 * One place that turns a set of filters into SQL, used by both the Contacts
 * screen and the campaign builder. Keeping it in one place is what stops the
 * count shown in the builder drifting from the list that actually gets queued.
 */

export interface RecipientFilters {
  source?: "broker" | "agency" | "";
  provider?: string;
  status?: string;
  excludeRoleAccounts?: boolean;
  excludePreviouslyContacted?: boolean;
  q?: string;
}

export interface BuiltQuery {
  where: string;
  params: unknown[];
}

/**
 * Builds the WHERE clause for campaign-eligible contacts.
 *
 * Two conditions are always applied and are not optional, because they are
 * correctness rather than preference:
 *   - never anyone on the suppression list
 *   - never a domain we already know is dead
 */
export function buildRecipientQuery(
  f: RecipientFilters,
  opts: { campaignId?: number } = {}
): BuiltQuery {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => (params.push(v), `$${params.length}`);

  // Non-negotiable
  clauses.push(`ei.is_suppressed = FALSE`);
  clauses.push(`(ei.verification_status IS DISTINCT FROM 'invalid')`);

  if (f.source === "broker") {
    clauses.push(`EXISTS (SELECT 1 FROM brokers b WHERE b.email_identity_id = ei.id)`);
  } else if (f.source === "agency") {
    clauses.push(`EXISTS (SELECT 1 FROM agencies a WHERE a.email_identity_id = ei.id)`);
  }

  if (f.provider) {
    clauses.push(`ei.provider_type = ${p(f.provider)}::provider_type`);
  }

  if (f.status === "unchecked") {
    clauses.push(`ei.verification_status IS NULL`);
  } else if (f.status) {
    clauses.push(`ei.verification_status = ${p(f.status)}::verification_status`);
  }

  if (f.excludeRoleAccounts) {
    clauses.push(`ei.is_role_account = FALSE`);
  }

  if (f.excludePreviouslyContacted) {
    clauses.push(`ei.contacted_count = 0`);
  }

  if (f.q?.trim()) {
    const like = `%${f.q.trim().toLowerCase()}%`;
    clauses.push(`(
      ei.email_normalized ILIKE ${p(like)}
      OR EXISTS (SELECT 1 FROM brokers b WHERE b.email_identity_id = ei.id
                 AND (b.name_en ILIKE ${p(like)} OR b.office_name_en ILIKE ${p(like)}))
      OR EXISTS (SELECT 1 FROM agencies a WHERE a.email_identity_id = ei.id
                 AND a.name_en ILIKE ${p(like)})
    )`);
  }

  // Never queue someone twice for the same campaign. The unique index makes a
  // duplicate impossible anyway, but filtering here means the count the user
  // sees matches what actually gets inserted.
  if (opts.campaignId) {
    clauses.push(`NOT EXISTS (
      SELECT 1 FROM campaign_recipients cr
       WHERE cr.campaign_id = ${p(opts.campaignId)}
         AND cr.email_identity_id = ei.id
    )`);
  }

  return { where: `WHERE ${clauses.join(" AND ")}`, params };
}

/**
 * The merge data snapshot.
 *
 * Taken once, when the recipient is queued, and stored on the row. If a contact
 * record changes later the already-queued message does not silently change with
 * it, and a message that was reviewed in a dry run is the message that sends.
 */
export const MERGE_DATA_SQL = `
  jsonb_strip_nulls(jsonb_build_object(
    'email',       ei.email_raw,
    'first_name',  COALESCE(
                     (SELECT b.name_en FROM brokers b
                       WHERE b.email_identity_id = ei.id AND b.name_en IS NOT NULL LIMIT 1),
                     (SELECT a.name_en FROM agencies a
                       WHERE a.email_identity_id = ei.id AND a.name_en IS NOT NULL LIMIT 1)),
    'company',     COALESCE(
                     (SELECT b.office_name_en FROM brokers b
                       WHERE b.email_identity_id = ei.id AND b.office_name_en IS NOT NULL LIMIT 1),
                     (SELECT a.name_en FROM agencies a
                       WHERE a.email_identity_id = ei.id AND a.name_en IS NOT NULL LIMIT 1)),
    'office_name', COALESCE(
                     (SELECT b.office_name_en FROM brokers b
                       WHERE b.email_identity_id = ei.id AND b.office_name_en IS NOT NULL LIMIT 1),
                     (SELECT a.name_en FROM agencies a
                       WHERE a.email_identity_id = ei.id AND a.name_en IS NOT NULL LIMIT 1))
  ))
`;
