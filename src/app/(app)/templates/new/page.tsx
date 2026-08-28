import { pool } from "@/db";
import { PageHeader } from "@/components/ui";
import { TemplateEditor } from "@/components/template-editor";

export const dynamic = "force-dynamic";

export default async function NewTemplatePage() {
  let sender = { from_name: "Azkal Media", from_email: "", reply_to: "", postal_address: "" };
  try {
    const r = await pool.query<{ key: string; value: string }>(`SELECT key, value FROM system_settings`);
    const s = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
    sender = {
      from_name: String(s.from_name ?? "Azkal Media"),
      from_email: String(s.from_email ?? ""),
      reply_to: String(s.reply_to ?? ""),
      postal_address: String(s.postal_address ?? ""),
    };
  } catch { /* defaults */ }

  return (
    <>
      <PageHeader title="New template" sub="Subject, body, and merge fields" />
      <TemplateEditor sender={sender} />
    </>
  );
}
