import { NextResponse } from "next/server";
import { pool } from "@/db";
import { requireSession } from "@/lib/auth";
import { renderMessage, unsubToken } from "@/lib/render";

export const maxDuration = 300;

/**
 * Renders every queued message without sending anything.
 *
 * This is the only way to find a merge problem across 30,000 recipients before
 * it goes out rather than after.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const cid = Number(id);

  const c = await pool.query(`
    SELECT c.from_name, c.from_email, c.reply_to,
           t.subject, t.html_body, t.text_body
      FROM campaigns c JOIN templates t ON t.id = c.template_id
     WHERE c.id = $1`, [cid]);
  if (c.rowCount === 0) {
    return NextResponse.json({ error: "Campaign or template missing." }, { status: 404 });
  }
  const camp = c.rows[0];

  const s = await pool.query<{ key: string; value: string }>(`SELECT key, value FROM system_settings`);
  const set = Object.fromEntries(s.rows.map((x) => [x.key, x.value]));

  const domain = String(camp.from_email).split("@")[1] ?? "azkalmedia.agency";
  const sender = {
    fromName: camp.from_name,
    fromEmail: camp.from_email,
    replyTo: camp.reply_to,
    postalAddress: String(set.postal_address ?? "") || "[ postal address not set ]",
    unsubscribeAddress: `unsubscribe@${domain}`,
  };

  const rows = await pool.query<{
    email_identity_id: number; merge_data: Record<string, string>; email_raw: string;
  }>(`
    SELECT cr.email_identity_id, cr.merge_data, ei.email_raw
      FROM campaign_recipients cr
      JOIN email_identities ei ON ei.id = cr.email_identity_id
     WHERE cr.campaign_id = $1 AND cr.status = 'pending'`, [cid]);

  let ok = 0;
  let withProblems = 0;
  const samples: { email: string; subject: string; missing: string[] }[] = [];
  const problemSamples: typeof samples = [];

  for (const r of rows.rows) {
    const rendered = renderMessage(
      { subject: camp.subject, htmlBody: camp.html_body, textBody: camp.text_body ?? "" },
      { ...r.merge_data, email: r.email_raw },
      sender,
      { unsubToken: unsubToken(cid, r.email_identity_id, process.env.SESSION_SECRET ?? "dev") }
    );

    if (rendered.missing.length > 0) {
      withProblems++;
      if (problemSamples.length < 3) {
        problemSamples.push({
          email: r.email_raw, subject: rendered.subject, missing: rendered.missing,
        });
      }
    } else {
      ok++;
      if (samples.length < 3) {
        samples.push({ email: r.email_raw, subject: rendered.subject, missing: [] });
      }
    }
  }

  return NextResponse.json({
    checked: rows.rowCount ?? 0,
    ok,
    withProblems,
    samples: [...problemSamples, ...samples].slice(0, 5),
  });
}
