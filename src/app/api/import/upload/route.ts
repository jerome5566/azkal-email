import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { parse } from "csv-parse";
import { pool } from "@/db";
import { requireSession } from "@/lib/auth";
import { detectEncoding, readHeaders, readStream, suggestColumnMap } from "@/lib/import";

export const maxDuration = 60;

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/tmp/azkal-uploads";

export async function POST(req: Request) {
  await requireSession();

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const sourceType = String(form.get("sourceType") ?? "broker");

  if (!file) return NextResponse.json({ error: "No file was attached." }, { status: 400 });
  if (!/\.csv$/i.test(file.name)) {
    return NextResponse.json({ error: "That is not a CSV file." }, { status: 400 });
  }
  if (!["broker", "agency"].includes(sourceType)) {
    return NextResponse.json({ error: "Unknown source type." }, { status: 400 });
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const safe = file.name.replace(/[^\w.-]/g, "_");
  const stored = path.join(UPLOAD_DIR, `${Date.now()}_${safe}`);
  await fs.writeFile(stored, Buffer.from(await file.arrayBuffer()));

  const encoding = detectEncoding(stored);
  const headers = await readHeaders(stored, encoding);

  if (headers.length === 0) {
    await fs.unlink(stored).catch(() => {});
    return NextResponse.json({ error: "That file has no header row." }, { status: 400 });
  }

  // A few rows so the user can confirm the mapping visually before committing.
  const preview: Record<string, string>[] = await new Promise((resolve, reject) => {
    const rows: Record<string, string>[] = [];
    const parser = parse({
      bom: true, columns: true, to_line: 6,
      skip_empty_lines: true, relax_column_count: true, trim: true,
    });
    readStream(stored, encoding).pipe(parser)
      .on("data", (r) => rows.push(r))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });

  const res = await pool.query<{ id: number }>(
    `INSERT INTO import_batches (filename, source_type, status, encoding, storage_path)
     VALUES ($1, $2::source_type, 'mapping', $3, $4) RETURNING id`,
    [file.name, sourceType, encoding, stored]
  );

  return NextResponse.json({
    batchId: res.rows[0].id,
    headers,
    encoding,
    suggested: suggestColumnMap(headers),
    preview,
  });
}
