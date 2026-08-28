import { num, pct } from "@/lib/format";
import type { ReactNode } from "react";

export function PageHeader({
  title, sub, action,
}: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 mb-8">
      <div>
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label, value, sub, tone = "neutral",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "neutral" | "accent" | "good" | "warn" | "bad";
}) {
  const toneClass = {
    neutral: "text-ink",
    accent: "text-accent",
    good: "text-good",
    warn: "text-warn",
    bad: "text-bad",
  }[tone];

  return (
    <div className="surface p-5">
      <div className="text-[13px] text-ink-muted font-medium">{label}</div>
      <div className={`text-stat mt-2 ${toneClass}`}>
        {typeof value === "number" ? num(value) : value}
      </div>
      {sub && <div className="text-[12.5px] text-ink-faint mt-1.5">{sub}</div>}
    </div>
  );
}

export function Progress({
  value, max, showLabel = true,
}: { value: number; max: number; showLabel?: boolean }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      {showLabel && (
        <div className="flex items-center justify-between text-[13.5px] mb-2">
          <span className="text-ink-soft">
            {num(value)} / {num(max)}
          </span>
          <span className="text-ink-muted">{pct(value, max)}</span>
        </div>
      )}
      <div className="h-2 bg-accent-track rounded-full overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all duration-500"
          style={{ width: `${p}%` }}
        />
      </div>
    </div>
  );
}

const PILL_TONES: Record<string, string> = {
  neutral: "bg-page text-ink-muted",
  accent: "bg-accent-soft text-accent",
  good: "bg-green-50 text-good",
  warn: "bg-amber-50 text-warn",
  bad: "bg-red-50 text-bad",
};

export function Pill({
  children, tone = "neutral",
}: { children: ReactNode; tone?: keyof typeof PILL_TONES }) {
  return <span className={`pill ${PILL_TONES[tone]}`}>{children}</span>;
}

/** Consistent colouring for the states that appear across every screen. */
export function StatusPill({ status }: { status: string }) {
  const map: Record<string, keyof typeof PILL_TONES> = {
    valid: "good", delivered: "good", sent: "good", completed: "good", running: "accent",
    risky: "warn", unknown: "warn", paused: "warn", soft_bounce: "warn", scheduled: "accent",
    invalid: "bad", bounced: "bad", failed: "bad", hard_bounce: "bad", stopped: "bad",
    excluded: "bad", suppressed: "bad",
    pending: "neutral", processing: "accent", draft: "neutral",
  };
  const label = status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return <Pill tone={map[status] ?? "neutral"}>{label}</Pill>;
}

export function ProviderPill({ type }: { type: string }) {
  const label: Record<string, string> = {
    gmail: "Gmail", outlook: "Outlook", yahoo: "Yahoo",
    other_free: "Other free", company: "Company", unknown: "Unknown",
  };
  const tone: Record<string, keyof typeof PILL_TONES> = {
    gmail: "bad", outlook: "accent", yahoo: "warn",
    company: "good", other_free: "neutral", unknown: "neutral",
  };
  return <Pill tone={tone[type] ?? "neutral"}>{label[type] ?? type}</Pill>;
}

export function EmptyState({
  title, body, action,
}: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="surface px-8 py-16 text-center">
      <div className="text-[17px] font-semibold text-ink">{title}</div>
      <p className="text-[14.5px] text-ink-muted mt-2 max-w-md mx-auto leading-relaxed">{body}</p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

export function Card({
  title, sub, action, children, pad = true,
}: {
  title?: string; sub?: string; action?: ReactNode;
  children: ReactNode; pad?: boolean;
}) {
  return (
    <div className="surface overflow-hidden">
      {(title || action) && (
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-line">
          <div>
            {title && <div className="text-[15.5px] font-semibold text-ink">{title}</div>}
            {sub && <div className="text-[13px] text-ink-muted mt-0.5">{sub}</div>}
          </div>
          {action}
        </div>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </div>
  );
}
