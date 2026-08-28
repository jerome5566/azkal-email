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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const found = await client.query<{ email_normalized: string; email_raw: string }>(
      `SELECT email_normalized, email_raw FROM email_identities WHERE id = $1`,
      [Number(id)]
    );
    if (found.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "That contact does not exist." }, { status: 404 });
    }

    // The insert fires two triggers: it mirrors onto email_identities and it
    // pulls every pending queue row for this address, in this same transaction.
    await client.query(
      `INSERT INTO suppression_list (email_normalized, reason, note, created_by)
       VALUES ($1, 'manual', 'Excluded from the Contacts page', $2)
       ON CONFLICT (email_normalized) DO NOTHING`,
      [found.rows[0].email_normalized, session.email]
    );

    await client.query("COMMIT");
    await logActivity(`Contact excluded: ${found.rows[0].email_raw}`, {
      actor: session.email, entityType: "email_identity", entityId: id,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Exclusion failed." },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
