/**
 * The send worker.
 *
 *   npm run worker
 *
 * Long-running process. Claims work from the queue, renders each message, hands
 * it to the transport, records the result, and paces itself across the sending
 * window.
 *
 * The one rule everything else follows from: a claim is committed to the
 * database BEFORE the message is handed to the transport. If this process dies
 * at any point after that, the row stays in `processing` and the reaper marks
 * it `unknown`. Nothing is ever retried automatically, because retrying a send
 * whose outcome is unknown risks delivering it twice, and a duplicate is worse
 * than a gap.
 */
import "dotenv/config";
import { Pool } from "pg";
import { renderMessage, unsubToken, bounceAddress } from "../src/lib/render";
import { makeTransport, type Transport } from "../src/lib/transport";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

const BATCH_SIZE = 5;
const IDLE_POLL_MS = 30_000;
const REAPER_EVERY_MS = 120_000;
const MIN_SAMPLE_FOR_SAFETY = 50;

let shuttingDown = false;
let transport: Transport;

const log = (m: string) =>
  console.log(`${new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Dubai" })}  ${m}`);

/* ------------------------------------------------------------- settings */

interface Settings {
  globalDailyLimit: number;
  windowStart: string;
  windowEnd: string;
  sendDays: number[];
  timezone: string;
  warmupEnabled: boolean;
  warmupSchedule: number[];
  warmupStartedOn: string | null;
  postalAddress: string;
  senderPaused: boolean;
}

async function loadSettings(): Promise<Settings> {
  const r = await pool.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM system_settings`
  );
  const s = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
  return {
    globalDailyLimit: Number(s.global_daily_limit ?? 500),
    windowStart: String(s.send_window_start ?? "08:00"),
    windowEnd: String(s.send_window_end ?? "18:00"),
    sendDays: (s.send_days as number[]) ?? [0, 1, 2, 3, 4, 5, 6],
    timezone: String(s.timezone ?? "Asia/Dubai"),
    warmupEnabled: Boolean(s.warmup_enabled ?? true),
    warmupSchedule: (s.warmup_schedule as number[]) ?? [],
    warmupStartedOn: s.warmup_started_on ? String(s.warmup_started_on) : null,
    postalAddress: String(s.postal_address ?? ""),
    senderPaused: Boolean(s.sender_paused ?? false),
  };
}

/* ----------------------------------------------------------------- time */

function nowInTz(tz: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit",
    year: "numeric", month: "2-digit", day: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    weekday: weekdayMap[get("weekday")] ?? 0,
  };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Today's ceiling.
 *
 * During warmup this is the ramp value, not the configured limit. A brand new
 * IP that jumps straight to full volume looks like a compromised server, and
 * providers throttle first and ask questions later.
 */
function effectiveDailyLimit(s: Settings, today: string): { limit: number; note: string } {
  if (!s.warmupEnabled || !s.warmupStartedOn || s.warmupSchedule.length === 0) {
    return { limit: s.globalDailyLimit, note: "" };
  }
  const started = new Date(`${s.warmupStartedOn}T00:00:00Z`).getTime();
  const now = new Date(`${today}T00:00:00Z`).getTime();
  const day = Math.floor((now - started) / 86_400_000);

  if (day < 0) return { limit: 0, note: "warmup has not started yet" };
  if (day >= s.warmupSchedule.length) {
    return { limit: s.globalDailyLimit, note: "warmup complete" };
  }
  const ramp = Math.min(s.warmupSchedule[day], s.globalDailyLimit);
  return { limit: ramp, note: `warmup day ${day + 1} of ${s.warmupSchedule.length}` };
}

/* -------------------------------------------------------------- pacing */

/**
 * Spreads the remaining quota across the remaining window rather than firing
 * the whole day's allowance in the first ten minutes.
 */
function pauseBetweenSends(remainingQuota: number, minutesLeft: number): number {
  if (remainingQuota <= 0) return IDLE_POLL_MS;
  const secondsLeft = Math.max(60, minutesLeft * 60);
  const base = (secondsLeft / remainingQuota) * 1000;
  // Jitter so the pattern is not a metronome, and a floor so we never hammer.
  // The ceiling is 30 minutes rather than 5, because on a warmup day of 20
  // messages a 5 minute cap would empty the quota in the first 100 minutes
  // instead of spreading it across the window, which is the whole point.
  const jittered = base * (0.75 + Math.random() * 0.5);
  return Math.max(2000, Math.min(jittered, 1_800_000));
}

/* -------------------------------------------------------------- safety */

/**
 * Auto-pause on bounce rate. Only once there is enough of a sample to mean
 * something: 3 bounces out of 5 sends is noise, 3 out of 200 is a signal.
 */
async function checkSafety(campaignId: number): Promise<string | null> {
  const r = await pool.query<{
    attempted: number; bounced: number; failed: number; max_bounce: string; max_fail: string;
  }>(`
    SELECT COUNT(*) FILTER (WHERE cr.status IN ('sent','delivered','bounced','failed'))::int AS attempted,
           COUNT(*) FILTER (WHERE cr.status = 'bounced')::int AS bounced,
           COUNT(*) FILTER (WHERE cr.status = 'failed')::int  AS failed,
           c.max_bounce_rate::text  AS max_bounce,
           c.max_failure_rate::text AS max_fail
      FROM campaign_recipients cr
      JOIN campaigns c ON c.id = cr.campaign_id
     WHERE cr.campaign_id = $1
     GROUP BY c.max_bounce_rate, c.max_failure_rate`, [campaignId]);

  const row = r.rows[0];
  if (!row || row.attempted < MIN_SAMPLE_FOR_SAFETY) return null;

  const bounceRate = (row.bounced / row.attempted) * 100;
  const failRate = (row.failed / row.attempted) * 100;

  if (bounceRate > Number(row.max_bounce)) {
    return `Paused automatically: bounce rate ${bounceRate.toFixed(1)}% is above the ` +
           `${Number(row.max_bounce).toFixed(1)}% threshold (${row.bounced} of ${row.attempted}).`;
  }
  if (failRate > Number(row.max_fail)) {
    return `Paused automatically: failure rate ${failRate.toFixed(1)}% is above the ` +
           `${Number(row.max_fail).toFixed(1)}% threshold (${row.failed} of ${row.attempted}).`;
  }
  return null;
}

async function pauseCampaign(campaignId: number, reason: string) {
  await pool.query(
    `UPDATE campaigns SET status='paused', paused_reason=$2 WHERE id=$1`,
    [campaignId, reason]
  );
  await pool.query(
    `INSERT INTO activity_log (actor, action) VALUES ('worker', $1)`,
    [reason]
  );
  log(`  !! ${reason}`);
}

/* ---------------------------------------------------------------- send */

interface Claimed {
  recipient_id: string;
  identity_id: string;
  email_raw: string;
  merge_data: Record<string, string>;
}

async function sendOne(
  claim: Claimed,
  campaign: Record<string, string>,
  postalAddress: string
): Promise<void> {
  const recipientId = Number(claim.recipient_id);
  const identityId = Number(claim.identity_id);
  const domain = String(campaign.from_email).split("@")[1] ?? "azkalmedia.agency";
  const token = unsubToken(Number(campaign.id), identityId, process.env.SESSION_SECRET ?? "dev");

  const rendered = renderMessage(
    {
      subject: campaign.subject,
      htmlBody: campaign.html_body,
      textBody: campaign.text_body ?? "",
    },
    { ...claim.merge_data, email: claim.email_raw },
    {
      fromName: campaign.from_name,
      fromEmail: campaign.from_email,
      replyTo: campaign.reply_to,
      postalAddress,
      unsubscribeAddress: `unsubscribe@${domain}`,
    },
    { unsubToken: token }
  );

  // Last line of defence. Should never fire, because the campaign builder
  // already held these back, but a template edited after queueing could
  // introduce a new field.
  if (rendered.missing.length > 0) {
    await pool.query(
      `UPDATE campaign_recipients
          SET status='failed', attempted_at=NOW(),
              last_error=$2
        WHERE id=$1`,
      [recipientId, `Held back: no value for ${rendered.missing.join(", ")}`]
    );
    return;
  }

  try {
    const result = await transport.send({
      to: claim.email_raw,
      fromName: campaign.from_name,
      fromEmail: campaign.from_email,
      replyTo: campaign.reply_to,
      returnPath: bounceAddress(token, domain),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: rendered.headers,
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE campaign_recipients
            SET status='sent', sent_at=NOW(), attempted_at=NOW(),
                message_id=$2, smtp_queue_id=$3, last_smtp_code='250',
                unsub_token=$4, last_error=NULL
          WHERE id=$1`,
        [recipientId, result.messageId, result.queueId ?? null, token]
      );
      await client.query(
        `UPDATE email_identities
            SET contacted_count = contacted_count + 1, last_contacted_at = NOW()
          WHERE id=$1`, [identityId]
      );
      await client.query(
        `INSERT INTO sending_events
           (campaign_recipient_id, campaign_id, email_identity_id, event_type,
            smtp_code, smtp_response)
         VALUES ($1,$2,$3,'sent','250',$4)`,
        [recipientId, Number(campaign.id), identityId, result.response.slice(0, 500)]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = /\b([45]\d\d)\b/.exec(message)?.[1];
    const isPermanent = code?.startsWith("5") ?? false;

    await pool.query(
      `UPDATE campaign_recipients
          SET status=$2, attempted_at=NOW(), last_smtp_code=$3, last_error=$4
        WHERE id=$1`,
      [recipientId, isPermanent ? "bounced" : "failed", code ?? null, message.slice(0, 500)]
    );

    await pool.query(
      `INSERT INTO sending_events
         (campaign_recipient_id, campaign_id, email_identity_id, event_type, smtp_code, smtp_response)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        recipientId, Number(campaign.id), identityId,
        isPermanent ? "hard_bounce" : "failed", code ?? null, message.slice(0, 500),
      ]
    );

    // A 5xx at handoff means the address is bad. Suppress it now rather than
    // hitting it again in a later campaign.
    if (isPermanent) {
      await pool.query(
        `INSERT INTO suppression_list (email_normalized, reason, note, source_campaign_id, created_by)
         SELECT email_normalized, 'hard_bounce', $2, $3, 'worker'
           FROM email_identities WHERE id=$1
         ON CONFLICT (email_normalized) DO NOTHING`,
        [identityId, message.slice(0, 200), Number(campaign.id)]
      );
    }
  }
}

/* ---------------------------------------------------------------- loop */

async function tick(): Promise<number> {
  const settings = await loadSettings();

  if (settings.senderPaused) {
    log("Sending is paused globally in Settings.");
    return IDLE_POLL_MS;
  }
  if (!settings.postalAddress.trim()) {
    log("No postal address in Settings. Refusing to send.");
    return IDLE_POLL_MS;
  }

  const t = nowInTz(settings.timezone);
  const startMin = toMinutes(settings.windowStart);
  const endMin = toMinutes(settings.windowEnd);

  if (!settings.sendDays.includes(t.weekday)) {
    log(`Not a sending day. Window reopens on the next configured day.`);
    return IDLE_POLL_MS * 10;
  }
  if (t.minutes < startMin) {
    log(`Window opens at ${settings.windowStart}. Waiting.`);
    return Math.min((startMin - t.minutes) * 60_000, IDLE_POLL_MS * 10);
  }
  if (t.minutes >= endMin) {
    log(`Window closed at ${settings.windowEnd}. Done for today.`);
    return IDLE_POLL_MS * 10;
  }

  const { limit, note } = effectiveDailyLimit(settings, t.date);
  if (limit <= 0) {
    log(`Daily limit is 0${note ? ` (${note})` : ""}.`);
    return IDLE_POLL_MS;
  }

  const usage = await pool.query<{ sent_count: number }>(
    `SELECT sent_count FROM daily_sending_usage WHERE usage_date=$1 AND campaign_id=0`,
    [t.date]
  );
  const usedToday = usage.rows[0]?.sent_count ?? 0;
  if (usedToday >= limit) {
    log(`Daily limit reached: ${usedToday}/${limit}${note ? ` (${note})` : ""}.`);
    return IDLE_POLL_MS * 10;
  }

  const running = await pool.query<Record<string, string>>(`
    SELECT c.id, c.name, c.from_name, c.from_email, c.reply_to,
           t.subject, t.html_body, t.text_body
      FROM campaigns c JOIN templates t ON t.id = c.template_id
     WHERE c.status = 'running'
     ORDER BY c.started_at NULLS LAST, c.id
     LIMIT 1`);

  if (running.rowCount === 0) return IDLE_POLL_MS;
  const campaign = running.rows[0];
  const campaignId = Number(campaign.id);

  const stop = await checkSafety(campaignId);
  if (stop) {
    await pauseCampaign(campaignId, stop);
    return 5000;
  }

  const claimed = await pool.query<Claimed>(
    `SELECT * FROM claim_recipients($1, $2, $3, $4)`,
    [campaignId, BATCH_SIZE, limit, t.date]
  );

  if (claimed.rowCount === 0) {
    const left = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM campaign_recipients
        WHERE campaign_id=$1 AND status='pending'`, [campaignId]
    );
    if (Number(left.rows[0].c) === 0) {
      await pool.query(
        `UPDATE campaigns SET status='completed' WHERE id=$1 AND status='running'`,
        [campaignId]
      );
      await pool.query(
        `INSERT INTO activity_log (actor, action) VALUES ('worker', $1)`,
        [`Campaign completed: ${campaign.name}`]
      );
      log(`Campaign completed: ${campaign.name}`);
    }
    return IDLE_POLL_MS;
  }

  for (const claim of claimed.rows) {
    if (shuttingDown) break;
    await sendOne(claim, campaign, settings.postalAddress);

    const after = await pool.query<{ sent_count: number }>(
      `SELECT sent_count FROM daily_sending_usage WHERE usage_date=$1 AND campaign_id=0`,
      [t.date]
    );
    const used = after.rows[0]?.sent_count ?? 0;
    const now = nowInTz(settings.timezone);
    const wait = pauseBetweenSends(limit - used, endMin - now.minutes);

    log(`  sent to ${claim.email_raw}  (${used}/${limit}${note ? `, ${note}` : ""})  next in ${Math.round(wait / 1000)}s`);
    if (!shuttingDown) await new Promise((r) => setTimeout(r, wait));
  }

  return 0;
}

async function reaper() {
  const r = await pool.query<{ reap_stale_sends: number }>(`SELECT reap_stale_sends(10)`);
  const n = r.rows[0].reap_stale_sends;
  if (n > 0) {
    log(`Reaper: ${n} interrupted send(s) marked "unknown" for review. Not retried.`);
  }
}

async function main() {
  console.log("\nAzkal send worker\n" + "=".repeat(24));

  transport = makeTransport();
  const v = await transport.verify();
  console.log(`  Transport  ${transport.name}`);
  console.log(`  Status     ${v.detail}`);
  if (!v.ok) {
    console.error("\nTransport is not usable. Stopping.\n");
    process.exit(1);
  }
  if (!transport.isReal) {
    console.log(`  NOTE       Nothing will actually be delivered.\n`);
  } else {
    console.log(`  WARNING    This sends real email.\n`);
  }

  await reaper();
  setInterval(() => reaper().catch(() => {}), REAPER_EVERY_MS);

  for (;;) {
    if (shuttingDown) break;
    try {
      const wait = await tick();
      if (wait > 0 && !shuttingDown) {
        await new Promise((r) => setTimeout(r, wait));
      }
    } catch (e) {
      log(`Error: ${e instanceof Error ? e.message : e}`);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }

  await transport.close();
  await pool.end();
  console.log("Worker stopped.\n");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.log("\nFinishing the current message, then stopping. Ctrl+C again to force.");
  });
}

main().catch((e) => {
  console.error("Worker failed:", e);
  process.exit(1);
});
