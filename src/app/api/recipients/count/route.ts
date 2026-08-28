import { NextResponse } from "next/server";
import { pool } from "@/db";
import { requireSession } from "@/lib/auth";
import { buildRecipientQuery, type RecipientFilters } from "@/lib/recipients";

export async function POST(req: Request) {
  await requireSession();
  const { templateId, filters } = (await req.json()) as {
    templateId: number; filters: RecipientFilters;
  };

  const { where, params } = buildRecipientQuery(filters);

  const eligible = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM email_identities ei ${where}`, params
  );

  // Contacts with no value for a field the template needs are held back rather
  // than sent a message with a gap in the greeting.
  let missing = 0;
  if (templateId) {
    const t = await pool.query<{ required_merge_fields: string[] }>(
      `SELECT required_merge_fields FROM templates WHERE id = $1`, [templateId]
    );
    const fields = t.rows[0]?.required_merge_fields ?? [];

    const needsName = fields.includes("first_name");
    const needsCompany = fields.includes("company") || fields.includes("office_name");

    if (needsName || needsCompany) {
      const conds: string[] = [];
      if (needsName) {
        conds.push(`COALESCE(
          (SELECT b.name_en FROM brokers b WHERE b.email_identity_id = ei.id
            AND b.name_en IS NOT NULL AND btrim(b.name_en) <> '' LIMIT 1),
          (SELECT a.name_en FROM agencies a WHERE a.email_identity_id = ei.id
            AND a.name_en IS NOT NULL AND btrim(a.name_en) <> '' LIMIT 1)
        ) IS NULL`);
      }
      if (needsCompany) {
        conds.push(`COALESCE(
          (SELECT b.office_name_en FROM brokers b WHERE b.email_identity_id = ei.id
            AND b.office_name_en IS NOT NULL AND btrim(b.office_name_en) <> '' LIMIT 1),
          (SELECT a.name_en FROM agencies a WHERE a.email_identity_id = ei.id
            AND a.name_en IS NOT NULL AND btrim(a.name_en) <> '' LIMIT 1)
        ) IS NULL`);
      }
      const m = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM email_identities ei
         ${where} AND (${conds.join(" OR ")})`, params
      );
      missing = Number(m.rows[0].c);
    }
  }

  const total = Number(eligible.rows[0].c);
  return NextResponse.json({
    eligible: total, missingFields: missing, sendable: total - missing,
  });
}
