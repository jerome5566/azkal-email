import { pool } from "@/db";
import { num, ago } from "@/lib/format";
import { PageHeader, Pill, ProviderPill, StatusPill, EmptyState } from "@/components/ui";
import { ExcludeButton } from "@/components/exclude-button";
import { ContactFilters } from "@/components/contact-filters";
import Link from "next/link";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface Row {
  id: number; email_raw: string; provider_type: string;
  verification_status: string | null; is_suppressed: boolean;
  is_role_account: boolean; contacted_count: number;
  last_contacted_at: string | null;
  display_name: string | null; office: string | null;
  sources: string | null;
}

/** Filters are composed as SQL predicates. All values are parameterised. */
function buildWhere(sp: Record<string, string | undefined>) {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => (params.push(v), `$${params.length}`);

  const q = sp.q?.trim();
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    where.push(`(
      ei.email_normalized ILIKE ${p(like)}
      OR EXISTS (SELECT 1 FROM brokers b WHERE b.email_identity_id = ei.id AND (
           b.name_en ILIKE ${p(like)} OR b.name_ar ILIKE ${p(like)}
        OR b.office_name_en ILIKE ${p(like)} OR b.office_name_ar ILIKE ${p(like)}
        OR b.broker_number ILIKE ${p(like)}))
      OR EXISTS (SELECT 1 FROM agencies a WHERE a.email_identity_id = ei.id AND (
           a.name_en ILIKE ${p(like)} OR a.name_ar ILIKE ${p(like)}
        OR a.office_number ILIKE ${p(like)}))
    )`);
  }

  const source = sp.source;
  if (source === "broker") where.push(`EXISTS (SELECT 1 FROM brokers b WHERE b.email_identity_id = ei.id)`);
  if (source === "agency") where.push(`EXISTS (SELECT 1 FROM agencies a WHERE a.email_identity_id = ei.id)`);

  const provider = sp.provider;
  if (provider) where.push(`ei.provider_type = ${p(provider)}::provider_type`);

  const status = sp.status;
  if (status === "unchecked") where.push(`ei.verification_status IS NULL`);
  else if (status) where.push(`ei.verification_status = ${p(status)}::verification_status`);

  const flag = sp.flag;
  if (flag === "excluded") where.push(`ei.is_suppressed = TRUE`);
  if (flag === "active") where.push(`ei.is_suppressed = FALSE`);
  if (flag === "contacted") where.push(`ei.contacted_count > 0`);
  if (flag === "not_contacted") where.push(`ei.contacted_count = 0`);
  if (flag === "role") where.push(`ei.is_role_account = TRUE`);

  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const offset = (page - 1) * PAGE_SIZE;
  const { sql, params } = buildWhere(sp);

  let rows: Row[] = [];
  let total = 0;
  let dbError: string | null = null;

  try {
    const countRes = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM email_identities ei ${sql}`,
      params
    );
    total = Number(countRes.rows[0].c);

    const res = await pool.query<Row>(
      `SELECT ei.id, ei.email_raw, ei.provider_type, ei.verification_status,
              ei.is_suppressed, ei.is_role_account, ei.contacted_count,
              ei.last_contacted_at,
              COALESCE(
                (SELECT b.name_en FROM brokers b
                  WHERE b.email_identity_id = ei.id AND b.name_en IS NOT NULL LIMIT 1),
                (SELECT a.name_en FROM agencies a
                  WHERE a.email_identity_id = ei.id AND a.name_en IS NOT NULL LIMIT 1)
              ) AS display_name,
              COALESCE(
                (SELECT b.office_name_en FROM brokers b
                  WHERE b.email_identity_id = ei.id AND b.office_name_en IS NOT NULL LIMIT 1),
                (SELECT a.name_en FROM agencies a
                  WHERE a.email_identity_id = ei.id LIMIT 1)
              ) AS office,
              NULLIF(CONCAT_WS(', ',
                CASE WHEN EXISTS (SELECT 1 FROM brokers b WHERE b.email_identity_id = ei.id)
                     THEN 'Broker' END,
                CASE WHEN EXISTS (SELECT 1 FROM agencies a WHERE a.email_identity_id = ei.id)
                     THEN 'Agency' END
              ), '') AS sources
         FROM email_identities ei
         ${sql}
        ORDER BY ei.id
        LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      params
    );
    rows = res.rows;
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const pages = Math.ceil(total / PAGE_SIZE);

  return (
    <>
      <PageHeader
        title="Contacts"
        sub={total ? `${num(total)} matching contacts` : "All imported email identities"}
        action={<Link href="/import" className="btn-quiet">Import CSV</Link>}
      />

      <ContactFilters current={sp} />

      {dbError ? (
        <EmptyState title="Could not load contacts" body={dbError} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={total === 0 && !sp.q ? "No contacts yet" : "Nothing matches those filters"}
          body={
            total === 0 && !sp.q
              ? "Import a brokers or agencies CSV and the contacts will appear here."
              : "Try widening the search or clearing a filter."
          }
          action={
            total === 0 && !sp.q ? (
              <Link href="/import" className="btn-primary">Import contacts</Link>
            ) : (
              <Link href="/contacts" className="btn-quiet">Clear filters</Link>
            )
          }
        />
      ) : (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px]">
              <thead>
                <tr>
                  <th className="th">Email</th>
                  <th className="th">Name</th>
                  <th className="th">Office / Company</th>
                  <th className="th">Source</th>
                  <th className="th">Provider</th>
                  <th className="th">Verification</th>
                  <th className="th">Contacted</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.is_suppressed ? "bg-red-50/30" : ""}>
                    <td className="td">
                      <div className="font-medium text-ink">{r.email_raw}</div>
                      {r.is_role_account && (
                        <div className="mt-1"><Pill tone="warn">Role account</Pill></div>
                      )}
                    </td>
                    <td className="td">{r.display_name ?? <span className="text-ink-faint">Not given</span>}</td>
                    <td className="td">{r.office ?? <span className="text-ink-faint">Not given</span>}</td>
                    <td className="td whitespace-nowrap">{r.sources ?? "-"}</td>
                    <td className="td"><ProviderPill type={r.provider_type} /></td>
                    <td className="td">
                      {r.verification_status
                        ? <StatusPill status={r.verification_status} />
                        : <Pill tone="neutral">Not checked</Pill>}
                    </td>
                    <td className="td whitespace-nowrap">
                      {r.contacted_count > 0 ? (
                        <span title={r.last_contacted_at ?? ""}>
                          {r.contacted_count}&times; &middot; {ago(r.last_contacted_at)}
                        </span>
                      ) : (
                        <span className="text-ink-faint">Never</span>
                      )}
                    </td>
                    <td className="td text-right">
                      <ExcludeButton id={r.id} excluded={r.is_suppressed} email={r.email_raw} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-between px-5 py-4 border-t border-line">
              <div className="text-[13px] text-ink-muted">
                Page {num(page)} of {num(pages)} &middot; {num(total)} contacts
              </div>
              <div className="flex gap-2">
                <PageLink sp={sp} to={page - 1} disabled={page <= 1}>Previous</PageLink>
                <PageLink sp={sp} to={page + 1} disabled={page >= pages}>Next</PageLink>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function PageLink({
  sp, to, disabled, children,
}: {
  sp: Record<string, string | undefined>;
  to: number; disabled: boolean; children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="btn-quiet btn-sm opacity-40 pointer-events-none">{children}</span>;
  }
  const params = new URLSearchParams(
    Object.entries(sp).filter(([, v]) => v) as [string, string][]
  );
  params.set("page", String(to));
  return <Link href={`/contacts?${params}`} className="btn-quiet btn-sm">{children}</Link>;
}
