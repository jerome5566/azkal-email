import { NextResponse } from "next/server";
import { pool } from "@/db";
import { requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const r = await pool.query<{ name: string }>(
    `UPDATE campaigns SET status='paused', paused_reason='Paused by hand'
      WHERE id=$1 AND status='running' RETURNING name`, [Number(id)]
  );
  if (r.rowCount === 0) {
    return NextResponse.json({ error: "Only a running campaign can be paused." }, { status: 400 });
  }

  await logActivity(`Campaign paused: ${r.rows[0].name}`, {
    actor: session.email, entityType: "campaign", entityId: id,
  });
  return NextResponse.json({ ok: true });
}
