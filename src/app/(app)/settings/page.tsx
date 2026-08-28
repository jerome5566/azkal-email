import { pool } from "@/db";
import { PageHeader, Card } from "@/components/ui";
import { SettingsForm } from "@/components/settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  let settings: Record<string, unknown> = {};
  try {
    const res = await pool.query<{ key: string; value: unknown }>(
      `SELECT key, value FROM system_settings`
    );
    settings = Object.fromEntries(res.rows.map((r) => [r.key, r.value]));
  } catch { /* form falls back to defaults */ }

  return (
    <>
      <PageHeader title="Settings" sub="Sending limits, schedule and sender identity" />
      <div className="max-w-3xl space-y-6">
        <SettingsForm initial={settings} />
        <Card title="Sending server">
          <p className="text-[14px] text-ink-soft leading-relaxed">
            SMTP credentials for the OVH Postfix server live in environment variables,
            never in the database and never in the browser. Set{" "}
            <code className="text-[13px] bg-page px-1.5 py-0.5 rounded">SMTP_HOST</code>,{" "}
            <code className="text-[13px] bg-page px-1.5 py-0.5 rounded">SMTP_USER</code> and{" "}
            <code className="text-[13px] bg-page px-1.5 py-0.5 rounded">SMTP_PASS</code>{" "}
            in the Cloudways application environment, then restart the app.
          </p>
        </Card>
      </div>
    </>
  );
}
