import { pool } from "@/db";
import { requireSession } from "@/lib/auth";

/** Rejected rows as a CSV, so nothing is lost silently. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireSession();
  const { id } = await params;

  const res = await pool.query<{ row_number: number; reason: string; raw_row: unknown }>(
    `SELECT row_number, reason, raw_row FROM import_row_errors
      WHERE import_batch_id = $1 ORDER BY row_number`,
    [Number(id)]
  );

  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const cols = new Set<string>();
  for (const r of res.rows) {
    Object.keys((r.raw_row as Record<string, string>) ?? {}).forEach((k) => cols.add(k));
  }
  const colList = [...cols];

  const lines = [
    ["row_number", "reason", ...colList].map(esc).join(","),
    ...res.rows.map((r) => {
      const raw = (r.raw_row as Record<string, string>) ?? {};
      return [r.row_number, r.reason, ...colList.map((c) => raw[c])].map(esc).join(",");
    }),
  ];

  return new Response("\uFEFF" + lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="import-${id}-rejected-rows.csv"`,
    },
  });
}
