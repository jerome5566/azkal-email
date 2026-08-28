/**
 * One command to get running: npm run setup
 *
 * Creates the .env file, creates the database, applies the schema and safety
 * triggers, creates your admin account, and optionally loads demo data.
 *
 * Safe to run more than once. Anything already done is skipped.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import crypto from "node:crypto";
import { Client, Pool } from "pg";
import { hash } from "@node-rs/argon2";

const CHECK = "\u2713";
const CROSS = "\u2717";
const ok = (m: string) => console.log(`  ${CHECK} ${m}`);
const bad = (m: string) => console.log(`  ${CROSS} ${m}`);
const step = (n: number, m: string) => console.log(`\n[${n}/5] ${m}`);

const DB_NAME = "azkal_email";

function sh(cmd: string): string | null {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

/** Read a password without echoing it to the terminal. */
async function askHidden(rl: readline.Interface, prompt: string): Promise<string> {
  stdout.write(prompt);
  const iface = rl as unknown as { _writeToOutput?: (s: string) => void };
  const original = iface._writeToOutput;
  iface._writeToOutput = () => {};
  const answer = await rl.question("");
  iface._writeToOutput = original;
  stdout.write("\n");
  return answer;
}

async function main() {
  console.log("\nAzkal Email Platform setup\n" + "=".repeat(28));

  /* ---------------------------------------------------------- 1. .env --- */
  step(1, "Configuration");

  const envPath = path.join(process.cwd(), ".env");
  let dbUrl: string;

  if (fs.existsSync(envPath)) {
    const existing = fs.readFileSync(envPath, "utf8");
    const match = existing.match(/^DATABASE_URL=(.+)$/m);
    const secret = existing.match(/^SESSION_SECRET=(.+)$/m);
    const placeholder =
      !match || match[1].includes("CHANGE_ME") || match[1].includes("//azkal:");

    if (placeholder || !secret || secret[1].includes("CHANGE_ME")) {
      dbUrl = `postgres://${os.userInfo().username}@127.0.0.1:5432/${DB_NAME}`;
      const patched = existing
        .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${dbUrl}`)
        .replace(
          /^SESSION_SECRET=.*$/m,
          `SESSION_SECRET=${crypto.randomBytes(48).toString("base64")}`
        );
      fs.writeFileSync(envPath, patched);
      ok(".env updated with your local database and a fresh session secret");
    } else {
      dbUrl = match[1].trim();
      ok(".env already configured, leaving it alone");
    }
  } else {
    dbUrl = `postgres://${os.userInfo().username}@127.0.0.1:5432/${DB_NAME}`;
    const template = fs.existsSync(".env.example")
      ? fs.readFileSync(".env.example", "utf8")
      : "DATABASE_URL=\nSESSION_SECRET=\n";
    fs.writeFileSync(
      envPath,
      template
        .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${dbUrl}`)
        .replace(
          /^SESSION_SECRET=.*$/m,
          `SESSION_SECRET=${crypto.randomBytes(48).toString("base64")}`
        )
    );
    ok(".env created");
  }
  process.env.DATABASE_URL = dbUrl;

  /* ------------------------------------------------------ 2. database --- */
  step(2, "Database");

  if (!sh("which psql")) {
    bad("PostgreSQL is not installed.");
    console.log(`
    Install it, then run this again:

      brew install postgresql@16
      brew services start postgresql@16
      echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zprofile
      source ~/.zprofile
`);
    process.exit(1);
  }
  ok("psql found");

  // Connect to the maintenance database to see whether ours exists.
  const adminUrl = dbUrl.replace(/\/[^/]+$/, "/postgres");
  const admin = new Client({ connectionString: adminUrl });

  try {
    await admin.connect();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/does not exist/.test(msg) && /role/.test(msg)) {
      bad(`PostgreSQL has no role for your Mac user.`);
      console.log(`\n    Fix it with:\n\n      createuser -s ${os.userInfo().username}\n`);
    } else if (/ECONNREFUSED/.test(msg)) {
      bad("PostgreSQL is not running.");
      console.log("\n    Start it with:\n\n      brew services start postgresql@16\n");
    } else {
      bad(msg);
    }
    process.exit(1);
  }

  const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [DB_NAME]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
    ok(`Database "${DB_NAME}" created`);
  } else {
    ok(`Database "${DB_NAME}" already exists`);
  }
  await admin.end();

  const pool = new Pool({ connectionString: dbUrl });
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  ok("Search extension enabled");

  /* ------------------------------------------------------ 3. schema ----- */
  step(3, "Schema and safety triggers");

  const already = await pool.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name='email_identities'`
  );

  if (already.rowCount && already.rowCount > 0) {
    ok("Tables already exist, skipping");
  } else {
    const dir = path.join(process.cwd(), "drizzle");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const client = await pool.connect();
    try {
      for (const f of files) {
        const sql = fs.readFileSync(path.join(dir, f), "utf8");
        for (const part of sql.split("--> statement-breakpoint")) {
          const t = part.trim();
          if (t) await client.query(t);
        }
        ok(`Applied ${f}`);
      }
    } finally {
      client.release();
    }
  }

  /* ------------------------------------------------------ 4. admin ------ */
  step(4, "Admin account");

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const users = await pool.query<{ email: string }>(`SELECT email FROM users LIMIT 1`);

  if (users.rowCount && users.rowCount > 0) {
    ok(`Account already exists: ${users.rows[0].email}`);
    const redo = (await rl.question("  Create another or reset the password? [y/N] "))
      .trim().toLowerCase();
    if (redo !== "y") {
      console.log("  Skipping.");
    } else {
      await createUser(pool, rl);
    }
  } else {
    await createUser(pool, rl);
  }

  /* ------------------------------------------------------ 5. demo ------- */
  step(5, "Demo data");

  const count = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM email_identities`
  );

  if (Number(count.rows[0].c) > 0) {
    ok(`${Number(count.rows[0].c).toLocaleString()} contacts already in the database`);
  } else {
    const want = (await rl.question(
      "  Load ~2,400 demo contacts so the screens have data? [Y/n] "
    )).trim().toLowerCase();

    if (want === "n") {
      console.log("  Skipped. The dashboard will be empty until you import a CSV.");
    } else {
      rl.close();
      await pool.end();
      console.log("  Loading...");
      execSync("npx tsx scripts/seed-demo.ts", { stdio: "inherit" });
      done();
      return;
    }
  }

  rl.close();
  await pool.end();
  done();
}

function done() {
  console.log(`
${"=".repeat(28)}
Setup complete.

  npm run dev

Then open http://localhost:3000

To clear the demo data before importing your real CSV files:

  npm run seed:demo -- wipe
`);
}

async function createUser(pool: Pool, rl: readline.Interface) {
  for (;;) {
    const email = (await rl.question("  Your email: ")).trim().toLowerCase();
    if (!email.includes("@")) {
      bad("That is not an email address.");
      continue;
    }

    const password = await askHidden(rl, "  Password (16+ characters, not shown): ");

    if (password.length < 16) {
      bad("Too short. Use 16 characters or more, a passphrase of four unrelated words works well.");
      continue;
    }
    if (password.toLowerCase().includes(email.split("@")[0].toLowerCase())) {
      bad("Do not put your own name or email inside the password.");
      continue;
    }

    const confirm = await askHidden(rl, "  Type it again: ");
    if (confirm !== password) {
      bad("Those did not match.");
      continue;
    }

    const passwordHash = await hash(password, {
      memoryCost: 19456, timeCost: 2, parallelism: 1,
    });
    await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [email, passwordHash]
    );
    ok(`Account ready: ${email}`);
    return;
  }
}

main().catch((e) => {
  console.error("\nSetup failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
