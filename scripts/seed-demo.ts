/**
 * Fills the database with realistic demo data so you can see every screen
 * populated before touching the real CSV files.
 *
 *   npm run seed:demo          add demo data
 *   npm run seed:demo -- wipe  remove it again
 *
 * Everything it creates is tagged, so `wipe` removes the demo data and leaves
 * anything you imported yourself alone.
 */
import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DEMO_TAG = "demo-seed";

const FIRST = [
  "Ahmed", "Mohammed", "Fatima", "Sara", "Omar", "Layla", "Khalid", "Noura",
  "Rashid", "Mariam", "Yousef", "Hind", "Saeed", "Aisha", "Tariq", "Zainab",
  "James", "Sarah", "Michael", "Priya", "Raj", "Elena", "Marco", "Anna",
];
const LAST = [
  "Al Mansouri", "Al Maktoum", "Al Zaabi", "Khan", "Ahmed", "Hassan",
  "Sharma", "Patel", "Rossi", "Novak", "Smith", "Ivanov", "Haddad", "Farouk",
];
const AR_FIRST = ["أحمد", "محمد", "فاطمة", "سارة", "عمر", "ليلى", "خالد", "نورة"];
const AR_LAST = ["المنصوري", "المكتوم", "الزعابي", "حسن", "أحمد", "فاروق"];

const OFFICES = [
  "Katch Avenue Real Estate", "Prime Properties", "Gulf Horizon Realty",
  "Marina Estates", "Dubai Hills Properties", "Palm Realty Group",
  "Downtown Living", "Emaar Partners", "Skyline Brokers", "Oasis Property",
  "Blue Wave Realty", "Sandstone Estates", "Meridian Property", "Aurora Homes",
];
const AR_OFFICES = ["كاتش افنيو", "برايم بروبرتيز", "أفق الخليج", "مارينا العقارية"];

/* Roughly what a Dubai broker registry actually looks like. */
const DOMAINS: [string, number][] = [
  ["gmail.com", 42], ["hotmail.com", 9], ["outlook.com", 6], ["yahoo.com", 5],
  ["icloud.com", 2],
  ["primeproperties.ae", 4], ["katchavenue.ae", 4], ["gulfhorizon.ae", 3],
  ["marinaestates.com", 3], ["dubaihills.ae", 3], ["palmrealty.ae", 3],
  ["downtownliving.ae", 3], ["skylinebrokers.ae", 3], ["oasisproperty.ae", 3],
  ["bluewave.ae", 2], ["sandstone.ae", 2],
];
const ROLE_LOCALS = ["info", "sales", "admin", "contact", "enquiries", "office"];

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const chance = (p: number) => Math.random() < p;

function weightedDomain(): string {
  const total = DOMAINS.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [d, w] of DOMAINS) {
    r -= w;
    if (r <= 0) return d;
  }
  return "gmail.com";
}

function classify(domain: string) {
  if (domain === "gmail.com") return "gmail";
  if (["hotmail.com", "outlook.com", "live.com"].includes(domain)) return "outlook";
  if (domain === "yahoo.com") return "yahoo";
  if (["icloud.com", "aol.com"].includes(domain)) return "other_free";
  return "company";
}

async function wipe() {
  console.log("Removing demo data...");
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      `DELETE FROM suppression_list WHERE note = $1 OR created_by = $1`, [DEMO_TAG]
    );
    await c.query(
      `DELETE FROM email_identities
        WHERE id IN (SELECT email_identity_id FROM brokers  WHERE raw_row->>'_seed' = $1)
           OR id IN (SELECT email_identity_id FROM agencies WHERE raw_row->>'_seed' = $1)`,
      [DEMO_TAG]
    );
    await c.query(`DELETE FROM import_batches WHERE filename LIKE 'demo_%'`);
    await c.query(`DELETE FROM activity_log WHERE actor = $1`, [DEMO_TAG]);
    await c.query("COMMIT");
    console.log("Demo data removed.");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

async function seed(count = 2400) {
  console.log(`Creating ${count} demo contacts...`);
  const c = await pool.connect();

  try {
    await c.query("BEGIN");

    const batches = await Promise.all([
      c.query<{ id: number }>(
        `INSERT INTO import_batches
           (filename, source_type, status, encoding, total_rows, unique_emails,
            new_emails, existing_emails, invalid_rows, blank_email_rows, completed_at)
         VALUES ('demo_brokers.csv','broker','completed','utf8',
                 $1,$2,$2,0,$3,$4, NOW()) RETURNING id`,
        [Math.round(count * 0.75), Math.round(count * 0.68), 41, 17]
      ),
      c.query<{ id: number }>(
        `INSERT INTO import_batches
           (filename, source_type, status, encoding, total_rows, unique_emails,
            new_emails, existing_emails, invalid_rows, blank_email_rows, completed_at)
         VALUES ('demo_agencies.csv','agency','completed','utf8',
                 $1,$2,$3,$4,$5,$6, NOW()) RETURNING id`,
        [
          Math.round(count * 0.25), Math.round(count * 0.22),
          Math.round(count * 0.17), Math.round(count * 0.05), 12, 6,
        ]
      ),
    ]);
    const brokerBatch = batches[0].rows[0].id;
    const agencyBatch = batches[1].rows[0].id;

    const identityIds: number[] = [];
    const usedNormalized = new Set<string>();

    for (let i = 0; i < count; i++) {
      const isAgency = i >= count * 0.75;
      const first = pick(FIRST);
      const last = pick(LAST);
      const domain = weightedDomain();
      const isCompanyDomain = classify(domain) === "company";
      const isRole = isCompanyDomain && chance(0.22);

      const local = isRole
        ? pick(ROLE_LOCALS)
        : `${first.toLowerCase()}.${last.toLowerCase().replace(/\s+/g, "")}${
            chance(0.35) ? Math.floor(Math.random() * 90) + 10 : ""
          }`;

      let normalized = `${local}@${domain}`;
      if (usedNormalized.has(normalized)) {
        normalized = `${local}${i}@${domain}`;
      }
      usedNormalized.add(normalized);
      const [localPart] = normalized.split("@");

      // Roughly a real-world verification spread for an uncleaned registry list
      const roll = Math.random();
      const verification =
        roll < 0.62 ? "valid" : roll < 0.78 ? "risky" : roll < 0.9 ? "invalid" : null;

      const contacted = chance(0.18);

      const r = await c.query<{ id: string }>(
        `INSERT INTO email_identities
           (email_raw, email_normalized, local_part, domain, provider_type,
            is_role_account, verification_status, verified_at,
            contacted_count, last_contacted_at)
         VALUES ($1,$2,$3,$4,$5::provider_type,$6,$7::verification_status,
                 CASE WHEN $7 IS NULL THEN NULL ELSE NOW() - INTERVAL '3 days' END,
                 $8, CASE WHEN $8 > 0 THEN NOW() - (random()*30 || ' days')::interval END)
         ON CONFLICT (email_normalized) DO NOTHING
         RETURNING id`,
        [
          normalized, normalized, localPart, domain, classify(domain),
          isRole, verification, contacted ? 1 : 0,
        ]
      );
      if (r.rowCount === 0) continue;

      const id = Number(r.rows[0].id);
      identityIds.push(id);

      const office = pick(OFFICES);
      const seedRow = JSON.stringify({ _seed: DEMO_TAG });

      if (isAgency) {
        await c.query(
          `INSERT INTO agencies
             (email_identity_id, office_number, name_en, name_ar, website,
              phone, import_batch_id, raw_row)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id, `ORN-${11000 + i}`, office, pick(AR_OFFICES),
            `https://www.${domain.replace(/^(gmail|hotmail|outlook|yahoo|icloud)\..*/, "example.ae")}`,
            `+9714${Math.floor(1000000 + Math.random() * 8999999)}`,
            agencyBatch, seedRow,
          ]
        );
      } else {
        await c.query(
          `INSERT INTO brokers
             (email_identity_id, broker_number, name_en, name_ar,
              office_name_en, office_name_ar, phone, import_batch_id, raw_row)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id, `BRN-${40000 + i}`, `${first} ${last}`,
            `${pick(AR_FIRST)} ${pick(AR_LAST)}`,
            office, pick(AR_OFFICES),
            `+9715${Math.floor(10000000 + Math.random() * 89999999)}`,
            brokerBatch, seedRow,
          ]
        );
      }

      // A slice of contacts appear in both source files, which is the whole
      // reason email_identities exists as a separate table.
      if (!isAgency && chance(0.06)) {
        await c.query(
          `INSERT INTO agencies
             (email_identity_id, office_number, name_en, name_ar, phone,
              import_batch_id, raw_row)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            id, `ORN-${21000 + i}`, office, pick(AR_OFFICES),
            `+9714${Math.floor(1000000 + Math.random() * 8999999)}`,
            agencyBatch, seedRow,
          ]
        );
      }
    }

    /* Suppression: a manual exclusion set plus simulated bounces */
    const toSuppress = identityIds
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.round(identityIds.length * 0.045));

    for (const [i, id] of toSuppress.entries()) {
      const reason =
        i % 4 === 0 ? "manual" : i % 4 === 1 ? "hard_bounce"
        : i % 4 === 2 ? "unsubscribe" : "complaint";
      await c.query(
        `INSERT INTO suppression_list (email_normalized, reason, note, created_by)
         SELECT email_normalized, $2::suppression_reason, $3, $3
           FROM email_identities WHERE id = $1
         ON CONFLICT DO NOTHING`,
        [id, reason, DEMO_TAG]
      );
    }

    await c.query(
      `INSERT INTO activity_log (actor, action) VALUES
         ($1, 'Imported 1,802 new contacts from demo_brokers.csv'),
         ($1, 'Imported 597 new contacts from demo_agencies.csv'),
         ($1, 'Daily limit changed from 200 to 500'),
         ($1, 'Contact excluded: info@primeproperties.ae'),
         ($1, 'Signed in')`,
      [DEMO_TAG]
    );

    await c.query("COMMIT");

    const stats = await pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE provider_type='gmail')::int   AS gmail,
             COUNT(*) FILTER (WHERE provider_type='company')::int AS company,
             COUNT(*) FILTER (WHERE is_role_account)::int         AS roles,
             COUNT(*) FILTER (WHERE is_suppressed)::int           AS suppressed
        FROM email_identities`);
    const s = stats.rows[0];

    console.log(`
Demo data created.

  Contacts      ${s.total}
  Gmail         ${s.gmail}
  Company       ${s.company}
  Role accounts ${s.roles}
  Suppressed    ${s.suppressed}

Open http://localhost:3000 and every screen will have data in it.
Run "npm run seed:demo -- wipe" to remove it before importing real data.
`);
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

const arg = process.argv[2];
(arg === "wipe" ? wipe() : seed())
  .then(() => pool.end())
  .catch((e) => {
    console.error("Failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
