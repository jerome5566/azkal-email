import { notFound } from "next/navigation";
import Link from "next/link";
import { pool } from "@/db";
import { num, ago, dubaiToday } from "@/lib/format";
import { PageHeader, Card, StatCard, StatusPill, Progress } from "@/components/ui";
import { CampaignControls } from "@/components/campaign-controls";

export const dynamic = "force-dynamic";

export default async function CampaignPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cid = Number(id);

  const c = await pool.query(`
    SELECT c.*, t.name AS template_name, t.subject AS template_subject
      FROM campaigns c LEFT JOIN templates t ON t.id = c.template_id
     WHERE c.id = $1`, [cid]);
  if (c.rowCount === 0) notFound();
  const camp = c.rows[0];

  const [stats, today, settings] = await Promise.all([
    pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status='pending')::int    AS pending,
             COUNT(*) FILTER (WHERE status='processing')::int AS processing,
             COUNT(*) FILTER (WHERE status IN ('sent','delivered'))::int AS sent,
             COUNT(*) FILTER (WHERE status='delivered')::int  AS delivered,
             COUNT(*) FILTER (WHERE status='bounced')::int    AS bounced,
             COUNT(*) FILTER (WHERE status='failed')::int     AS failed,
             COUNT(*) FILTER (WHERE status='unknown')::int    AS unknown,
             COUNT(*) FILTER (WHERE status='excluded')::int   AS excluded,
             COUNT(*) FILTER (WHERE status='suppressed')::int AS suppressed
        FROM campaign_recipients WHERE campaign_id = $1`, [cid]),
    pool.query(`SELECT sent_count FROM daily_sending_usage
                 WHERE campaign_id=$1 AND usage_date=$2`, [cid, dubaiToday()]),
    pool.query<{ key: string; value: string }>(`SELECT key, value FROM system_settings`),
  ]);

  const s = stats.rows[0];
  const set = Object.fromEntries(settings.rows.map((x) => [x.key, x.value]));
  const sentToday = today.rows[0]?.sent_count ?? 0;

  const attempted = s.sent + s.bounced + s.failed;
  const bounceRate = attempted > 0 ? (s.bounced / attempted) * 100 : 0;

  const blockers: string[] = [];
  if (!String(set.from_email ?? "").trim()) blockers.push("No From address in Settings.");
  if (!String(set.postal_address ?? "").trim()) blockers.push("No postal address in Settings.");
  if (!process.env.SMTP_HOST) blockers.push("No sending server configured. Dry run works; real sending does not.");
  if (!camp.template_id) blockers.push("No template attached.");

  return (
    <>
      <PageHeader
        title={camp.name}
        sub={camp.template_name ? `Template: ${camp.template_name}` : "No template"}
        action={<Link href="/campaigns" className="btn-quiet">All campaigns</Link>}
      />

      <div className="flex items-center gap-3 mb-6">
        <StatusPill status={camp.status} />
        {camp.paused_reason && (
          <span className="text-[13.5px] text-warn">{camp.paused_reason}</span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <StatCard label="Recipients" value={s.total} />
        <StatCard label="Sent" value={s.sent} />
        <StatCard label="Pending" value={s.pending} />
        <StatCard label="Bounced" value={s.bounced} tone={s.bounced > 0 ? "bad" : "neutral"}
                  sub={attempted > 0 ? `${bounceRate.toFixed(1)}% of attempts` : undefined} />
        <StatCard label="Failed" value={s.failed} tone={s.failed > 0 ? "bad" : "neutral"} />
        <StatCard label="Needs review" value={s.unknown} tone={s.unknown > 0 ? "warn" : "neutral"}
                  sub={s.unknown > 0 ? "Delivery uncertain" : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <Card title="Progress">
            <Progress value={s.sent} max={s.total} />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-5 border-t border-line">
              {[
                ["Today", `${num(sentToday)} / ${num(camp.daily_limit)}`],
                ["Window", `${camp.send_window_start} to ${camp.send_window_end}`],
                ["Timezone", camp.timezone],
                ["Pause at", `${Number(camp.max_bounce_rate).toFixed(1)}% bounces`],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="text-[12.5px] text-ink-muted">{k}</div>
                  <div className="text-[14px] text-ink mt-0.5">{v}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Recipient states">
            <div className="space-y-2.5">
              {[
                ["Pending", s.pending, "text-ink-soft"],
                ["Processing", s.processing, "text-accent"],
                ["Sent", s.sent, "text-good"],
                ["Bounced", s.bounced, "text-bad"],
                ["Failed", s.failed, "text-bad"],
                ["Needs review", s.unknown, "text-warn"],
                ["Excluded after queueing", s.excluded, "text-ink-muted"],
                ["Blocked at send time", s.suppressed, "text-ink-muted"],
              ].filter(([, v]) => Number(v) > 0 || v === s.pending).map(([k, v, tone]) => (
                <div key={String(k)} className="flex justify-between">
                  <span className="text-[14px] text-ink-soft">{k}</span>
                  <span className={`text-[14px] font-medium ${tone}`}>{num(Number(v))}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <CampaignControls
            id={cid}
            status={camp.status}
            blockers={blockers}
            pending={s.pending}
          />

          <Card title="Sender">
            <dl className="space-y-2.5 text-[13.5px]">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">From</dt>
                <dd className="text-ink text-right">{camp.from_name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Address</dt>
                <dd className="text-ink text-right text-[12.5px]">
                  {camp.from_email || "not set"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Reply-To</dt>
                <dd className="text-ink text-right text-[12.5px]">
                  {camp.reply_to || "not set"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Created</dt>
                <dd className="text-ink text-right">{ago(camp.created_at)}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
