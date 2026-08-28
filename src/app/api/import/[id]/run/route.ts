import { NextResponse } from "next/server";
import { pool } from "@/db";
import { requireSession } from "@/lib/auth";
import { runImport } from "@/lib/import";
import { logActivity } from "@/lib/activity";

export const maxDuration = 800;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  const { id } = await params;
  const { columnMap } = await req.json();

  const batchRes = await pool.query<{
    storage_path: string; encoding: string; source_type: "broker" | "agency";
    status: string; filename: string;
  }>(`SELECT storage_path, encoding, source_type, status, filename
        FROM import_batches WHERE id = $1`, [Number(id)]);

  if (batchRes.rowCount === 0) {
    return NextResponse.json({ error: "That import does not exist." }, { status: 404 });
  }
  const batch = batchRes.rows[0];

  if (batch.status === "completed") {
    return NextResponse.json(
      { error: "That file has already been imported." },
      { status: 400 }
    );
  }

  await pool.query(
    `UPDATE import_batches SET status='processing', column_map=$2 WHERE id=$1`,
    [Number(id), JSON.stringify(columnMap)]
  );

  try {
    const summary = await runImport(
      Number(id), batch.storage_path, batch.encoding,
      batch.source_type, columnMap
    );

    await logActivity(
      `Imported ${summary.newEmails.toLocaleString()} new contacts from ${batch.filename}`,
      { actor: session.email, entityType: "import_batch", entityId: id, detail: summary }
    );

    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The import failed." },
      { status: 500 }
    );
  }
}
