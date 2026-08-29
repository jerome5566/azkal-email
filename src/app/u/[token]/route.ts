/**
 * Public one-click unsubscribe (RFC 8058).
 *
 * Deliberately has no auth. The token is the credential: it is an HMAC of
 * campaign id and identity id, so it cannot be guessed or enumerated, and it
 * is stored on the recipient row when the message is sent.
 *
 * GET  shows a confirmation page with a button.
 * POST performs the unsubscribe.
 *
 * The split matters. Mail scanners and link previewers fetch URLs with GET
 * before a human ever sees them, so a GET that changed state would unsubscribe
 * people who never clicked. Gmail's one-click sends a POST directly, which is
 * why the same URL handles both.
 */
import { pool } from "@/db";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

interface Recipient {
  id: number;
  campaign_id: number;
  identity_id: number;
  email_raw: string;
  email_normalized: string;
}

async function resolveToken(token: string): Promise<Recipient | null> {
  // Tokens are 24 hex characters. Anything else is not worth a query.
  if (!/^[a-f0-9]{24}$/.test(token)) return null;

  const r = await pool.query<Recipient>(
    `SELECT cr.id, cr.campaign_id,
            ei.id AS identity_id, ei.email_raw, ei.email_normalized
       FROM campaign_recipients cr
       JOIN email_identities ei ON ei.id = cr.email_identity_id
      WHERE cr.unsub_token = $1`,
    [token]
  );
  return r.rows[0] ?? null;
}

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title}</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center;
         justify-content:center; background:#fafafa; padding:24px;
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
         color:#1a1a1a; }
  .card { background:#fff; border:1px solid #ececec; border-radius:12px;
          box-shadow:0 1px 3px rgba(0,0,0,0.04); padding:32px; max-width:420px;
          width:100%; text-align:center; }
  .brand { font-size:22px; font-weight:700; letter-spacing:-0.02em; margin-bottom:28px; }
  .brand span { color:#22C6DA; }
  h1 { font-size:18px; font-weight:600; margin:0 0 10px; }
  p { font-size:14.5px; line-height:1.55; color:#666; margin:0 0 8px; }
  .addr { font-weight:600; color:#1a1a1a; word-break:break-all; }
  button { margin-top:22px; width:100%; background:#22C6DA; color:#fff; border:0;
           border-radius:8px; padding:12px 20px; font-size:15px; font-weight:600;
           cursor:pointer; font-family:inherit; }
  button:hover { background:#1eb3c5; }
  .note { font-size:12.5px; color:#999; margin-top:22px; }
</style>
</head><body>
<div class="card">
  <div class="brand">azkal<span>.</span></div>
  ${body}
</div>
</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const r = await resolveToken(token);

  if (!r) {
    return page(
      "Link not recognised",
      `<h1>This link is not valid</h1>
       <p>It may have expired, or been altered in transit.</p>
       <p class="note">You can also reply to any of our emails with the word
       REMOVE and we will take you off the list.</p>`,
      404
    );
  }

  const already = await pool.query(
    `SELECT 1 FROM suppression_list WHERE email_normalized = $1`,
    [r.email_normalized]
  );

  if ((already.rowCount ?? 0) > 0) {
    return page(
      "Already unsubscribed",
      `<h1>You are already unsubscribed</h1>
       <p><span class="addr">${r.email_raw}</span> will not receive
       any further emails from us.</p>`
    );
  }

  return page(
    "Unsubscribe",
    `<h1>Unsubscribe from Azkal Media</h1>
     <p>Confirm and we will stop emailing
     <span class="addr">${r.email_raw}</span>.</p>
     <form method="POST"><button type="submit">Unsubscribe me</button></form>
     <p class="note">This takes effect immediately.</p>`
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const r = await resolveToken(token);

  if (!r) {
    return page(
      "Link not recognised",
      `<h1>This link is not valid</h1>
       <p>It may have expired, or been altered in transit.</p>`,
      404
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // The insert is the whole operation. Triggers mirror is_suppressed onto
    // the identity and pull every pending queue row for this address out of
    // every campaign, in this same transaction.
    await client.query(
      `INSERT INTO suppression_list (email_normalized, reason, note, created_by)
       VALUES ($1, 'unsubscribe', $2, 'one-click')
       ON CONFLICT (email_normalized) DO NOTHING`,
      [r.email_normalized, `One-click unsubscribe, campaign ${r.campaign_id}`]
    );

    await client.query(
      `INSERT INTO sending_events
         (campaign_recipient_id, campaign_id, email_identity_id, event_type)
       VALUES ($1, $2, $3, 'unsubscribe')`,
      [r.id, r.campaign_id, r.identity_id]
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    // Never show a failure to the recipient. Their intent is unambiguous and
    // an error page invites a spam complaint instead of a retry.
    console.error("Unsubscribe failed:", e);
  } finally {
    client.release();
  }

  await logActivity(`Unsubscribed: ${r.email_raw}`, {
    entityType: "campaign",
    entityId: r.campaign_id,
  });

  return page(
    "Unsubscribed",
    `<h1>You have been unsubscribed</h1>
     <p><span class="addr">${r.email_raw}</span> has been removed.
     You will not receive any further emails from us.</p>
     <p class="note">Sorry for the interruption.</p>`
  );
}
