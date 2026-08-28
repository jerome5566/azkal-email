import { pool } from "@/db";
import { PageHeader, StatCard, Card, EmptyState } from "@/components/ui";
import { num } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function VerificationPage() {
  let t: Record<string, string> = {};
  try {
    const res = await pool.query(`
      SELECT COUNT(*)::text AS total,
             COUNT(*) FILTER (WHERE verification_status='valid')::text   AS valid,
             COUNT(*) FILTER (WHERE verification_status='invalid')::text AS invalid,
             COUNT(*) FILTER (WHERE verification_status='risky')::text   AS risky,
             COUNT(*) FILTER (WHERE verification_status IS NULL)::text   AS unchecked,
             COUNT(*) FILTER (WHERE is_role_account)::text               AS role_accounts,
             COUNT(DISTINCT domain)::text                                AS domains
        FROM email_identities`);
    t = res.rows[0];
  } catch { /* empty state */ }

  const total = Number(t.total ?? 0);

  return (
    <>
      <PageHeader title="Email Verification" sub="Domain-level checks. Free, and run locally." />

      {total === 0 ? (
        <EmptyState
          title="No contacts to check yet"
          body="Import a CSV first. Verification runs against contacts already in the database."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <StatCard label="Total" value={total} />
            <StatCard label="Domain OK" value={Number(t.valid)} tone="good" sub="Accepts mail" />
            <StatCard label="Dead domain" value={Number(t.invalid)} tone="bad" sub="Auto-suppressed" />
            <StatCard label="Risky" value={Number(t.risky)} tone="warn" sub="Role or parked" />
            <StatCard label="Not checked" value={Number(t.unchecked)} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="What runs for free">
              <ul className="space-y-2.5 text-[14px] text-ink-soft">
                <li>Address format validation</li>
                <li>Duplicate collapsing across both source files</li>
                <li>MX lookup across {num(Number(t.domains))} unique domains</li>
                <li>RFC 7505 null MX detection</li>
                <li>Parked domain detection</li>
                <li>Disposable provider blocklist</li>
                <li>Role account detection ({num(Number(t.role_accounts))} found)</li>
              </ul>
              <p className="text-[13px] text-ink-muted mt-4 pt-4 border-t border-line">
                Run it with <code className="bg-page px-1.5 py-0.5 rounded text-[12.5px]">npm
                run verify:mx</code>. Dead domains are suppressed automatically.
              </p>
            </Card>

            <Card title="What free checks cannot tell you">
              <p className="text-[14px] text-ink-soft leading-relaxed">
                Whether an individual mailbox exists. &ldquo;Domain OK&rdquo; means the
                domain accepts mail, not that this person still reads it. Someone who left
                the firm in 2021 looks identical to someone who started last week.
              </p>
              <p className="text-[14px] text-ink-soft leading-relaxed mt-3">
                The first 2,000 sends are the real test. The campaign safety threshold will
                pause automatically if bounces climb past the configured rate.
              </p>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
