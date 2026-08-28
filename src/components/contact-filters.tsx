"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";

const FILTERS = [
  { key: "source", label: "Source", options: [
    ["", "All sources"], ["broker", "Brokers"], ["agency", "Agencies"]] },
  { key: "provider", label: "Provider", options: [
    ["", "All providers"], ["gmail", "Gmail"], ["outlook", "Outlook"], ["yahoo", "Yahoo"],
    ["company", "Company"], ["other_free", "Other free"]] },
  { key: "status", label: "Verification", options: [
    ["", "Any status"], ["valid", "Valid"], ["invalid", "Invalid"], ["risky", "Risky"],
    ["unknown", "Unknown"], ["unchecked", "Not checked"]] },
  { key: "flag", label: "Show", options: [
    ["", "Everyone"], ["active", "Not excluded"], ["excluded", "Excluded"],
    ["contacted", "Contacted"], ["not_contacted", "Not contacted"],
    ["role", "Role accounts"]] },
] as const;

export function ContactFilters({
  current,
}: { current: Record<string, string | undefined> }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(current.q ?? "");

  // Debounce so typing does not fire a query per keystroke against 44k rows.
  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams(sp.toString());
      if (q) params.set("q", q);
      else params.delete("q");
      params.delete("page");
      if ((current.q ?? "") !== q) router.push(`/contacts?${params}`);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    router.push(`/contacts?${params}`);
  }

  const anyActive = FILTERS.some((f) => current[f.key]) || current.q;

  return (
    <div className="surface p-4 mb-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]">
          <label className="label block mb-1.5">Search</label>
          <input
            className="input"
            placeholder="Email, name, office, broker number or office number"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {FILTERS.map((f) => (
          <div key={f.key} className="min-w-[150px]">
            <label className="label block mb-1.5">{f.label}</label>
            <select
              className="input"
              value={current[f.key] ?? ""}
              onChange={(e) => setFilter(f.key, e.target.value)}
            >
              {f.options.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
        ))}

        {anyActive && (
          <button onClick={() => router.push("/contacts")} className="btn-quiet">
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
