"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, Pill } from "./ui";

interface Template { id: number; name: string; subject: string; fields: string[] }

interface Props {
  templates: Template[];
  defaults: {
    dailyLimit: number; fromName: string; fromEmail: string;
    replyTo: string; postalAddress: string;
  };
}

export function CampaignBuilder({ templates, defaults }: Props) {
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? 0);
  const [source, setSource] = useState("");
  const [provider, setProvider] = useState("");
  const [excludeRoles, setExcludeRoles] = useState(true);
  const [excludeContacted, setExcludeContacted] = useState(true);
  const [dailyLimit, setDailyLimit] = useState(String(defaults.dailyLimit));
  const [maxBounce, setMaxBounce] = useState("5");
  const [count, setCount] = useState<{
    eligible: number; missingFields: number; sendable: number;
  } | null>(null);
  const [counting, setCounting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const template = templates.find((t) => t.id === templateId);

  // Recount whenever the filters move, so the number on screen is always the
  // number that would actually be queued.
  useEffect(() => {
    setCounting(true);
    const t = setTimeout(async () => {
      const res = await fetch("/api/recipients/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId,
          filters: {
            source, provider,
            excludeRoleAccounts: excludeRoles,
            excludePreviouslyContacted: excludeContacted,
          },
        }),
      });
      if (res.ok) setCount(await res.json());
      setCounting(false);
    }, 300);
    return () => clearTimeout(t);
  }, [source, provider, excludeRoles, excludeContacted, templateId]);

  async function create() {
    setBusy(true); setError(null);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, templateId,
        dailyLimit: Number(dailyLimit),
        maxBounceRate: Number(maxBounce),
        filters: {
          source, provider,
          excludeRoleAccounts: excludeRoles,
          excludePreviouslyContacted: excludeContacted,
        },
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      router.push(`/campaigns/${body.id}`);
      router.refresh();
    } else {
      setError(body.error ?? "Could not create the campaign.");
    }
  }

  const noPostal = !defaults.postalAddress.trim();
  const noSender = !defaults.fromEmail.trim();
  const days = count && Number(dailyLimit) > 0
    ? Math.ceil(count.sendable / Number(dailyLimit)) : 0;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <div className="xl:col-span-2 space-y-6">
        <Card title="Basics">
          <div className="space-y-4">
            <div>
              <label className="label block mb-1.5">Campaign name</label>
              <input
                className="input" placeholder="Reels and Photography, brokers, February"
                value={name} onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="label block mb-1.5">Template</label>
              <select
                className="input" value={templateId}
                onChange={(e) => setTemplateId(Number(e.target.value))}
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {template && (
                <p className="text-[12.5px] text-ink-faint mt-1.5">
                  Subject: {template.subject}
                </p>
              )}
            </div>
          </div>
        </Card>

        <Card title="Who receives it">
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="label block mb-1.5">Source list</label>
                <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="">Everyone</option>
                  <option value="broker">Brokers only</option>
                  <option value="agency">Agencies only</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="label block mb-1.5">Provider</label>
                <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
                  <option value="">All providers</option>
                  <option value="gmail">Gmail</option>
                  <option value="outlook">Outlook</option>
                  <option value="yahoo">Yahoo</option>
                  <option value="company">Company domains</option>
                  <option value="other_free">Other free</option>
                </select>
              </div>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={excludeRoles} className="mt-1 accent-[#22C6DA]"
                     onChange={(e) => setExcludeRoles(e.target.checked)} />
              <span>
                <span className="text-[14px] text-ink font-medium">Skip role accounts</span>
                <span className="block text-[12.5px] text-ink-muted mt-0.5 max-w-md">
                  info@, sales@, admin@ and similar. Highest complaint rates and where
                  spam traps live. Recommended for a first campaign.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={excludeContacted} className="mt-1 accent-[#22C6DA]"
                     onChange={(e) => setExcludeContacted(e.target.checked)} />
              <span>
                <span className="text-[14px] text-ink font-medium">
                  Skip anyone contacted before
                </span>
                <span className="block text-[12.5px] text-ink-muted mt-0.5 max-w-md">
                  Uses the permanent contact history, so a future campaign will not
                  reach the same people again.
                </span>
              </span>
            </label>

            <div className="pt-2 text-[12.5px] text-ink-faint border-t border-line">
              Suppressed contacts and dead domains are always excluded. That is not
              optional and cannot be turned off.
            </div>
          </div>
        </Card>

        <Card title="Sending">
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="label block mb-1.5">Daily limit</label>
              <input className="input" type="number" min={1} max={5000}
                     value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} />
              <p className="text-[12.5px] text-ink-faint mt-1.5">
                Capped by the global limit in Settings.
              </p>
            </div>
            <div className="flex-1">
              <label className="label block mb-1.5">Pause if bounces exceed</label>
              <div className="relative">
                <input className="input pr-8" type="number" min={1} max={50} step="0.5"
                       value={maxBounce} onChange={(e) => setMaxBounce(e.target.value)} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint text-[14px]">%</span>
              </div>
              <p className="text-[12.5px] text-ink-faint mt-1.5">
                Stops automatically. Needs your confirmation to resume.
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        <Card title="Recipients">
          {counting || !count ? (
            <div className="py-6 text-center text-[14px] text-ink-faint">Counting</div>
          ) : (
            <>
              <div className="text-stat text-ink">{count.sendable.toLocaleString()}</div>
              <div className="text-[13px] text-ink-muted mt-1">will be queued</div>

              {count.missingFields > 0 && (
                <div className="mt-4 p-3 bg-amber-50 rounded-control">
                  <div className="text-[13px] text-ink">
                    {count.missingFields.toLocaleString()} held back
                  </div>
                  <div className="text-[12.5px] text-ink-muted mt-1">
                    No value for a merge field the template needs. Sending them would
                    produce a gap in the greeting, so they are left out.
                  </div>
                </div>
              )}

              {days > 0 && (
                <div className="mt-4 pt-4 border-t border-line text-[13px] text-ink-muted">
                  About <span className="text-ink font-medium">{days} sending days</span> at{" "}
                  {Number(dailyLimit).toLocaleString()} a day, before warmup.
                </div>
              )}
            </>
          )}
        </Card>

        {template && template.fields.length > 0 && (
          <Card title="Template needs">
            <div className="flex flex-wrap gap-1.5">
              {template.fields.map((f) => <Pill key={f} tone="accent">{`{{${f}}}`}</Pill>)}
            </div>
          </Card>
        )}

        {(noPostal || noSender) && (
          <div className="surface p-4 border-amber-200 bg-amber-50/50">
            <div className="text-[13.5px] text-ink">
              {noSender && <div>No From address set.</div>}
              {noPostal && <div>No postal address set.</div>}
              <div className="mt-2 text-ink-muted">
                You can still create this campaign, but it cannot start until both
                are filled in.{" "}
                <a href="/settings" className="text-accent hover:underline">Settings</a>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="text-[13.5px] text-bad bg-red-50 border border-red-100 rounded-control px-3 py-2.5">
            {error}
          </div>
        )}

        <button
          onClick={create}
          disabled={busy || !name || !count || count.sendable === 0}
          className="btn-primary w-full"
        >
          {busy ? "Building the queue" : "Create campaign"}
        </button>
        <p className="text-[12.5px] text-ink-faint text-center -mt-3">
          Creates it as a draft. Nothing sends until you start it.
        </p>
      </div>
    </div>
  );
}
