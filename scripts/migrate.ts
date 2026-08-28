/* Applies the generated schema migration, then the hand-written guards. */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const dir = path.join(process.cwd(), "drizzle");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  if (files.length === 0) {
    console.error("No .sql files in ./drizzle. Run: npm run db:generate");
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    for (const f of files) {
      process.stdout.write(`Applying ${f} ... `);
      const sql = fs.readFileSync(path.join(dir, f), "utf8");
      for (const part of sql.split("--> statement-breakpoint")) {
        const trimmed = part.trim();
        if (trimmed) await client.query(trimmed);
      }
      console.log("done");
    }
    console.log("\nAll migrations applied.");
  } catch (err) {
    console.error("\nFailed:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
main();
