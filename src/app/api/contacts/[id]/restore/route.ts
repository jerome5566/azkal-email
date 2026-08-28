import { NextResponse } from "next/server";
import { pool } from "@/db";
import { requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  const { id } = await params;

  const found = await pool.query<{ email_normalized: string; email_raw: string; reason: string }>(
    `SELECT ei.email_normalized, ei.email_raw, s.reason
       FROM email_identities ei
       JOIN suppression_list s ON s.email_normalized = ei.email_normalized
      WHERE ei.id = $1`,
    [Number(id)]
  );

  if (found.rowCount === 0) {
    return NextResponse.json({ error: "That contact is not suppressed." }, { status: 404 });
  }

  // Bounces and unsubscribes are not reversible from the UI. Undoing a hard
  // bounce means knowingly mailing a dead address; undoing an unsubscribe
  // means mailing someone who asked you not to.
  const reason = found.rows[0].reason;
  if (reason !== "manual") {
    return NextResponse.json(
      {
        error:
          `This address was suppressed automatically (${reason.replace(/_/g, " ")}), ` +
          `so it cannot be restored here.`,
      },
      { status: 400 }
    );
  }

  await pool.query(`DELETE FROM suppression_list WHERE email_normalized = $1`, [
    found.rows[0].email_normalized,
  ]);

  await logActivity(`Contact restored: ${found.rows[0].email_raw}`, {
    actor: session.email, entityType: "email_identity", entityId: id,
  });

  return NextResponse.json({ ok: true });
}
