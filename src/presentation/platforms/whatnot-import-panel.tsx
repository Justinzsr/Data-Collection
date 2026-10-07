"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileUp, RotateCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/presentation/components/ui/button";

type ImportResult =
  | { state: "idle" }
  | { state: "importing"; fileName: string }
  | { state: "done"; message: string }
  | { state: "failed"; message: string };

type ImportResponse = {
  ok?: boolean;
  error?: string | null;
  import?: { reportWeek?: string; transactions?: number; skippedRows?: number; duplicateRows?: number };
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayLabel(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** "Sep 28 – Oct 4": Monday to Sunday (UTC) of a report week. */
function weekLabel(reportWeek: string) {
  const [year, month, day] = reportWeek.split("-").map(Number);
  if (!year || !month || !day) return reportWeek;
  return `${dayLabel(year, month, day)} – ${dayLabel(year, month, day + 6)}`;
}

function plural(count: number, one: string, many: string) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

function successMessage(body: ImportResponse) {
  const { reportWeek, transactions = 0, skippedRows = 0, duplicateRows = 0 } = body.import ?? {};
  const parts = [`Imported ${plural(transactions, "transaction", "transactions")}${reportWeek ? ` for the week of ${weekLabel(reportWeek)}` : ""}.`];
  if (skippedRows > 0) {
    parts.push(`${plural(skippedRows, "row was", "rows were")} left out because ${skippedRows === 1 ? "it has" : "they have"} no Ledger Transaction ID, completion time, or amount.`);
  }
  if (duplicateRows > 0) parts.push(`${plural(duplicateRows, "repeated transaction was", "repeated transactions were")} counted once.`);
  return parts.join(" ");
}

/**
 * Uploads Whatnot's Weekly Orders Report. The server validates the file, drops
 * buyer details, and imports it through the shared sync engine; re-uploading a
 * week replaces that week instead of adding to it.
 */
export function WhatnotImportPanel({
  sourceId,
  dataSpaceSlug,
  compact = false,
}: {
  sourceId: string;
  dataSpaceSlug: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const inputId = useId();
  const statusId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ImportResult>({ state: "idle" });
  const importing = result.state === "importing";

  function choose(next: File | null) {
    setFile(next);
    setResult({ state: "idle" });
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files?.[0] ?? null;
    if (dropped) choose(dropped);
  }

  async function upload() {
    if (!file || importing) return;
    setResult({ state: "importing", fileName: file.name });
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(
        `/api/sources/${encodeURIComponent(sourceId)}/import?dataSpaceSlug=${encodeURIComponent(dataSpaceSlug)}`,
        { method: "POST", body: form },
      );
      const body = await response.json().catch(() => ({})) as ImportResponse;
      if (!response.ok || !body.ok) {
        setResult({ state: "failed", message: body.error || "The import did not finish. Try again." });
        return;
      }
      setResult({ state: "done", message: successMessage(body) });
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch {
      setResult({ state: "failed", message: "The upload did not reach the server. Check your connection and try again." });
    }
  }

  return (
    <div className="grid min-w-0 gap-4" data-testid="whatnot-import">
      {compact ? null : (
        <ol className="grid gap-1.5 text-sm leading-6 text-label-secondary">
          <li>1. On whatnot.com, open your profile menu, then Financials → Statements.</li>
          <li>2. Download the latest week. Whatnot publishes each report at 06:00 UTC on Monday (Sunday night in Pacific Time), covering Monday to Sunday in UTC.</li>
          <li>3. Upload the CSV here as downloaded, without opening and saving it in a spreadsheet app first. Importing a week again replaces it, so nothing is counted twice.</li>
        </ol>
      )}

      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex min-h-24 min-w-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[20px] border border-dashed px-4 py-5 text-center transition has-[input:focus-visible]:ring-4 has-[input:focus-visible]:ring-tint/30 ${
          dragging ? "border-tint bg-tint/8" : "border-separator bg-fill hover:bg-fill-hover"
        }`}
      >
        <FileUp className="h-5 w-5 text-tint-text" aria-hidden="true" />
        <span className="max-w-full truncate text-sm font-semibold text-label">
          {file ? file.name : "Choose the Weekly Orders Report CSV"}
        </span>
        <span className="text-xs text-label-secondary">{file ? `${Math.max(1, Math.round(file.size / 1024))} KB` : "or drop it here"}</span>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-describedby={statusId}
          onChange={(event) => choose(event.target.files?.[0] ?? null)}
        />
      </label>

      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex min-w-0 items-start gap-2 text-xs leading-5 text-label-secondary">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-positive" aria-hidden="true" />
          Buyer names and locations are removed before anything is saved.
        </p>
        <Button type="button" variant="primary" onClick={upload} disabled={!file || importing} className="min-h-11 shrink-0 sm:min-h-10">
          {importing ? <RotateCw className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <FileUp className="h-4 w-4" aria-hidden="true" />}
          {importing ? "Importing…" : "Import report"}
        </Button>
      </div>

      <div id={statusId} role="status" aria-live="polite" className="min-w-0">
        {result.state === "done" ? (
          <p className="flex items-start gap-2 rounded-2xl bg-positive-fill/10 px-3.5 py-3 text-sm leading-6 text-label">
            <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-positive" aria-hidden="true" />
            {result.message}
          </p>
        ) : null}
        {result.state === "failed" ? (
          <p className="flex items-start gap-2 rounded-2xl bg-negative-fill/9 px-3.5 py-3 text-sm leading-6 text-label">
            <TriangleAlert className="mt-1 h-4 w-4 shrink-0 text-negative" aria-hidden="true" />
            {result.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
