/**
 * Free domain-level verification.
 *
 *   npm run verify:mx
 *
 * Looks up MX records for every distinct domain in the database and records
 * whether that domain can receive mail at all. Runs one lookup per domain, not
 * per address, so 38,000 contacts is only a few thousand actual queries.
 *
 * What this proves:   the domain exists and accepts mail
 * What it does NOT:   that a specific mailbox exists behind it
 *
 * A dead domain is a guaranteed hard bounce. Catching those before sending is
 * the difference between a clean warmup and a damaged IP.
 */
import "dotenv/config";
import dns from "node:dns/promises";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const CONCURRENCY = 24;
const TIMEOUT_MS = 6000;

type DomainVerdict = "has_mx" | "a_fallback" | "null_mx" | "no_mx" | "nxdomain" | "timeout";

interface DomainResult {
  domain: string;
  verdict: DomainVerdict;
  mxHost?: string;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

async function checkDomain(domain: string): Promise<DomainResult> {
  try {
    const mx = await withTimeout(dns.resolveMx(domain), TIMEOUT_MS);
    const real = mx.filter((m) => m.exchange && m.exchange !== "." && m.exchange.trim() !== "");

    // RFC 7505: a single MX of "." is an explicit declaration that this domain
    // accepts no mail at all. example.com does this. Treat it as dead.
    if (mx.length > 0 && real.length === 0) {
      return { domain, verdict: "null_mx" };
    }
    if (real.length > 0) {
      const best = real.sort((a, b) => a.priority - b.priority)[0];
      return { domain, verdict: "has_mx", mxHost: best.exchange };
    }
    // No MX is not automatically fatal. RFC 5321 allows falling back to the
    // A record, and some small business domains genuinely rely on that.
    try {
      const a = await withTimeout(dns.resolve4(domain), TIMEOUT_MS);
      if (a.length > 0) return { domain, verdict: "a_fallback", mxHost: domain };
    } catch { /* fall through */ }
    return { domain, verdict: "no_mx" };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "NXDOMAIN") return { domain, verdict: "nxdomain" };
    if (code === "ENODATA") {
      try {
        const a = await withTimeout(dns.resolve4(domain), TIMEOUT_MS);
        if (a.length > 0) return { domain, verdict: "a_fallback", mxHost: domain };
      } catch { /* fall through */ }
      return { domain, verdict: "no_mx" };
    }
    return { domain, verdict: "timeout" };
  }
}

async function main() {
  const recheck = process.argv.includes("--all");

  const domains = await pool.query<{ domain: string; n: string }>(
    `SELECT domain, COUNT(*)::text AS n
       FROM email_identities
      ${recheck ? "" : "WHERE has_mx IS NULL"}
      GROUP BY domain
      ORDER BY COUNT(*) DESC`
  );

  const total = domains.rowCount ?? 0;
  if (total === 0) {
    console.log("Every domain has already been checked. Use --all to redo them.");
    await pool.end();
    return;
  }

  const addresses = domains.rows.reduce((s, r) => s + Number(r.n), 0);
  console.log(
    `\nChecking ${total.toLocaleString()} domains covering ` +
    `${addresses.toLocaleString()} addresses.\n`
  );

  const results: DomainResult[] = [];
  let done = 0;
  const queue = [...domains.rows];

  async function worker() {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      results.push(await checkDomain(next.domain));
      done++;
      if (done % 50 === 0 || done === total) {
        process.stdout.write(
          `\r  ${done.toLocaleString()} / ${total.toLocaleString()} domains checked`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log("\n");

  /* ---- write results back ---- */
  const client = await pool.connect();
  const counts = { has_mx: 0, a_fallback: 0, null_mx: 0, no_mx: 0, nxdomain: 0, timeout: 0 };
  let deadAddresses = 0;

  try {
    await client.query("BEGIN");

    for (const r of results) {
      counts[r.verdict]++;
      const alive = r.verdict === "has_mx" || r.verdict === "a_fallback";
      // No MX but a web server answering usually means a parked or squatted
      // domain. Not proven dead, so not suppressed, but flagged as risky
      // rather than counted as sendable.
      const unproven = r.verdict === "a_fallback";

      // A timeout is not evidence of anything. Leave those unresolved rather
      // than marking a domain dead because a DNS server was slow once.
      if (r.verdict === "timeout") continue;

      const upd = await client.query(
        `UPDATE email_identities
            SET has_mx = $2,
                mx_checked_at = NOW(),
                verification_status = CASE
                  WHEN $2 = FALSE                 THEN 'invalid'::verification_status
                  WHEN $3 = TRUE                  THEN 'risky'::verification_status
                  WHEN is_role_account            THEN 'risky'::verification_status
                  ELSE 'valid'::verification_status
                END,
                verified_at = NOW()
          WHERE domain = $1`,
        [r.domain, alive, unproven]
      );

      if (!alive) deadAddresses += upd.rowCount ?? 0;

      await client.query(
        `INSERT INTO verification_results
           (email_identity_id, provider, status, reason, raw)
         SELECT id, 'local_mx',
                CASE WHEN $2 = FALSE THEN 'invalid'::verification_status
                     WHEN $5 = TRUE THEN 'risky'::verification_status
                     WHEN is_role_account THEN 'risky'::verification_status
                     ELSE 'valid'::verification_status END,
                $3, $4::jsonb
           FROM email_identities WHERE domain = $1`,
        [
          r.domain,
          alive,
          r.verdict === "has_mx"    ? `Domain accepts mail via ${r.mxHost}`
          : r.verdict === "a_fallback" ? "No mail server, only a web server. Likely parked."
          : r.verdict === "null_mx"    ? "Domain explicitly declares it accepts no mail (RFC 7505)"
          : r.verdict === "nxdomain"   ? "Domain does not exist"
          :                              "Domain exists but has no mail server",
          JSON.stringify({ verdict: r.verdict, mx: r.mxHost ?? null }),
          unproven,
        ]
      );

      // A domain that cannot receive mail is a guaranteed hard bounce.
      // Suppress it now rather than discovering it during warmup.
      if (!alive) {
        await client.query(
          `INSERT INTO suppression_list (email_normalized, reason, note, created_by)
           SELECT email_normalized, 'invalid_address', $2, 'mx-check'
             FROM email_identities WHERE domain = $1
           ON CONFLICT (email_normalized) DO NOTHING`,
          [
            r.domain,
            r.verdict === "nxdomain" ? "Domain does not exist"
            : r.verdict === "null_mx"  ? "Domain accepts no mail (RFC 7505 null MX)"
            :                            "Domain has no mail server",
          ]
        );
      }
    }

    await client.query(
      `INSERT INTO activity_log (actor, action, detail)
       VALUES ('mx-check', $1, $2::jsonb)`,
      [
        `MX check complete: ${counts.no_mx + counts.nxdomain} dead domains found, ` +
        `${deadAddresses.toLocaleString()} addresses suppressed`,
        JSON.stringify(counts),
      ]
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  const stats = await pool.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE verification_status='valid')::int   AS valid,
           COUNT(*) FILTER (WHERE verification_status='invalid')::int AS invalid,
           COUNT(*) FILTER (WHERE verification_status='risky')::int   AS risky,
           COUNT(*) FILTER (WHERE verification_status IS NULL)::int   AS unchecked,
           COUNT(*) FILTER (WHERE is_suppressed)::int                 AS suppressed
      FROM email_identities`);
  const s = stats.rows[0];

  const dead = counts.no_mx + counts.nxdomain + counts.null_mx;
  const pct = ((deadAddresses / addresses) * 100).toFixed(1);

  console.log(`Domains
  Accept mail            ${counts.has_mx.toLocaleString()}
  Web server only        ${counts.a_fallback.toLocaleString()}  (parked or squatted, flagged risky)
  Do not exist           ${counts.nxdomain.toLocaleString()}
  Refuse all mail        ${counts.null_mx.toLocaleString()}  (RFC 7505 null MX)
  Exist, no mail server  ${counts.no_mx.toLocaleString()}
  Could not resolve      ${counts.timeout.toLocaleString()}  (left unchecked, rerun later)

Contacts
  Sendable               ${s.valid.toLocaleString()}
  Role accounts (risky)  ${s.risky.toLocaleString()}
  Dead domain (invalid)  ${s.invalid.toLocaleString()}
  Still unchecked        ${s.unchecked.toLocaleString()}
  Suppressed in total    ${s.suppressed.toLocaleString()}

${deadAddresses.toLocaleString()} addresses (${pct}%) sit on ${dead.toLocaleString()} dead domains and have been
suppressed. Every one of those would have been a hard bounce.
`);

  if (counts.timeout > 0) {
    console.log(`Rerun to retry the ${counts.timeout} that timed out:  npm run verify:mx\n`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error("\nFailed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
