import { NextResponse } from "next/server";
import { verify } from "@node-rs/argon2";
import { pool } from "@/db";
import { createSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

/* Crude in-memory throttle. Enough for a single-user internal tool. */
const attempts = new Map<string, { n: number; until: number }>();

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rec = attempts.get(ip);
  if (rec && rec.until > Date.now()) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a minute and try again." },
      { status: 429 }
    );
  }

  const { email, password } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  const res = await pool.query<{ id: number; email: string; password_hash: string }>(
    `SELECT id, email, password_hash FROM users WHERE email = $1`,
    [String(email).toLowerCase().trim()]
  );

  const ok =
    res.rowCount === 1 && (await verify(res.rows[0].password_hash, String(password)));

  if (!ok) {
    const n = (rec?.n ?? 0) + 1;
    attempts.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
    await logActivity(`Failed sign-in for ${email}`, { ip });
    return NextResponse.json({ error: "That email and password do not match." }, { status: 401 });
  }

  attempts.delete(ip);
  await createSession(res.rows[0].id, res.rows[0].email);
  await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [res.rows[0].id]);
  await logActivity(`Signed in`, { actor: res.rows[0].email, ip });

  return NextResponse.json({ ok: true });
}
