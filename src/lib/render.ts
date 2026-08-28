/**
 * Message assembly.
 *
 * Renders a template against one recipient's merge data and appends the
 * compliance footer. This is the only place a message gets built, so the dry
 * run and the real send produce byte-identical output.
 */
import crypto from "node:crypto";
import { renderTemplate, firstNameFrom, titleCase } from "./email";

export interface MergeData {
  email?: string;
  first_name?: string;
  company?: string;
  office_name?: string;
  [k: string]: string | undefined;
}

export interface SenderIdentity {
  fromName: string;
  fromEmail: string;
  replyTo: string;
  postalAddress: string;
  unsubscribeAddress: string;
}

export interface RenderedMessage {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  missing: string[];
}

/**
 * Clean up merge values before they go into a message.
 *
 * Registry data arrives as "AHMED  AL-MANSOURI" and "PRIME PROPERTIES L.L.C".
 * Dropping that straight into "Hi {{first_name}}," reads as a mail merge, which
 * is exactly what it is, but there is no reason to make it look worse than it
 * needs to.
 */
export function prepareMergeData(raw: MergeData): MergeData {
  return {
    ...raw,
    first_name: firstNameFrom(raw.first_name) ?? undefined,
    company: titleCase(raw.company) ?? undefined,
    office_name: titleCase(raw.office_name) ?? undefined,
  };
}

/** Stable per-recipient token for the unsubscribe address. */
export function unsubToken(campaignId: number, identityId: number, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${campaignId}:${identityId}`)
    .digest("hex")
    .slice(0, 24);
}

/** VERP return path, so a bounce identifies the exact message that caused it. */
export function bounceAddress(token: string, domain: string): string {
  return `bounce+${token}@${domain}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Rough plain-text version, used when the template has no text body. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n\n")
    .replace(/<li>/gi, "- ")
    .replace(/<a [^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Render one message.
 *
 * If a required merge field has no value, the field is left as {{name}} and
 * reported in `missing`. Nothing downstream may send a message with a non-empty
 * `missing` array. This is what stops "Hi ," going out.
 */
export function renderMessage(
  template: { subject: string; htmlBody: string; textBody: string },
  data: MergeData,
  sender: SenderIdentity,
  opts: { unsubToken: string }
): RenderedMessage {
  const merge = prepareMergeData(data);
  const missing = new Set<string>();

  const subj = renderTemplate(template.subject, merge);
  subj.missing.forEach((m) => missing.add(m));

  const bodyHtml = renderTemplate(template.htmlBody, merge);
  bodyHtml.missing.forEach((m) => missing.add(m));

  const rawText = template.textBody?.trim() ? template.textBody : htmlToText(template.htmlBody);
  const bodyText = renderTemplate(rawText, merge);
  bodyText.missing.forEach((m) => missing.add(m));

  const unsubMailto =
    `mailto:${sender.unsubscribeAddress}?subject=unsubscribe%20${opts.unsubToken}`;

  // Plain, small, no images. A designed footer on a cold email is a signal.
  const footerHtml = `
<div style="margin-top:28px;padding-top:14px;border-top:1px solid #e4e4e4;
            font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;
            font-size:12px;line-height:1.5;color:#888;">
  ${escapeHtml(sender.postalAddress)}<br>
  Do not want these emails? <a href="${unsubMailto}" style="color:#888;">Unsubscribe</a>,
  or just reply with the word REMOVE.
</div>`.trim();

  const footerText = [
    "",
    "---",
    sender.postalAddress,
    `To unsubscribe, reply with the word REMOVE or email ${sender.unsubscribeAddress}`,
  ].join("\n");

  return {
    subject: subj.output,
    html: `${bodyHtml.output}\n${footerHtml}`,
    text: `${bodyText.output}\n${footerText}`,
    headers: {
      // RFC 2369. Gmail, Outlook and Apple Mail all render this as a native
      // unsubscribe control at the top of the message.
      "List-Unsubscribe": `<${unsubMailto}>`,
      "Auto-Submitted": "auto-generated",
      "Precedence": "bulk",
    },
    missing: [...missing],
  };
}

/**
 * Checks a template can be sent at all, before any recipients are involved.
 */
export function validateTemplate(t: {
  subject: string; htmlBody: string; textBody: string;
}): string[] {
  const problems: string[] = [];

  if (!t.subject.trim()) problems.push("The subject line is empty.");
  if (t.subject.length > 120) problems.push("Subject is over 120 characters and will be cut off in most inboxes.");
  if (!t.htmlBody.trim()) problems.push("The message body is empty.");

  if (/<img\s/i.test(t.htmlBody)) {
    problems.push("Images in a cold email hurt deliverability. Remove them.");
  }

  const links = t.htmlBody.match(/<a\s[^>]*href=/gi)?.length ?? 0;
  if (links > 3) {
    problems.push(`${links} links in the body. More than about three reads as marketing. Aim for one.`);
  }

  const spammy = /\b(free|guarantee[d]?|act now|limited time|click here|100%|risk[- ]free|urgent|winner)\b/gi;
  const hits = [...new Set(t.htmlBody.match(spammy) ?? [])];
  if (hits.length >= 3) {
    problems.push(`Phrases filters dislike: ${hits.slice(0, 5).join(", ")}.`);
  }

  return problems;
}
