import Link from "next/link";
import { pool } from "@/db";
import { num, ago } from "@/lib/format";
import { PageHeader, Card, EmptyState, StatusPill, Progress } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  let rows: Array<Record<string, string | number>> = [];
  try {
    const r = await pool.query(`
      SELECT c.id, c.name, c.status, c.daily_limit, c.created_at,
             t.name AS template_name,
             COUNT(cr.id)::int AS recipients,
             COUNT(cr.id) FILTER (WHERE cr.status IN ('sent','delivered'))::int AS sent,
             COUNT(cr.id) FILTER (WHERE cr.status = 'bounced')::int AS bounced
        FROM campaigns c
        LEFT JOIN templates t ON t.id = c.template_id
        LEFT JOIN campaign_recipients cr ON cr.campaign_id = c.id
       GROUP BY c.id, t.name
       ORDER BY c.created_at DESC`);
    rows = r.rows;
  } catch { /* empty state */ }

  return (
    <>
      <PageHeader
        title="Campaigns"
        sub="Every send, past and present"
        action={<Link href="/campaigns/new" className="btn-primary">
          <span className="text-[18px] leading-none">+</span> New campaign
        </Link>}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          body="A campaign pairs a template with a set of contacts. Nothing sends until you start it, and you can dry run the whole thing first."
          action={<Link href="/campaigns/new" className="btn-primary">Create a campaign</Link>}
        />
      ) : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead>
                <tr>
                  <th className="th">Campaign</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Recipients</th>
                  <th className="th text-right">Sent</th>
                  <th className="th text-right">Bounced</th>
                  <th className="th w-[170px]">Progress</th>
                  <th className="th">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={String(c.id)}>
                    <td className="td">
                      <Link href={`/campaigns/${c.id}`} className="font-medium text-ink hover:text-accent">
                        {String(c.name)}
                      </Link>
                      <div className="text-[12.5px] text-ink-faint mt-0.5">
                        {c.template_name ? String(c.template_name) : "No template"}
                      </div>
                    </td>
                    <td className="td"><StatusPill status={String(c.status)} /></td>
                    <td className="td text-right">{num(Number(c.recipients))}</td>
                    <td className="td text-right">{num(Number(c.sent))}</td>
                    <td className="td text-right">
                      {Number(c.bounced) > 0
                        ? <span className="text-bad">{num(Number(c.bounced))}</span>
                        : <span className="text-ink-faint">0</span>}
                    </td>
                    <td className="td">
                      <Progress value={Number(c.sent)} max={Number(c.recipients)} showLabel={false} />
                    </td>
                    <td className="td whitespace-nowrap">{ago(String(c.created_at))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
