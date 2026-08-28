"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "./ui";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function SettingsForm({ initial }: { initial: Record<string, unknown> }) {
  const [limit, setLimit] = useState(String(initial.global_daily_limit ?? 500));
  const [start, setStart] = useState(String(initial.send_window_start ?? "08:00"));
  const [end, setEnd] = useState(String(initial.send_window_end ?? "18:00"));
  const [days, setDays] = useState<number[]>(
    (initial.send_days as number[]) ?? [0, 1, 2, 3, 4, 5, 6]
  );
  const [warmup, setWarmup] = useState(Boolean(initial.warmup_enabled ?? true));
  const [fromName, setFromName] = useState(String(initial.from_name ?? "Azkal Media"));
  const [fromEmail, setFromEmail] = useState(String(initial.from_email ?? ""));
  const [replyTo, setReplyTo] = useState(String(initial.reply_to ?? ""));
  const [postal, setPostal] = useState(String(initial.postal_address ?? ""));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function save() {
    setBusy(true); setSaved(false); setError(null);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        global_daily_limit: Number(limit),
        send_window_start: start,
        send_window_end: end,
        send_days: days,
        warmup_enabled: warmup,
        from_name: fromName,
        from_email: fromEmail,
        reply_to: replyTo,
        postal_address: postal,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
    } else {
      setError(body.error ?? "Could not save.");
    }
  }

  const toggleDay = (d: number) =>
    setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort());

  return (
    <>
      <Card title="Sending limits" sub="Enforced by the database, not the browser">
        <div className="space-y-5">
          <div className="max-w-[200px]">
            <label className="label block mb-1.5">Global daily limit</label>
            <input className="input" type="number" min={1} max={5000}
                   value={limit} onChange={(e) => setLimit(e.target.value)} />
            <p className="text-[12.5px] text-ink-faint mt-1.5">
              A hard ceiling across all campaigns.
            </p>
          </div>

          <div className="flex gap-4 max-w-md">
            <div className="flex-1">
              <label className="label block mb-1.5">Window opens</label>
              <input className="input" type="time" value={start}
                     onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="label block mb-1.5">Window closes</label>
              <input className="input" type="time" value={end}
                     onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <p className="text-[12.5px] text-ink-faint -mt-3">Asia/Dubai time.</p>

          <div>
            <label className="label block mb-2">Sending days</label>
            <div className="flex gap-1.5 flex-wrap">
              {DAYS.map((d, i) => (
                <button key={d} onClick={() => toggleDay(i)}
                  className={`h-9 w-[52px] rounded-control text-[13.5px] font-medium transition-colors ${
                    days.includes(i)
                      ? "bg-accent text-white"
                      : "bg-card border border-line text-ink-muted hover:bg-page"
                  }`}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={warmup} className="mt-1 accent-[#22C6DA]"
                   onChange={(e) => setWarmup(e.target.checked)} />
            <span>
              <span className="text-[14px] text-ink font-medium">Use the warmup ramp</span>
              <span className="block text-[12.5px] text-ink-muted mt-0.5 max-w-md">
                Starts at 20 a day and climbs to the full limit over about three weeks.
                A new sending IP that jumps straight to full volume gets throttled.
              </span>
            </span>
          </label>
        </div>
      </Card>

      <Card title="Sender identity">
        <div className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="label block mb-1.5">From name</label>
              <input className="input" value={fromName}
                     onChange={(e) => setFromName(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="label block mb-1.5">From email</label>
              <input className="input" type="email" placeholder="hello@azkalmedia.agency"
                     value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label block mb-1.5">Reply-To</label>
            <input className="input" type="email" placeholder="you@azkalmedia.com"
                   value={replyTo} onChange={(e) => setReplyTo(e.target.value)} />
            <p className="text-[12.5px] text-ink-faint mt-1.5">
              Replies land here. Usually your normal business address.
            </p>
          </div>
          <div>
            <label className="label block mb-1.5">Postal address for the footer</label>
            <textarea className="input h-auto py-2.5" rows={2}
              placeholder="Azkal Media Marketing Co. LLC, Office 000, Dubai, UAE"
              value={postal} onChange={(e) => setPostal(e.target.value)} />
            <p className="text-[12.5px] text-ink-faint mt-1.5">
              Required in every campaign footer. Sending is blocked while this is empty.
            </p>
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy} className="btn-primary">
          {busy ? "Saving" : "Save settings"}
        </button>
        {saved && <span className="text-[13.5px] text-good">Saved</span>}
        {error && <span className="text-[13.5px] text-bad">{error}</span>}
      </div>
    </>
  );
}
