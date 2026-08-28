import { NextResponse } from "next/server";
import { pool } from "@/db";
import { requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const c = await pool.query<{ name: string; status: string; from_email: string }>(
    `SELECT name, status, from_email FROM campaigns WHERE id = $1`, [Number(id)]
  );
  if (c.rowCount === 0) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (!["draft", "paused"].includes(c.rows[0].status)) {
    return NextResponse.json(
      { error: `A ${c.rows[0].status} campaign cannot be started.` }, { status: 400 }
    );
  }

  // Refuse rather than send something broken.
  const s = await pool.query<{ key: string; value: string }>(`SELECT key, value FROM system_settings`);
  const set = Object.fromEntries(s.rows.map((x) => [x.key, x.value]));
  if (!String(set.postal_address ?? "").trim()) {
    return NextResponse.json(
      { error: "Set a postal address in Settings first. It is required in the footer of every message." },
      { status: 400 }
    );
  }
  if (!c.rows[0].from_email.trim()) {
    return NextResponse.json({ error: "No From address set." }, { status: 400 });
  }

  await pool.query(
    `UPDATE campaigns
        SET status='running', paused_reason=NULL,
            started_at = COALESCE(started_at, NOW())
      WHERE id=$1`, [Number(id)]
  );

  await logActivity(
    `Campaign ${c.rows[0].status === "paused" ? "resumed" : "started"}: ${c.rows[0].name}`,
    { actor: session.email, entityType: "campaign", entityId: id }
  );
  return NextResponse.json({ ok: true });
}
