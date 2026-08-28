"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, Pill } from "./ui";

interface Props {
  template?: { id: number; name: string; subject: string; htmlBody: string; textBody: string };
  sender: { from_name: string; from_email: string; reply_to: string; postal_address: string };
}

const STARTER_HTML = `<p>Hi {{first_name}},</p>

<p>I run a small video and photography team in Dubai that works with real
estate brokers on listing content.</p>

<p>Two things we do: short-form reels for Instagram and TikTok, and
photography for listings.</p>

<p>If that is useful to {{company}}, reply and I will send a few examples
and prices.</p>

<p>Jerome<br>Azkal Media</p>`;

export function TemplateEditor({ template, sender }: Props) {
  const [name, setName] = useState(template?.name ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [htmlBody, setHtmlBody] = useState(template?.htmlBody ?? STARTER_HTML);
  const [textBody, setTextBody] = useState(template?.textBody ?? "");
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [preview, setPreview] = useState<{
    subject: string; html: string; text: string; missing: string[];
    recipient: string; problems: string[]; fields: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const loadPreview = useCallback(async () => {
    const res = await fetch("/api/templates/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, htmlBody, textBody }),
    });
    if (res.ok) setPreview(await res.json());
  }, [subject, htmlBody, textBody]);

  useEffect(() => {
    if (tab !== "preview") return;
    const t = setTimeout(loadPreview, 250);
    return () => clearTimeout(t);
  }, [tab, loadPreview]);

  async function save() {
    setBusy(true); setError(null);
    const res = await fetch(
      template ? `/api/templates/${template.id}` : "/api/templates",
      {
        method: template ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, subject, htmlBody, textBody }),
      }
    );
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      router.push("/templates");
      router.refresh();
    } else {
      setError(body.error ?? "Could not save.");
    }
  }

  const noPostal = !sender.postal_address.trim();

  return (
    <div className="space-y-6">
      {noPostal && (
        <div className="surface p-4 border-amber-200 bg-amber-50/50">
          <div className="text-[14px] text-ink">
            No postal address set. Campaigns cannot send without one, since it is
            required in the footer.{" "}
            <a href="/settings" className="text-accent hover:underline">Add it in Settings</a>.
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {(["write", "preview"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`btn ${tab === t ? "bg-accent text-white" : "btn-quiet"}`}
          >
            {t === "write" ? "Write" : "Preview"}
          </button>
        ))}
      </div>

      {tab === "write" ? (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-6">
            <Card title="Message">
              <div className="space-y-4">
                <div>
                  <label className="label block mb-1.5">Template name</label>
                  <input
                    className="input" placeholder="Reels and Photography, campaign 1"
                    value={name} onChange={(e) => setName(e.target.value)}
                  />
                  <p className="text-[12.5px] text-ink-faint mt-1.5">
                    Internal only. Recipients never see this.
                  </p>
                </div>

                <div>
                  <label className="label block mb-1.5">Subject line</label>
                  <input
                    className="input" placeholder="Listing content for {{company}}"
                    value={subject} onChange={(e) => setSubject(e.target.value)}
                  />
                  <p className="text-[12.5px] text-ink-faint mt-1.5">
                    {subject.length} characters.{" "}
                    {subject.length > 60 && "Most inboxes cut off around 60."}
                  </p>
                </div>

                <div>
                  <label className="label block mb-1.5">Body</label>
                  <textarea
                    className="input h-auto py-3 font-mono text-[13px] leading-relaxed"
                    rows={18} value={htmlBody}
                    onChange={(e) => setHtmlBody(e.target.value)}
                  />
                  <p className="text-[12.5px] text-ink-faint mt-1.5">
                    Simple HTML. Wrap paragraphs in &lt;p&gt;. The unsubscribe footer
                    is added automatically.
                  </p>
                </div>

                <details>
                  <summary className="text-[13.5px] text-ink-muted cursor-pointer hover:text-ink">
                    Plain text version (optional)
                  </summary>
                  <textarea
                    className="input h-auto py-3 font-mono text-[13px] mt-3"
                    rows={10} placeholder="Leave empty and one will be generated from the HTML."
                    value={textBody} onChange={(e) => setTextBody(e.target.value)}
                  />
                </details>
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            <Card title="Merge fields">
              <p className="text-[13.5px] text-ink-muted mb-3">
                Click to copy. If a contact has no value for a field, that message
                is held back rather than sent with a gap in it.
              </p>
              <div className="space-y-2">
                {[
                  ["{{first_name}}", "Ahmed"],
                  ["{{company}}", "Prime Properties"],
                  ["{{office_name}}", "Prime Properties"],
                  ["{{email}}", "ahmed@primeproperties.ae"],
                ].map(([field, example]) => (
                  <button
                    key={field}
                    onClick={() => navigator.clipboard?.writeText(field)}
                    className="w-full text-left px-3 py-2 rounded-control bg-page hover:bg-accent-soft transition-colors"
                  >
                    <code className="text-[13px] text-accent">{field}</code>
                    <div className="text-[12px] text-ink-faint mt-0.5">{example}</div>
                  </button>
                ))}
              </div>
            </Card>

            <Card title="Sender">
              <dl className="space-y-2.5 text-[13.5px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">From</dt>
                  <dd className="text-ink text-right">
                    {sender.from_name}<br />
                    <span className="text-ink-muted text-[12.5px]">
                      {sender.from_email || "not set"}
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Reply-To</dt>
                  <dd className="text-ink text-right text-[12.5px]">
                    {sender.reply_to || "not set"}
                  </dd>
                </div>
              </dl>
              <a href="/settings" className="btn-quiet btn-sm w-full mt-4">Change</a>
            </Card>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2">
            <Card
              title="Preview"
              sub={preview ? `Rendered for ${preview.recipient}` : "Loading"}
              action={<button onClick={loadPreview} className="btn-quiet btn-sm">
                Different contact
              </button>}
            >
              {preview ? (
                <>
                  <div className="border border-line rounded-control overflow-hidden">
                    <div className="px-4 py-3 bg-page border-b border-line">
                      <div className="text-[12px] text-ink-faint">
                        From {sender.from_name} &lt;{sender.from_email || "not set"}&gt;
                      </div>
                      <div className="text-[15px] font-semibold text-ink mt-1">
                        {preview.subject || <span className="text-ink-faint">No subject</span>}
                      </div>
                    </div>
                    <div
                      className="px-5 py-4 text-[14px] leading-relaxed [&_p]:mb-3 [&_a]:text-accent"
                      dangerouslySetInnerHTML={{ __html: preview.html }}
                    />
                  </div>

                  <details className="mt-4">
                    <summary className="text-[13.5px] text-ink-muted cursor-pointer hover:text-ink">
                      Plain text version
                    </summary>
                    <pre className="mt-3 p-4 bg-page rounded-control text-[12.5px] whitespace-pre-wrap font-mono text-ink-soft">
                      {preview.text}
                    </pre>
                  </details>
                </>
              ) : (
                <div className="py-16 text-center text-[14px] text-ink-faint">Rendering</div>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card title="Checks">
              {!preview ? (
                <div className="text-[14px] text-ink-faint">Waiting</div>
              ) : preview.problems.length === 0 && preview.missing.length === 0 ? (
                <div className="text-[14px] text-good">Nothing flagged.</div>
              ) : (
                <ul className="space-y-2.5 text-[13.5px]">
                  {preview.missing.length > 0 && (
                    <li className="text-warn">
                      This contact has no value for:{" "}
                      {preview.missing.map((m) => `{{${m}}}`).join(", ")}. Contacts
                      missing a required field are held back, not sent with a gap.
                    </li>
                  )}
                  {preview.problems.map((p, i) => (
                    <li key={i} className="text-ink-soft">{p}</li>
                  ))}
                </ul>
              )}
            </Card>

            {preview && preview.fields.length > 0 && (
              <Card title="Fields used">
                <div className="flex flex-wrap gap-1.5">
                  {preview.fields.map((f) => <Pill key={f} tone="accent">{`{{${f}}}`}</Pill>)}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="text-[13.5px] text-bad bg-red-50 border border-red-100 rounded-control px-3 py-2.5">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={save} disabled={busy || !name || !subject} className="btn-primary">
          {busy ? "Saving" : template ? "Save changes" : "Create template"}
        </button>
        <a href="/templates" className="btn-quiet">Cancel</a>
      </div>
    </div>
  );
}
