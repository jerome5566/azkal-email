import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/db";
import { requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { extractMergeFields } from "@/lib/email";

const Schema = z.object({
  name: z.string().min(1).max(120),
  subject: z.string().min(1).max(200),
  htmlBody: z.string().min(1),
  textBody: z.string().default(""),
});

export async function POST(req: Request) {
  const session = await requireSession();
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid template." },
      { status: 400 }
    );
  }
  const t = parsed.data;
  const fields = [...new Set([
    ...extractMergeFields(t.subject), ...extractMergeFields(t.htmlBody),
  ])];

  const r = await pool.query<{ id: number }>(
    `INSERT INTO templates (name, subject, html_body, text_body, required_merge_fields)
     VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id`,
    [t.name, t.subject, t.htmlBody, t.textBody, JSON.stringify(fields)]
  );

  await logActivity(`Template created: ${t.name}`, {
    actor: session.email, entityType: "template", entityId: r.rows[0].id,
  });

  return NextResponse.json({ ok: true, id: r.rows[0].id });
}
