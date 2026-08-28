import fs from "node:fs";
import { parse } from "csv-parse";
import iconv from "iconv-lite";
import { pool } from "@/db";
import { parseEmail } from "./email";

/* -------------------------------------------------------------- encoding */

/**
 * Registry exports arrive in whatever the exporting tool felt like. Getting
 * this wrong silently mangles every Arabic name, so we detect rather than
 * assume. UTF-8 is validated by attempting a strict decode; if that fails we
 * fall back to Windows-1256, which is the usual Arabic legacy encoding.
 */
export function detectEncoding(path: string): "utf8" | "utf8-bom" | "win1256" {
  const fd = fs.openSync(path, "r");
  const buf = Buffer.alloc(Math.min(65536, fs.statSync(path).size));
  fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);

  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return "utf8-bom";

  const decoded = buf.toString("utf8");
  if (!decoded.includes("\uFFFD")) return "utf8";
  return "win1256";
}

export function readStream(path: string, encoding: string): NodeJS.ReadableStream {
  const raw = fs.createReadStream(path);
  if (encoding === "win1256") return raw.pipe(iconv.decodeStream("win1256"));
  if (encoding === "utf8-bom") {
    return raw.pipe(iconv.decodeStream("utf8")); // iconv strips the BOM
  }
  return raw.pipe(iconv.decodeStream("utf8"));
}

/* --------------------------------------------------------- column mapping */

export type FieldKey =
  | "email" | "name_en" | "name_ar" | "broker_number" | "office_number"
  | "office_name_en" | "office_name_ar" | "website" | "phone";

const HEADER_HINTS: Record<FieldKey, string[]> = {
  email: ["email", "e-mail", "mail", "email address", "بريد"],
  name_en: ["name english", "name en", "english name", "name", "full name", "broker name"],
  name_ar: ["name arabic", "name ar", "arabic name", "الاسم"],
  broker_number: ["broker number", "broker no", "broker id", "brn", "license"],
  office_number: ["office number", "office no", "office id", "orn", "registration"],
  office_name_en: ["office name english", "office name en", "office name", "company", "agency"],
  office_name_ar: ["office name arabic", "office name ar"],
  website: ["website", "web", "url", "site"],
  phone: ["phone", "phone number", "mobile", "tel", "telephone", "contact"],
};

/** Best-effort auto-map. The UI always shows the result for confirmation. */
export function suggestColumnMap(headers: string[]): Partial<Record<FieldKey, string>> {
  const map: Partial<Record<FieldKey, string>> = {};
  const norm = (s: string) => s.toLowerCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ").trim();
  const used = new Set<string>();

  for (const [field, hints] of Object.entries(HEADER_HINTS) as [FieldKey, string[]][]) {
    // Exact match first, then prefix, so "name english" beats "name".
    for (const pass of [0, 1]) {
      for (const h of headers) {
        if (used.has(h)) continue;
        const n = norm(h);
        const hit = pass === 0 ? hints.some((x) => n === x) : hints.some((x) => n.includes(x));
        if (hit) {
          map[field] = h;
          used.add(h);
          break;
        }
      }
      if (map[field]) break;
    }
  }
  return map;
}

export async function readHeaders(path: string, encoding: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const headers: string[] = [];
    const parser = parse({ bom: true, to_line: 1, relax_column_count: true });
    readStream(path, encoding)
      .pipe(parser)
      .on("data", (row: string[]) => headers.push(...row.map((h) => h.trim())))
      .on("end", () => resolve(headers))
      .on("error", reject);
  });
}

/* ------------------------------------------------------------- the import */

export interface ImportSummary {
  totalRows: number;
  uniqueEmails: number;
  newEmails: number;
  existingEmails: number;
  invalidRows: number;
  blankEmailRows: number;
}

/**
 * Streams the file, resolves each row to a canonical email identity, and links
 * the broker/agency record to it.
 *
 * Nothing is silently discarded. Every row that does not produce a usable
 * address is written to import_row_errors with its original content, so the
 * import summary always reconciles against the file.
 */
export async function runImport(
  batchId: number,
  path: string,
  encoding: string,
  sourceType: "broker" | "agency",
  columnMap: Partial<Record<FieldKey, string>>,
  onProgress?: (rowsDone: number) => void
): Promise<ImportSummary> {
  const client = await pool.connect();
  const summary: ImportSummary = {
    totalRows: 0, uniqueEmails: 0, newEmails: 0,
    existingEmails: 0, invalidRows: 0, blankEmailRows: 0,
  };
  const seen = new Set<string>();

  const emailCol = columnMap.email;
  if (!emailCol) throw new Error("No email column was mapped.");

  try {
    await client.query("BEGIN");

    const parser = parse({
      bom: true,
      columns: (hdr: string[]) => hdr.map((h) => h.trim()),
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    });

    const stream = readStream(path, encoding).pipe(parser);
    let rowNumber = 1;
    let batchOps: Promise<unknown>[] = [];

    for await (const row of stream as AsyncIterable<Record<string, string>>) {
      rowNumber++;
      summary.totalRows++;

      const rawEmail = (row[emailCol] ?? "").trim();

      if (!rawEmail) {
        summary.blankEmailRows++;
        await client.query(
          `INSERT INTO import_row_errors (import_batch_id, row_number, reason, raw_row)
           VALUES ($1,$2,$3,$4)`,
          [batchId, rowNumber, "No email address in this row", JSON.stringify(row)]
        );
        continue;
      }

      const parsed = parseEmail(rawEmail);
      if (!parsed || parsed.isDisposable) {
        summary.invalidRows++;
        await client.query(
          `INSERT INTO import_row_errors (import_batch_id, row_number, reason, raw_row)
           VALUES ($1,$2,$3,$4)`,
          [
            batchId,
            rowNumber,
            parsed?.isDisposable
              ? `Disposable address domain: ${parsed.domain}`
              : `Not a valid email address: ${rawEmail.slice(0, 120)}`,
            JSON.stringify(row),
          ]
        );
        continue;
      }

      const isNewInThisFile = !seen.has(parsed.normalized);
      if (isNewInThisFile) {
        seen.add(parsed.normalized);
        summary.uniqueEmails++;
      }

      // Resolve or create the canonical identity. xmax = 0 distinguishes a
      // freshly inserted row from one that already existed.
      const res = await client.query<{ id: string; was_new: boolean }>(
        `INSERT INTO email_identities
           (email_raw, email_normalized, local_part, domain, provider_type, is_role_account)
         VALUES ($1,$2,$3,$4,$5::provider_type,$6)
         ON CONFLICT (email_normalized) DO UPDATE
           SET email_raw = email_identities.email_raw
         RETURNING id, (xmax = 0) AS was_new`,
        [
          parsed.raw, parsed.normalized, parsed.localPart,
          parsed.domain, parsed.providerType, parsed.isRoleAccount,
        ]
      );

      const identityId = Number(res.rows[0].id);
      if (isNewInThisFile) {
        if (res.rows[0].was_new) summary.newEmails++;
        else summary.existingEmails++;
      }

      const get = (k: FieldKey) => {
        const col = columnMap[k];
        const v = col ? (row[col] ?? "").trim() : "";
        return v === "" ? null : v;
      };

      if (sourceType === "broker") {
        await client.query(
          `INSERT INTO brokers
             (email_identity_id, broker_number, name_en, name_ar,
              office_name_en, office_name_ar, phone, import_batch_id, raw_row)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            identityId, get("broker_number"), get("name_en"), get("name_ar"),
            get("office_name_en"), get("office_name_ar"), get("phone"),
            batchId, JSON.stringify(row),
          ]
        );
      } else {
        await client.query(
          `INSERT INTO agencies
             (email_identity_id, office_number, name_en, name_ar,
              website, phone, import_batch_id, raw_row)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            identityId, get("office_number"), get("name_en"), get("name_ar"),
            get("website"), get("phone"), batchId, JSON.stringify(row),
          ]
        );
      }

      if (summary.totalRows % 500 === 0) {
        onProgress?.(summary.totalRows);
        await client.query(
          `UPDATE import_batches SET total_rows = $2 WHERE id = $1`,
          [batchId, summary.totalRows]
        );
      }
    }

    await client.query(
      `UPDATE import_batches
          SET status='completed', total_rows=$2, unique_emails=$3, new_emails=$4,
              existing_emails=$5, invalid_rows=$6, blank_email_rows=$7,
              completed_at=NOW()
        WHERE id=$1`,
      [
        batchId, summary.totalRows, summary.uniqueEmails, summary.newEmails,
        summary.existingEmails, summary.invalidRows, summary.blankEmailRows,
      ]
    );

    await client.query("COMMIT");
    return summary;
  } catch (err) {
    await client.query("ROLLBACK");
    await pool.query(
      `UPDATE import_batches SET status='failed', error=$2 WHERE id=$1`,
      [batchId, err instanceof Error ? err.message : String(err)]
    );
    throw err;
  } finally {
    client.release();
  }
}
