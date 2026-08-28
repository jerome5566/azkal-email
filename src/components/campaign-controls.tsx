"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "./ui";

interface DryRunResult {
  checked: number; ok: number; withProblems: number;
  samples: { email: string; subject: string; missing: string[] }[];
}

export function CampaignControls({
  id, status, blockers, pending,
}: { id: number; status: string; blockers: string[]; pending: number }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const router = useRouter();

  async function act(action: string) {
    setBusy(action); setError(null);
    const res = await fetch(`/api/campaigns/${id}/${action}`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    setConfirmStop(false);
    if (!res.ok) { setError(body.error ?? "That did not work."); return; }
    if (action === "dry-run") { setDryRun(body); return; }
    router.refresh();
  }

  const canStart = status === "draft" || status === "paused";
  const hardBlocked = blockers.some((b) => !b.startsWith("No sending server"));

  return (
    <>
      <Card title="Controls">
        {blockers.length > 0 && (
          <ul className="space-y-1.5 mb-4 text-[13px] text-warn">
            {blockers.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        )}

        <div className="space-y-2">
          <button
            onClick={() => act("dry-run")}
            disabled={busy !== null || pending === 0}
            className="btn-quiet w-full"
          >
            {busy === "dry-run" ? "Rendering" : "Dry run"}
          </button>
          <p className="text-[12.5px] text-ink-faint">
            Renders every queued message and reports problems. Sends nothing.
          </p>

          {canStart && (
            <button
              onClick={() => act("start")}
              disabled={busy !== null || hardBlocked || pending === 0}
              className="btn-primary w-full mt-3"
            >
              {busy === "start" ? "Starting" : status === "paused" ? "Resume" : "Start campaign"}
            </button>
          )}

          {status === "running" && (
            <button onClick={() => act("pause")} disabled={busy !== null}
                    className="btn-quiet w-full mt-3">
              {busy === "pause" ? "Pausing" : "Pause"}
            </button>
          )}

          {(status === "running" || status === "paused") && (
            confirmStop ? (
              <div className="mt-3 p-3 bg-red-50 rounded-control">
                <div className="text-[13px] text-ink mb-2">
                  Stopping is permanent. History is kept, but the campaign cannot be
                  restarted.
                </div>
                <div className="flex gap-2">
                  <button onClick={() => act("stop")} disabled={busy !== null}
                          className="btn-danger btn-sm flex-1">
                    {busy === "stop" ? "Stopping" : "Stop for good"}
                  </button>
                  <button onClick={() => setConfirmStop(false)} className="btn-quiet btn-sm">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmStop(true)} className="btn-danger w-full mt-3">
                Stop
              </button>
            )
          )}
        </div>

        {error && <div className="mt-3 text-[13px] text-bad">{error}</div>}
      </Card>

      {dryRun && (
        <Card title="Dry run" sub={`${dryRun.checked.toLocaleString()} messages rendered`}>
          <div className="space-y-2.5 text-[14px]">
            <div className="flex justify-between">
              <span className="text-ink-soft">Would send cleanly</span>
              <span className="text-good font-medium">{dryRun.ok.toLocaleString()}</span>
            </div>
            {dryRun.withProblems > 0 && (
              <div className="flex justify-between">
                <span className="text-ink-soft">Would be held back</span>
                <span className="text-warn font-medium">
                  {dryRun.withProblems.toLocaleString()}
                </span>
              </div>
            )}
          </div>

          {dryRun.samples.length > 0 && (
            <div className="mt-4 pt-4 border-t border-line">
              <div className="label mb-2">Sample subject lines</div>
              <ul className="space-y-2">
                {dryRun.samples.map((s, i) => (
                  <li key={i} className="text-[13px]">
                    <div className="text-ink">{s.subject}</div>
                    <div className="text-ink-faint text-[12px] mt-0.5">
                      {s.email}
                      {s.missing.length > 0 && (
                        <span className="text-warn"> · missing {s.missing.join(", ")}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
