import Link from "next/link";
import { pool } from "@/db";
import { PageHeader, EmptyState } from "@/components/ui";
import { CampaignBuilder } from "@/components/campaign-builder";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  const [t, s] = await Promise.all([
    pool.query(`SELECT id, name, subject, required_merge_fields FROM templates ORDER BY updated_at DESC`),
    pool.query<{ key: string; value: string }>(`SELECT key, value FROM system_settings`),
  ]);

  if (t.rowCount === 0) {
    return (
      <>
        <PageHeader title="New campaign" sub="A campaign needs a template first" />
        <EmptyState
          title="Write a template first"
          body="A campaign pairs a template with a set of contacts, so the template has to exist before you can build one."
          action={<Link href="/templates/new" className="btn-primary">Write a template</Link>}
        />
      </>
    );
  }

  const set = Object.fromEntries(s.rows.map((x) => [x.key, x.value]));

  return (
    <>
      <PageHeader title="New campaign" sub="Choose a template, pick recipients, review" />
      <CampaignBuilder
        templates={t.rows.map((r) => ({
          id: r.id, name: r.name, subject: r.subject,
          fields: (r.required_merge_fields as string[]) ?? [],
        }))}
        defaults={{
          dailyLimit: Number(set.global_daily_limit ?? 500),
          fromName: String(set.from_name ?? "Azkal Media"),
          fromEmail: String(set.from_email ?? ""),
          replyTo: String(set.reply_to ?? ""),
          postalAddress: String(set.postal_address ?? ""),
        }}
      />
    </>
  );
}
