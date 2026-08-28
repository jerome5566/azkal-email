/* Creates or resets the single admin account. */
import "dotenv/config";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { hash } from "@node-rs/argon2";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const email = (await rl.question("Admin email: ")).trim().toLowerCase();
  stdout.write("Password (min 16 characters, not shown): ");
  const iface = rl as unknown as { _writeToOutput?: (s: string) => void };
  const original = iface._writeToOutput;
  iface._writeToOutput = () => {};
  const password = (await rl.question("")).trim();
  iface._writeToOutput = original;
  stdout.write("\n");
  rl.close();

  if (!email.includes("@")) { console.error("That is not an email address."); process.exit(1); }
  if (password.length < 16) { console.error("Password must be at least 16 characters."); process.exit(1); }

  const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

  await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [email, passwordHash]
  );
  console.log(`\nAdmin account ready: ${email}`);
  await pool.end();
}
main();
