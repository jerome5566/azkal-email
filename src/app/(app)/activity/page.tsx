import { pool } from "@/db";
import { ago } from "@/lib/format";
import { PageHeader, Card, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  let rows: Array<Record<string, string>> = [];
  try {
    const res = await pool.query(
      `SELECT action, actor, entity_type, ip, created_at
         FROM activity_log ORDER BY created_at DESC LIMIT 200`
    );
    rows = res.rows;
  } catch { /* empty state */ }

  return (
    <>
      <PageHeader title="Activity Log" sub="Every action taken in this application" />

      {rows.length === 0 ? (
        <EmptyState title="Nothing logged yet" body="Actions appear here as you use the application." />
      ) : (
        <Card pad={false}>
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Action</th>
                <th className="th">Who</th>
                <th className="th">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="td text-ink">{r.action}</td>
                  <td className="td">{r.actor ?? <span className="text-ink-faint">System</span>}</td>
                  <td className="td whitespace-nowrap">{ago(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
