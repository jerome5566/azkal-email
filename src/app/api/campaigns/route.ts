import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/db";
import { requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { buildRecipientQuery, MERGE_DATA_SQL } from "@/lib/recipients";

export const maxDuration = 300;

const Schema = z.object({
  name: z.string().min(1).max(160),
  templateId: z.number().int().positive(),
  dailyLimit: z.number().int().min(1).max(5000),
  maxBounceRate: z.number().min(0.5).max(50),
  filters: z.object({
    source: z.enum(["", "broker", "agency"]).optional(),
    provider: z.string().optional(),
    excludeRoleAccounts: z.boolean().optional(),
    excludePreviouslyContacted: z.boolean().optional(),
  }),
});

export async function POST(req: Request) {
  const session = await requireSession();
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid campaign." },
      { status: 400 }
    );
  }
  const c = parsed.data;

  const s = await pool.query<{ key: string; value: string }>(`SELECT key, value FROM system_settings`);
  const set = Object.fromEntries(s.rows.map((x) => [x.key, x.value]));

  const t = await pool.query<{ required_merge_fields: string[] }>(
    `SELECT required_merge_fields FROM templates WHERE id = $1`, [c.templateId]
  );
  if (t.rowCount === 0) {
    return NextResponse.json({ error: "That template does not exist." }, { status: 400 });
  }
  const fields = t.rows[0].required_merge_fields ?? [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const created = await client.query<{ id: number }>(
      `INSERT INTO campaigns
         (name, status, template_id, from_name, from_email, reply_to,
          daily_limit, send_window_start, send_window_end, send_days,
          timezone, exclude_previously_contacted, max_bounce_rate)
       VALUES ($1,'draft',$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
       RETURNING id`,
      [
        c.name, c.templateId,
        String(set.from_name ?? "Azkal Media"),
        String(set.from_email ?? ""),
        String(set.reply_to ?? ""),
        c.dailyLimit,
        String(set.send_window_start ?? "08:00"),
        String(set.send_window_end ?? "18:00"),
        JSON.stringify(set.send_days ?? [0,1,2,3,4,5,6]),
        String(set.timezone ?? "Asia/Dubai"),
        c.filters.excludePreviouslyContacted ?? true,
        c.maxBounceRate,
      ]
    );
    const campaignId = created.rows[0].id;

    const { where, params } = buildRecipientQuery(c.filters, { campaignId });

    // Hold back anyone missing a field the template needs, rather than sending
    // them "Hi ,". Same predicate the builder counted with.
    const guards: string[] = [];
    if (fields.includes("first_name")) {
      guards.push(`COALESCE(
        (SELECT b.name_en FROM brokers b WHERE b.email_identity_id = ei.id
          AND b.name_en IS NOT NULL AND btrim(b.name_en) <> '' LIMIT 1),
        (SELECT a.name_en FROM agencies a WHERE a.email_identity_id = ei.id
          AND a.name_en IS NOT NULL AND btrim(a.name_en) <> '' LIMIT 1)
      ) IS NOT NULL`);
    }
    if (fields.includes("company") || fields.includes("office_name")) {
      guards.push(`COALESCE(
        (SELECT b.office_name_en FROM brokers b WHERE b.email_identity_id = ei.id
          AND b.office_name_en IS NOT NULL AND btrim(b.office_name_en) <> '' LIMIT 1),
        (SELECT a.name_en FROM agencies a WHERE a.email_identity_id = ei.id
          AND a.name_en IS NOT NULL AND btrim(a.name_en) <> '' LIMIT 1)
      ) IS NOT NULL`);
    }
    const guardSql = guards.length ? ` AND ${guards.join(" AND ")}` : "";

    const inserted = await client.query(
      `INSERT INTO campaign_recipients (campaign_id, email_identity_id, status, merge_data)
       SELECT ${campaignId}, ei.id, 'pending', ${MERGE_DATA_SQL}
         FROM email_identities ei
        ${where}${guardSql}
       ON CONFLICT (campaign_id, email_identity_id) DO NOTHING`,
      params
    );

    await client.query("COMMIT");

    await logActivity(
      `Campaign created: ${c.name} with ${(inserted.rowCount ?? 0).toLocaleString()} recipients`,
      { actor: session.email, entityType: "campaign", entityId: campaignId }
    );

    return NextResponse.json({ ok: true, id: campaignId, queued: inserted.rowCount });
  } catch (err) {
    await client.query("ROLLBACK");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create the campaign." },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
