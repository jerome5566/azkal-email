import { notFound } from "next/navigation";
import { pool } from "@/db";
import { PageHeader } from "@/components/ui";
import { TemplateEditor } from "@/components/template-editor";

export const dynamic = "force-dynamic";

export default async function EditTemplatePage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const r = await pool.query(
    `SELECT id, name, subject, html_body, text_body FROM templates WHERE id = $1`,
    [Number(id)]
  );
  if (r.rowCount === 0) notFound();

  const s = await pool.query<{ key: string; value: string }>(`SELECT key, value FROM system_settings`);
  const set = Object.fromEntries(s.rows.map((x) => [x.key, x.value]));

  return (
    <>
      <PageHeader title={r.rows[0].name} sub="Edit template" />
      <TemplateEditor
        template={{
          id: r.rows[0].id,
          name: r.rows[0].name,
          subject: r.rows[0].subject,
          htmlBody: r.rows[0].html_body,
          textBody: r.rows[0].text_body,
        }}
        sender={{
          from_name: String(set.from_name ?? "Azkal Media"),
          from_email: String(set.from_email ?? ""),
          reply_to: String(set.reply_to ?? ""),
          postal_address: String(set.postal_address ?? ""),
        }}
      />
    </>
  );
}
