"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
  scope: "both" | "broker" | "agency";
}

const FIELDS: FieldDef[] = [
  { key: "email", label: "Email", required: true, scope: "both" },
  { key: "name_en", label: "Name (English)", scope: "both" },
  { key: "name_ar", label: "Name (Arabic)", scope: "both" },
  { key: "broker_number", label: "Broker number", scope: "broker" },
  { key: "office_name_en", label: "Office name (English)", scope: "broker" },
  { key: "office_name_ar", label: "Office name (Arabic)", scope: "broker" },
  { key: "office_number", label: "Office number", scope: "agency" },
  { key: "website", label: "Website", scope: "agency" },
  { key: "phone", label: "Phone", scope: "both" },
];

type Step = "pick" | "map" | "running" | "done";

interface Analysis {
  batchId: number;
  headers: string[];
  encoding: string;
  suggested: Record<string, string>;
  preview: Record<string, string>[];
}

interface Summary {
  totalRows: number; uniqueEmails: number; newEmails: number;
  existingEmails: number; invalidRows: number; blankEmailRows: number;
}

export function ImportWizard() {
  const [step, setStep] = useState<Step>("pick");
  const [sourceType, setSourceType] = useState<"broker" | "agency">("broker");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("sourceType", sourceType);

    const res = await fetch("/api/import/upload", { method: "POST", body: fd });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(body.error ?? "Upload failed.");
      return;
    }
    setAnalysis(body);
    setMap(body.suggested);
    setStep("map");
  }

  async function run() {
    if (!analysis) return;
    if (!map.email) {
      setError("Pick which column holds the email address before continuing.");
      return;
    }
    setStep("running");
    setError(null);

    const res = await fetch(`/api/import/${analysis.batchId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnMap: map }),
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(body.error ?? "The import failed.");
      setStep("map");
      return;
    }
    setSummary(body.summary);
    setStep("done");
    router.refresh();
  }

  function reset() {
    setStep("pick");
    setAnalysis(null);
    setMap({});
    setSummary(null);
    setError(null);
  }

  const visibleFields = FIELDS.filter(
    (f) => f.scope === "both" || f.scope === sourceType
  );

  return (
    <div className="surface p-6">
      {error && (
        <div className="text-[13.5px] text-bad bg-red-50 border border-red-100 rounded-control px-3 py-2.5 mb-5">
          {error}
        </div>
      )}

      {step === "pick" && (
        <>
          <div className="mb-5">
            <label className="label block mb-2">What is in this file?</label>
            <div className="flex gap-2">
              {(["broker", "agency"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setSourceType(t)}
                  className={`btn ${
                    sourceType === t
                      ? "bg-accent text-white"
                      : "bg-card border border-line text-ink-soft hover:bg-page"
                  }`}
                >
                  {t === "broker" ? "Brokers" : "Real estate agencies"}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <div className="border-2 border-dashed border-line rounded-card px-6 py-12 text-center hover:border-accent hover:bg-accent-soft/30 transition-colors cursor-pointer">
              <div className="text-[15px] font-medium text-ink">
                {busy ? "Reading the file" : "Choose a CSV file"}
              </div>
              <div className="text-[13.5px] text-ink-muted mt-1.5">
                Arabic columns are handled. Encoding is detected automatically.
              </div>
            </div>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
            />
          </label>
        </>
      )}

      {step === "map" && analysis && (
        <>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[16px] font-semibold text-ink">Check the column mapping</div>
            <button onClick={reset} className="btn-quiet btn-sm">Start over</button>
          </div>
          <p className="text-[13.5px] text-ink-muted mb-5">
            Detected {analysis.headers.length} columns, decoded as {analysis.encoding}.
            Anything left unmapped is simply not imported.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {visibleFields.map((f) => (
              <div key={f.key}>
                <label className="label block mb-1.5">
                  {f.label}
                  {f.required && <span className="text-bad ml-1">*</span>}
                </label>
                <select
                  className="input"
                  value={map[f.key] ?? ""}
                  onChange={(e) => setMap({ ...map, [f.key]: e.target.value })}
                >
                  <option value="">Not imported</option>
                  {analysis.headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {analysis.preview.length > 0 && map.email && (
            <div className="mb-6">
              <div className="label mb-2">First rows, as they will be read</div>
              <div className="border border-line rounded-control overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr>
                      {visibleFields
                        .filter((f) => map[f.key])
                        .map((f) => <th key={f.key} className="th">{f.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.preview.slice(0, 3).map((row, i) => (
                      <tr key={i}>
                        {visibleFields
                          .filter((f) => map[f.key])
                          .map((f) => (
                            <td
                              key={f.key}
                              className="td"
                              dir={f.key.endsWith("_ar") ? "rtl" : undefined}
                            >
                              {row[map[f.key]] || (
                                <span className="text-ink-faint">empty</span>
                              )}
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <button onClick={run} className="btn-primary">Import this file</button>
        </>
      )}

      {step === "running" && (
        <div className="py-12 text-center">
          <div className="text-[15px] font-medium text-ink">Importing</div>
          <p className="text-[13.5px] text-ink-muted mt-2">
            Normalising addresses, resolving duplicates and linking records.
            A 34,000 row file takes a couple of minutes. Leave this tab open.
          </p>
          <div className="h-1.5 bg-accent-track rounded-full mt-6 max-w-xs mx-auto overflow-hidden">
            <div className="h-full w-1/3 bg-accent rounded-full animate-pulse" />
          </div>
        </div>
      )}

      {step === "done" && summary && (
        <>
          <div className="text-[16px] font-semibold text-ink mb-1">Import finished</div>
          <p className="text-[13.5px] text-ink-muted mb-5">
            Every row is accounted for below.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            {[
              ["Rows in file", summary.totalRows, ""],
              ["Unique addresses", summary.uniqueEmails, ""],
              ["New contacts", summary.newEmails, "text-good"],
              ["Already known", summary.existingEmails, ""],
              ["Invalid format", summary.invalidRows, "text-warn"],
              ["No email in row", summary.blankEmailRows, "text-warn"],
            ].map(([label, value, tone]) => (
              <div key={String(label)} className="bg-page rounded-control px-4 py-3">
                <div className="text-[12.5px] text-ink-muted">{label}</div>
                <div className={`text-[20px] font-bold mt-0.5 ${tone || "text-ink"}`}>
                  {Number(value).toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button onClick={reset} className="btn-primary">Import another file</button>
            <a href="/contacts" className="btn-quiet">View contacts</a>
          </div>
        </>
      )}
    </div>
  );
}
