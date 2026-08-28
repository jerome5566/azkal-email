import { NextResponse } from "next/server";
import { pool } from "@/db";
import { requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const r = await client.query<{ name: string }>(
      `UPDATE campaigns SET status='stopped', stopped_at=NOW(), paused_reason=NULL
        WHERE id=$1 AND status IN ('running','paused','draft','scheduled')
        RETURNING name`, [Number(id)]
    );
    if (r.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "That campaign cannot be stopped." }, { status: 400 });
    }

    // Drain what has not gone out. Everything already sent keeps its history,
    // which is the whole point of stopping rather than deleting.
    const drained = await client.query(
      `UPDATE campaign_recipients
          SET status='excluded', last_error='Campaign stopped'
        WHERE campaign_id=$1 AND status='pending'`, [Number(id)]
    );

    await client.query("COMMIT");
    await logActivity(
      `Campaign stopped: ${r.rows[0].name}, ${(drained.rowCount ?? 0).toLocaleString()} unsent recipients removed from the queue`,
      { actor: session.email, entityType: "campaign", entityId: id }
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not stop the campaign." }, { status: 500 });
  } finally {
    client.release();
  }
}
