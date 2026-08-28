import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/db";
import { requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

const Schema = z.object({
  global_daily_limit: z.number().int().min(1).max(5000),
  send_window_start: z.string().regex(/^\d{2}:\d{2}$/),
  send_window_end: z.string().regex(/^\d{2}:\d{2}$/),
  send_days: z.array(z.number().int().min(0).max(6)).min(1),
  warmup_enabled: z.boolean(),
  from_name: z.string().max(120),
  from_email: z.string().email().or(z.literal("")),
  reply_to: z.string().email().or(z.literal("")),
  postal_address: z.string().max(500),
});

export async function POST(req: Request) {
  const session = await requireSession();
  const parsed = Schema.safeParse(await req.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Those settings are not valid." },
      { status: 400 }
    );
  }

  const prev = await pool.query<{ value: number }>(
    `SELECT value::text::int AS value FROM system_settings WHERE key='global_daily_limit'`
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [key, value] of Object.entries(parsed.data)) {
      await client.query(
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, JSON.stringify(value)]
      );
    }
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not save settings." }, { status: 500 });
  } finally {
    client.release();
  }

  const before = prev.rows[0]?.value;
  if (before !== undefined && before !== parsed.data.global_daily_limit) {
    await logActivity(
      `Daily limit changed from ${before} to ${parsed.data.global_daily_limit}`,
      { actor: session.email }
    );
  }

  return NextResponse.json({ ok: true });
}
