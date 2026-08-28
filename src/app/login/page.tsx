"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError(body.error ?? "Sign-in failed.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-[380px]">
        <div className="text-center mb-8">
          <div className="text-[30px] font-bold tracking-tight text-ink">
            azkal<span className="text-accent">.</span>
          </div>
          <div className="text-[10px] tracking-[0.22em] text-ink-faint mt-1.5 font-medium">
            EMAIL PLATFORM
          </div>
        </div>

        <form onSubmit={submit} className="surface p-6 space-y-4">
          <div>
            <label className="label block mb-1.5">Email</label>
            <input
              className="input" type="email" autoComplete="username" required
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label block mb-1.5">Password</label>
            <input
              className="input" type="password" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <div className="text-[13.5px] text-bad bg-red-50 border border-red-100 rounded-control px-3 py-2.5">
              {error}
            </div>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? "Signing in" : "Sign in"}
          </button>
        </form>

        <p className="text-[12.5px] text-ink-faint text-center mt-5">
          Internal tool. Access is restricted.
        </p>
      </div>
    </div>
  );
}
