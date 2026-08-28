import Link from "next/link";
import { pool } from "@/db";
import { ago } from "@/lib/format";
import { PageHeader, Card, EmptyState, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  let rows: Array<Record<string, string>> = [];
  try {
    const r = await pool.query(
      `SELECT t.id, t.name, t.subject, t.updated_at,
              (SELECT COUNT(*)::int FROM campaigns c WHERE c.template_id = t.id) AS uses
         FROM templates t ORDER BY t.updated_at DESC`
    );
    rows = r.rows;
  } catch { /* empty state */ }

  return (
    <>
      <PageHeader
        title="Templates"
        sub="Write the email once, use it in any campaign"
        action={<Link href="/templates/new" className="btn-primary">
          <span className="text-[18px] leading-none">+</span> New template
        </Link>}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No templates yet"
          body="A template holds the subject line and body. Merge fields like {{first_name}} get filled in per recipient, and the unsubscribe footer is added automatically."
          action={<Link href="/templates/new" className="btn-primary">Write your first template</Link>}
        />
      ) : (
        <Card pad={false}>
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Name</th>
                <th className="th">Subject</th>
                <th className="th">Used by</th>
                <th className="th">Updated</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="td font-medium text-ink">
                    <Link href={`/templates/${t.id}`} className="hover:text-accent">{t.name}</Link>
                  </td>
                  <td className="td max-w-[380px] truncate">{t.subject}</td>
                  <td className="td">
                    {Number(t.uses) > 0
                      ? <Pill tone="accent">{t.uses} campaign{Number(t.uses) > 1 ? "s" : ""}</Pill>
                      : <span className="text-ink-faint">Not used</span>}
                  </td>
                  <td className="td whitespace-nowrap">{ago(t.updated_at)}</td>
                  <td className="td text-right">
                    <Link href={`/templates/${t.id}`} className="btn-quiet btn-sm">Edit</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
