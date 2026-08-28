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

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  const { id } = await params;
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid template." }, { status: 400 });
  }
  const t = parsed.data;

  // Editing a template that a running campaign is using would change messages
  // mid-flight. Queued recipients carry their own merge snapshot, but the body
  // is read at send time, so this has to be blocked.
  const inUse = await pool.query<{ name: string }>(
    `SELECT name FROM campaigns
      WHERE template_id = $1 AND status IN ('running','paused','scheduled')`,
    [Number(id)]
  );
  if (inUse.rowCount && inUse.rowCount > 0) {
    return NextResponse.json(
      { error: `Campaign "${inUse.rows[0].name}" is using this template and is not finished. Stop it first, or copy this template.` },
      { status: 400 }
    );
  }

  const fields = [...new Set([
    ...extractMergeFields(t.subject), ...extractMergeFields(t.htmlBody),
  ])];

  await pool.query(
    `UPDATE templates SET name=$2, subject=$3, html_body=$4, text_body=$5,
            required_merge_fields=$6::jsonb, updated_at=NOW()
      WHERE id=$1`,
    [Number(id), t.name, t.subject, t.htmlBody, t.textBody, JSON.stringify(fields)]
  );

  await logActivity(`Template updated: ${t.name}`, {
    actor: session.email, entityType: "template", entityId: id,
  });

  return NextResponse.json({ ok: true });
}
