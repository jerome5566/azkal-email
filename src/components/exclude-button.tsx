"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function ExcludeButton({
  id, excluded, email,
}: { id: number; excluded: boolean; email: string }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  async function act(action: "exclude" | "restore") {
    const res = await fetch(`/api/contacts/${id}/${action}`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? "That did not work. Try again.");
      return;
    }
    setConfirming(false);
    start(() => router.refresh());
  }

  if (excluded) {
    return (
      <button
        onClick={() => act("restore")}
        disabled={pending}
        className="btn-quiet btn-sm"
        title={`${email} is on the suppression list`}
      >
        {pending ? "Working" : "Restore"}
      </button>
    );
  }

  if (confirming) {
    return (
      <span className="inline-flex gap-1.5">
        <button onClick={() => act("exclude")} disabled={pending} className="btn-danger btn-sm">
          {pending ? "Working" : "Confirm"}
        </button>
        <button onClick={() => setConfirming(false)} className="btn-quiet btn-sm">
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button onClick={() => setConfirming(true)} className="btn-danger btn-sm">
      Exclude
    </button>
  );
}
