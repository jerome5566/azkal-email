import { pool } from "@/db";
import { num, ago } from "@/lib/format";
import { PageHeader, Card, Pill, EmptyState, StatCard } from "@/components/ui";

export const dynamic = "force-dynamic";

const REASON_LABEL: Record<string, string> = {
  manual: "Excluded by hand",
  unsubscribe: "Unsubscribed",
  hard_bounce: "Hard bounce",
  repeated_soft_bounce: "Repeated soft bounces",
  complaint: "Marked as spam",
  invalid_address: "Invalid address",
};

const REASON_TONE: Record<string, "neutral" | "bad" | "warn"> = {
  manual: "neutral", unsubscribe: "warn", hard_bounce: "bad",
  repeated_soft_bounce: "warn", complaint: "bad", invalid_address: "bad",
};

export default async function ExclusionsPage() {
  let rows: Array<Record<string, string>> = [];
  let counts: Array<{ reason: string; c: string }> = [];
  try {
    const [r, c] = await Promise.all([
      pool.query(`SELECT s.email_normalized, s.reason, s.note, s.created_by, s.created_at
                    FROM suppression_list s ORDER BY s.created_at DESC LIMIT 200`),
      pool.query(`SELECT reason, COUNT(*)::text AS c FROM suppression_list GROUP BY reason`),
    ]);
    rows = r.rows;
    counts = c.rows;
  } catch { /* empty state below */ }

  const total = counts.reduce((a, b) => a + Number(b.c), 0);
  const byReason = Object.fromEntries(counts.map((c) => [c.reason, Number(c.c)]));

  return (
    <>
      <PageHeader
        title="Exclusions"
        sub="The global suppression list. Nothing on it can be sent to."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total suppressed" value={total} />
        <StatCard label="Excluded by hand" value={byReason.manual ?? 0} />
        <StatCard label="Unsubscribed" value={byReason.unsubscribe ?? 0} tone="warn" />
        <StatCard label="Hard bounced" value={byReason.hard_bounce ?? 0} tone="bad" />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing is suppressed"
          body="Addresses land here when you exclude them from the Contacts page, when someone unsubscribes, or when a message hard bounces."
        />
      ) : (
        <Card title={`Suppressed addresses`} sub={`Showing the ${num(rows.length)} most recent`} pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  <th className="th">Email</th>
                  <th className="th">Reason</th>
                  <th className="th">Note</th>
                  <th className="th">Added by</th>
                  <th className="th">When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="td font-medium text-ink">{r.email_normalized}</td>
                    <td className="td">
                      <Pill tone={REASON_TONE[r.reason] ?? "neutral"}>
                        {REASON_LABEL[r.reason] ?? r.reason}
                      </Pill>
                    </td>
                    <td className="td">{r.note ?? <span className="text-ink-faint">None</span>}</td>
                    <td className="td">{r.created_by ?? <span className="text-ink-faint">System</span>}</td>
                    <td className="td whitespace-nowrap">{ago(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="text-[13px] text-ink-muted mt-4 leading-relaxed max-w-2xl">
        Suppression is enforced by a database trigger and by the query the sender uses to
        take work off the queue. A bug in the application cannot route around it. Bounces
        and unsubscribes cannot be reversed from the interface.
      </p>
    </>
  );
}
