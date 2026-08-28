import { pool } from "@/db";
import { dubaiToday, num, ago } from "@/lib/format";
import { PageHeader, StatCard, Card, Progress, Pill, StatusPill, EmptyState } from "@/components/ui";
import { DomainChart } from "@/components/domain-chart";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface Totals {
  total_contacts: number; valid: number; invalid: number; risky: number;
  unknown_v: number; suppressed: number; contacted: number;
  gmail: number; outlook: number; yahoo: number; company: number; other_free: number;
}

async function loadDashboard() {
  const today = dubaiToday();

  const totalsQ = pool.query<Totals>(`
    SELECT
      COUNT(*)                                                   AS total_contacts,
      COUNT(*) FILTER (WHERE verification_status = 'valid')       AS valid,
      COUNT(*) FILTER (WHERE verification_status = 'invalid')     AS invalid,
      COUNT(*) FILTER (WHERE verification_status = 'risky')       AS risky,
      COUNT(*) FILTER (WHERE verification_status IS NULL
                          OR verification_status = 'unknown')     AS unknown_v,
      COUNT(*) FILTER (WHERE is_suppressed)                       AS suppressed,
      COUNT(*) FILTER (WHERE contacted_count > 0)                 AS contacted,
      COUNT(*) FILTER (WHERE provider_type = 'gmail')             AS gmail,
      COUNT(*) FILTER (WHERE provider_type = 'outlook')           AS outlook,
      COUNT(*) FILTER (WHERE provider_type = 'yahoo')             AS yahoo,
      COUNT(*) FILTER (WHERE provider_type = 'company')           AS company,
      COUNT(*) FILTER (WHERE provider_type = 'other_free')        AS other_free
    FROM email_identities
  `);

  const sendQ = pool.query<{
    sent: number; delivered: number; bounced: number; failed: number; unknown_s: number;
  }>(`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('sent','delivered')) AS sent,
      COUNT(*) FILTER (WHERE status = 'delivered')           AS delivered,
      COUNT(*) FILTER (WHERE status = 'bounced')             AS bounced,
      COUNT(*) FILTER (WHERE status = 'failed')              AS failed,
      COUNT(*) FILTER (WHERE status = 'unknown')             AS unknown_s
    FROM campaign_recipients
  `);

  const usageQ = pool.query<{ sent_count: number }>(
    `SELECT sent_count FROM daily_sending_usage WHERE usage_date=$1 AND campaign_id=0`,
    [today]
  );

  const limitQ = pool.query<{ value: number }>(
    `SELECT value::text::int AS value FROM system_settings WHERE key='global_daily_limit'`
  );

  const campaignsQ = pool.query(`
    SELECT c.id, c.name, c.status, c.daily_limit,
           COUNT(cr.id)                                            AS recipients,
           COUNT(cr.id) FILTER (WHERE cr.status IN ('sent','delivered')) AS sent,
           COALESCE(d.sent_count, 0)                               AS sent_today
      FROM campaigns c
      LEFT JOIN campaign_recipients cr ON cr.campaign_id = c.id
      LEFT JOIN daily_sending_usage d
             ON d.campaign_id = c.id AND d.usage_date = $1
     WHERE c.status IN ('running','paused','scheduled')
     GROUP BY c.id, d.sent_count
     ORDER BY c.created_at DESC
     LIMIT 5
  `, [today]);

  const dailyQ = pool.query<{ day: string; sent: number }>(`
    SELECT to_char(occurred_at AT TIME ZONE 'Asia/Dubai', 'DD Mon') AS day,
           COUNT(*)::int AS sent
      FROM sending_events
     WHERE event_type = 'sent'
       AND occurred_at > NOW() - INTERVAL '14 days'
     GROUP BY 1, date_trunc('day', occurred_at AT TIME ZONE 'Asia/Dubai')
     ORDER BY date_trunc('day', occurred_at AT TIME ZONE 'Asia/Dubai')
  `);

  const activityQ = pool.query<{ action: string; detail: unknown; created_at: string }>(`
    SELECT action, detail, created_at FROM activity_log
     ORDER BY created_at DESC LIMIT 8
  `);

  const [t, s, u, l, c, d, a] = await Promise.all([
    totalsQ, sendQ, usageQ, limitQ, campaignsQ, dailyQ, activityQ,
  ]);

  return {
    totals: t.rows[0],
    send: s.rows[0],
    sentToday: u.rows[0]?.sent_count ?? 0,
    dailyLimit: l.rows[0]?.value ?? 500,
    campaigns: c.rows as Array<Record<string, string | number>>,
    daily: d.rows,
    activity: a.rows,
  };
}

export default async function Dashboard() {
  let data;
  try {
    data = await loadDashboard();
  } catch (err) {
    return (
      <>
        <PageHeader title="Dashboard" sub="Campaign performance at a glance" />
        <EmptyState
          title="The database is not reachable"
          body={
            "Check DATABASE_URL in your environment and confirm the migration has run. " +
            (err instanceof Error ? err.message : "")
          }
        />
      </>
    );
  }

  const { totals, send, sentToday, dailyLimit, campaigns, daily, activity } = data;
  const hasContacts = Number(totals.total_contacts) > 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        sub="Campaign performance at a glance"
        action={
          <Link href="/campaigns/new" className="btn-primary">
            <span className="text-[18px] leading-none">+</span> New campaign
          </Link>
        }
      />

      {!hasContacts && (
        <div className="mb-8">
          <EmptyState
            title="No contacts yet"
            body="Import the brokers and agencies CSV files to get started. The importer will normalise addresses, remove duplicates and show you a full reconciliation before anything is saved."
            action={<Link href="/import" className="btn-primary">Import contacts</Link>}
          />
        </div>
      )}

      {/* Performance cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <StatCard label="Sent" value={Number(send.sent)} />
        <StatCard label="Delivered" value={Number(send.delivered)} tone="good"
                  sub="Accepted by recipient server" />
        <StatCard label="Bounced" value={Number(send.bounced)} tone="bad" />
        <StatCard label="Failed" value={Number(send.failed)} tone="bad" />
        <StatCard label="Needs review" value={Number(send.unknown_s)} tone="warn"
                  sub="Delivery uncertain" />
        <StatCard label="Suppressed" value={Number(totals.suppressed)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
        {/* Sending control */}
        <Card title="Today's sending" sub="Enforced server-side">
          <div className="text-stat text-ink mb-1">
            {num(sentToday)}
            <span className="text-[18px] text-ink-faint font-medium"> / {num(dailyLimit)}</span>
          </div>
          <div className="mt-4">
            <Progress value={sentToday} max={dailyLimit} showLabel={false} />
          </div>
          <div className="text-[13px] text-ink-muted mt-3">
            {num(Math.max(0, dailyLimit - sentToday))} remaining today
          </div>
          <div className="flex gap-2 mt-5">
            <Link href="/campaigns" className="btn-quiet btn-sm flex-1">Manage campaigns</Link>
            <Link href="/settings" className="btn-quiet btn-sm">Change limit</Link>
          </div>
        </Card>

        {/* Verification breakdown */}
        <Card title="Email verification">
          <div className="space-y-3">
            {[
              { k: "Domain OK", v: Number(totals.valid), tone: "text-good" },
              { k: "Dead domain", v: Number(totals.invalid), tone: "text-bad" },
              { k: "Risky", v: Number(totals.risky), tone: "text-warn" },
              { k: "Not checked", v: Number(totals.unknown_v), tone: "text-ink-muted" },
            ].map(({ k, v, tone }) => (
              <div key={k} className="flex items-center justify-between">
                <span className="text-[14px] text-ink-soft">{k}</span>
                <span className={`text-[15px] font-semibold ${tone}`}>{num(v)}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 pt-4 border-t border-line flex items-center justify-between">
            <span className="text-[14px] text-ink-muted">Total contacts</span>
            <span className="text-[15px] font-semibold text-ink">
              {num(Number(totals.total_contacts))}
            </span>
          </div>
        </Card>

        {/* Domain breakdown */}
        <Card title="Email providers">
          <DomainChart
            data={[
              { name: "Gmail", value: Number(totals.gmail) },
              { name: "Outlook", value: Number(totals.outlook) },
              { name: "Yahoo", value: Number(totals.yahoo) },
              { name: "Company", value: Number(totals.company) },
              { name: "Other free", value: Number(totals.other_free) },
            ]}
          />
        </Card>
      </div>

      {/* Sending over time */}
      <div className="mb-6">
        <Card title="Sending over the last 14 days">
          {daily.length === 0 ? (
            <div className="h-[180px] flex items-center justify-center text-[14px] text-ink-faint">
              Nothing sent yet. This fills in once a campaign starts.
            </div>
          ) : (
            <DomainChart
              variant="bar"
              data={daily.map((d) => ({ name: d.day, value: Number(d.sent) }))}
            />
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Active campaigns */}
        <Card title="Active campaigns" pad={campaigns.length === 0}>
          {campaigns.length === 0 ? (
            <div className="py-8 text-center text-[14px] text-ink-faint">
              No active campaigns.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Campaign</th>
                  <th className="th">Status</th>
                  <th className="th">Today</th>
                  <th className="th">Progress</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={String(c.id)}>
                    <td className="td font-medium text-ink">
                      <Link href={`/campaigns/${c.id}`} className="hover:text-accent">
                        {String(c.name)}
                      </Link>
                    </td>
                    <td className="td"><StatusPill status={String(c.status)} /></td>
                    <td className="td whitespace-nowrap">
                      {num(Number(c.sent_today))} / {num(Number(c.daily_limit))}
                    </td>
                    <td className="td w-[160px]">
                      <Progress
                        value={Number(c.sent)}
                        max={Number(c.recipients)}
                        showLabel={false}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Recent activity */}
        <Card title="Recent activity">
          {activity.length === 0 ? (
            <div className="py-8 text-center text-[14px] text-ink-faint">
              Nothing has happened yet.
            </div>
          ) : (
            <ul className="space-y-3.5">
              {activity.map((a, i) => (
                <li key={i} className="flex items-start justify-between gap-4">
                  <span className="text-[14px] text-ink-soft">{a.action}</span>
                  <span className="text-[12.5px] text-ink-faint whitespace-nowrap">
                    {ago(a.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Server status */}
      <div className="mt-6">
        <Card title="Sending server">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-ink-faint" />
            <span className="text-[14px] text-ink-soft">
              Not configured yet. Add the OVH Postfix details in Settings once the mail
              server is provisioned.
            </span>
            <Pill tone="neutral">Offline</Pill>
          </div>
        </Card>
      </div>
    </>
  );
}
