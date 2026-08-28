# The send worker

    npm run worker

Long-running process. Claims work from the queue, renders each message, hands it
to the transport, records the result, and paces itself across the sending
window. Run it in a second terminal alongside `npm run dev`.

---

## Two transports

The worker picks automatically based on your environment file.

**Local sink** (no `SMTP_HOST` set). Writes each message to `outbox/` as a .eml
file instead of sending it. Everything else is identical: the queue is claimed,
messages are rendered, results are recorded, pacing and daily limits apply. The
only thing that does not happen is delivery.

The .eml files open in Apple Mail. Double-click one and you see exactly what a
recipient would have received, including the footer and the unsubscribe header.

**Postfix** (`SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` all set). Real delivery
over authenticated submission on port 587. The worker announces this loudly at
startup.

---

## Running a full campaign locally

In one terminal:

    npm run dev

In another:

    npm run worker

Then in the browser: write a template, create a campaign, dry run it, start it.
Watch the worker log. Open `outbox/` and read a message.

To make it move faster while testing, set a wide window and a small daily limit
in Settings, or temporarily turn the warmup ramp off.

---

## Safety behaviour, and why

**A claim commits before the message is handed over.** If the worker dies at any
point after that, the row stays in `processing` and the reaper marks it
`unknown` ten minutes later. Nothing is retried automatically. Retrying a send
whose outcome is unknown risks delivering it twice, and a duplicate is worse
than a gap.

**Two workers cannot claim the same row.** `SELECT FOR UPDATE SKIP LOCKED`
inside the claim function.

**The daily cap is enforced inside the claim transaction**, not by the caller,
so no amount of concurrency overshoots it.

**Suppression is checked in the claim query and again by a trigger.** A
suppressed address is never handed to the transport.

**A 5xx at handoff suppresses the address immediately.** That is a permanent
failure, so it becomes a hard bounce and goes on the suppression list.

**Bounce and failure rates auto-pause the campaign**, but only once at least 50
messages have been attempted. Three bounces out of five is noise; three out of
two hundred is a signal.

**The worker refuses to run without a postal address** in Settings.

---

## Pacing

The remaining quota is spread across the remaining window rather than fired off
at once.

| Daily limit | Average gap | Fills |
|---|---|---|
| 20 | 28 min | 559 of 600 min |
| 35 | 17 min | 595 of 600 min |
| 100 | 6 min | 602 of 600 min |
| 500 | 72 sec | 603 of 600 min |

Each gap is jittered by plus or minus 25% so the pattern is not a metronome.

---

## Warmup

On by default. A new IP that jumps to full volume looks like a compromised
server, so the ramp climbs over about three weeks:

| Day | Limit |
|---|---|
| 1-2 | 20 |
| 3-4 | 35 |
| 5-6 | 50 |
| 7-8 | 75 |
| 9-10 | 100-150 |
| 11-14 | 200-300 |
| 15-17 | 350-500 |
| 18+ | full limit |

The ramp starts from `warmup_started_on` in settings. Set it on the day the
mail server passes verification:

    psql azkal_email -c "UPDATE system_settings SET value = '\"2026-09-01\"'::jsonb WHERE key = 'warmup_started_on';"

Until that is set, the worker uses the full configured limit, so do not start a
real campaign before setting it.

---

## Stopping it

Ctrl+C once. It finishes the message in flight, then exits cleanly. Ctrl+C twice
forces it, which is the case the reaper exists for.

---

## On the server later

    pm2 start npm --name azkal-worker -- run worker
    pm2 save

Run one worker. The locking supports more, but at 500 a day there is no reason.
