import { pool } from "@/db";
import { num, ago } from "@/lib/format";
import { PageHeader, Card, StatusPill, EmptyState } from "@/components/ui";
import { ImportWizard } from "@/components/import-wizard";

export const dynamic = "force-dynamic";

interface Batch {
  id: number; filename: string; source_type: string; status: string;
  encoding: string | null; total_rows: number; unique_emails: number;
  new_emails: number; existing_emails: number; invalid_rows: number;
  blank_email_rows: number; error: string | null; created_at: string;
}

export default async function ImportPage() {
  let batches: Batch[] = [];
  try {
    const res = await pool.query<Batch>(
      `SELECT * FROM import_batches ORDER BY created_at DESC LIMIT 20`
    );
    batches = res.rows;
  } catch {
    /* handled by the empty state below */
  }

  return (
    <>
      <PageHeader
        title="Import"
        sub="Upload the brokers and agencies CSV files"
      />

      <div className="mb-8">
        <ImportWizard />
      </div>

      <Card title="Import history" pad={batches.length === 0}>
        {batches.length === 0 ? (
          <div className="py-8 text-center text-[14px] text-ink-faint">
            Nothing imported yet.
          </div>
        ) : (
          <div className="overflow-x-auto -m-5">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr>
                  <th className="th">File</th>
                  <th className="th">Type</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Rows</th>
                  <th className="th text-right">Unique</th>
                  <th className="th text-right">New</th>
                  <th className="th text-right">Existing</th>
                  <th className="th text-right">Rejected</th>
                  <th className="th">When</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="td font-medium text-ink">
                      {b.filename}
                      {b.encoding && b.encoding !== "utf8" && (
                        <div className="text-[12px] text-ink-faint mt-0.5">
                          Decoded as {b.encoding}
                        </div>
                      )}
                      {b.error && (
                        <div className="text-[12px] text-bad mt-0.5">{b.error}</div>
                      )}
                    </td>
                    <td className="td capitalize">{b.source_type}</td>
                    <td className="td"><StatusPill status={b.status} /></td>
                    <td className="td text-right">{num(b.total_rows)}</td>
                    <td className="td text-right">{num(b.unique_emails)}</td>
                    <td className="td text-right text-good font-medium">{num(b.new_emails)}</td>
                    <td className="td text-right">{num(b.existing_emails)}</td>
                    <td className="td text-right">
                      {b.invalid_rows + b.blank_email_rows > 0 ? (
                        <a
                          href={`/api/import/${b.id}/errors`}
                          className="text-warn hover:underline font-medium"
                        >
                          {num(b.invalid_rows + b.blank_email_rows)}
                        </a>
                      ) : (
                        <span className="text-ink-faint">0</span>
                      )}
                    </td>
                    <td className="td whitespace-nowrap">{ago(b.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-[13px] text-ink-muted mt-4 leading-relaxed max-w-2xl">
        Every row that does not produce a usable address is recorded with its original
        content, so the numbers above always reconcile against the file. Click a rejected
        count to download those rows as CSV.
      </p>
    </>
  );
}
