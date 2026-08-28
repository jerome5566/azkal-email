"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { num } from "@/lib/format";

const NAV = [
  { href: "/", label: "Dashboard", icon: GridIcon },
  { href: "/campaigns", label: "Campaigns", icon: SendIcon },
  { href: "/contacts", label: "Contacts", icon: PeopleIcon },
  { href: "/templates", label: "Templates", icon: DocIcon },
  { href: "/verification", label: "Email Verification", icon: CheckIcon },
  { href: "/exclusions", label: "Exclusions", icon: BanIcon },
  { href: "/import", label: "Import", icon: UploadIcon },
  { href: "/server", label: "Sending Server", icon: ServerIcon },
  { href: "/activity", label: "Activity Log", icon: ClockIcon },
  { href: "/settings", label: "Settings", icon: GearIcon },
];

export function Sidebar({ sentToday, dailyLimit }: { sentToday: number; dailyLimit: number }) {
  const pathname = usePathname();
  const pctUsed = dailyLimit > 0 ? Math.min(100, (sentToday / dailyLimit) * 100) : 0;

  return (
    <aside className="w-[248px] shrink-0 bg-card border-r border-line min-h-screen flex flex-col sticky top-0">
      <div className="px-7 pt-8 pb-9">
        <Link href="/" className="inline-block">
          <div className="text-[26px] font-bold tracking-tight leading-none text-ink">
            azkal<span className="text-accent">.</span>
          </div>
          <div className="text-[9px] tracking-[0.22em] text-ink-faint mt-1.5 font-medium">
            EMAIL PLATFORM
          </div>
        </Link>
      </div>

      <nav className="px-4 flex-1 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 h-10 rounded-control text-[14.5px] transition-colors ${
                active
                  ? "bg-page text-ink font-semibold"
                  : "text-ink-muted hover:text-ink hover:bg-page/70"
              }`}
            >
              <Icon className={active ? "text-accent" : "text-ink-faint"} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-7 py-6 mt-6 border-t border-line">
        <div className="text-[13px] text-ink-muted">Today&rsquo;s sending</div>
        <div className="text-[15px] text-ink mt-1 font-medium">
          {num(sentToday)} / {num(dailyLimit)}
        </div>
        <div className="h-1.5 bg-accent-track rounded-full mt-2.5 overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all"
            style={{ width: `${pctUsed}%` }}
          />
        </div>
        <form action="/api/auth/logout" method="post" className="mt-6">
          <button
            type="submit"
            className="flex items-center gap-2.5 text-[14px] text-ink-muted hover:text-ink"
          >
            <LogoutIcon /> Log out
          </button>
        </form>
      </div>
    </aside>
  );
}

/* --- icons: 18px, 1.6 stroke, matching the Content Portal weight --- */
type P = { className?: string };
const base = (c?: string) =>
  `w-[18px] h-[18px] shrink-0 ${c ?? ""}`;
const svg = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

function GridIcon({ className }: P) {
  return (
    <svg {...svg} className={base(className)}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function SendIcon({ className }: P) {
  return (
    <svg {...svg} className={base(className)}>
      <path d="M22 2 11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}
function PeopleIcon({ className }: P) {
  return (
    <svg {...svg} className={base(className)}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    </svg>
  );
}
function DocIcon({ className }: P) {
  return (
    <svg {...svg} className={base(className)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" />
    </svg>
  );
}
function CheckIcon({ className }: P) {
  return (
    <svg {...svg} className={base(className)}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="M22 4 12 14.01l-3-3" />
    </svg>
  );
}
function BanIcon({ className }: P) {
  return (
    <svg {...svg} className={base(className)}>
      <circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" />
    </svg>
  );
}
function UploadIcon({ className }: P) {
  return (
    <svg {...svg} className={base(className)}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" /><path d="M12 3v12" />
    </svg>
  );
}
function ServerIcon({ className }: P) {
  return (
    <svg {...svg} className={base(className)}>
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <path d="M6 6h.01M6 18h.01" />
    </svg>
  );
}
function ClockIcon({ className }: P) {
  return (
    <svg {...svg} className={base(className)}>
      <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
    </svg>
  );
}
function GearIcon({ className }: P) {
  return (
    <svg {...svg} className={base(className)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg {...svg} className={base()}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" /><path d="M21 12H9" />
    </svg>
  );
}
