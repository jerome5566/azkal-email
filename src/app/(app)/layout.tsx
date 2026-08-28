import { requireSession } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { pool } from "@/db";
import { dubaiToday } from "@/lib/format";

async function getSendingToday() {
  try {
    const [usage, limit] = await Promise.all([
      pool.query<{ sent_count: number }>(
        `SELECT sent_count FROM daily_sending_usage
          WHERE usage_date = $1 AND campaign_id = 0`,
        [dubaiToday()]
      ),
      pool.query<{ value: number }>(
        `SELECT value::text::int AS value FROM system_settings
          WHERE key = 'global_daily_limit'`
      ),
    ]);
    return {
      sentToday: usage.rows[0]?.sent_count ?? 0,
      dailyLimit: limit.rows[0]?.value ?? 500,
    };
  } catch {
    return { sentToday: 0, dailyLimit: 500 };
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const { sentToday, dailyLimit } = await getSendingToday();

  return (
    <div className="flex min-h-screen">
      <Sidebar sentToday={sentToday} dailyLimit={dailyLimit} />
      <div className="flex-1 min-w-0 flex flex-col">
        <main className="flex-1 px-8 lg:px-10 py-9 max-w-[1400px] w-full">{children}</main>
        <footer className="px-8 lg:px-10 py-6 text-[13px] text-ink-faint border-t border-line">
          &copy; {new Date().getFullYear()} Azkal Media Marketing Co. LLC &middot; Email Platform v0.1.0
        </footer>
      </div>
    </div>
  );
}
