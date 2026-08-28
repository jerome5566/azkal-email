import { NextResponse } from "next/server";
import { pool } from "@/db";
import { requireSession } from "@/lib/auth";
import { renderMessage, validateTemplate } from "@/lib/render";
import { extractMergeFields } from "@/lib/email";

/** Renders the template against a randomly chosen real contact. */
export async function POST(req: Request) {
  await requireSession();
  const { subject, htmlBody, textBody } = await req.json();

  const s = await pool.query<{ key: string; value: string }>(`SELECT key, value FROM system_settings`);
  const set = Object.fromEntries(s.rows.map((x) => [x.key, x.value]));

  // A real contact, not a made-up one. Registry names are messier than any
  // placeholder and that is the point of previewing.
  const c = await pool.query<{
    email_raw: string; first_name: string | null; company: string | null;
  }>(`
    SELECT ei.email_raw,
           COALESCE(
             (SELECT b.name_en FROM brokers b WHERE b.email_identity_id = ei.id
               AND b.name_en IS NOT NULL LIMIT 1),
             (SELECT a.name_en FROM agencies a WHERE a.email_identity_id = ei.id
               AND a.name_en IS NOT NULL LIMIT 1)) AS first_name,
           COALESCE(
             (SELECT b.office_name_en FROM brokers b WHERE b.email_identity_id = ei.id
               AND b.office_name_en IS NOT NULL LIMIT 1),
             (SELECT a.name_en FROM agencies a WHERE a.email_identity_id = ei.id LIMIT 1)) AS company
      FROM email_identities ei
     WHERE ei.is_suppressed = FALSE
     ORDER BY random() LIMIT 1`);

  const contact = c.rows[0] ?? {
    email_raw: "example@primeproperties.ae", first_name: "Ahmed Al Mansouri",
    company: "PRIME PROPERTIES LLC",
  };

  const rendered = renderMessage(
    { subject: subject ?? "", htmlBody: htmlBody ?? "", textBody: textBody ?? "" },
    {
      email: contact.email_raw,
      first_name: contact.first_name ?? undefined,
      company: contact.company ?? undefined,
      office_name: contact.company ?? undefined,
    },
    {
      fromName: String(set.from_name ?? "Azkal Media"),
      fromEmail: String(set.from_email ?? ""),
      replyTo: String(set.reply_to ?? ""),
      postalAddress: String(set.postal_address ?? "") ||
        "[ postal address not set — required before sending ]",
      unsubscribeAddress: `unsubscribe@${String(set.from_email ?? "@azkalmedia.agency").split("@")[1] ?? "azkalmedia.agency"}`,
    },
    { unsubToken: "preview" }
  );

  const fields = [
    ...new Set([
      ...extractMergeFields(subject ?? ""),
      ...extractMergeFields(htmlBody ?? ""),
    ]),
  ];

  const problems = validateTemplate({
    subject: subject ?? "", htmlBody: htmlBody ?? "", textBody: textBody ?? "",
  });
  if (!String(set.postal_address ?? "").trim()) {
    problems.push("No postal address in Settings. Sending is blocked until it is set.");
  }

  return NextResponse.json({
    subject: rendered.subject, html: rendered.html, text: rendered.text,
    missing: rendered.missing, recipient: contact.email_raw, problems, fields,
  });
}
