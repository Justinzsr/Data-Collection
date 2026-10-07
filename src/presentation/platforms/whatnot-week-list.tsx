"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RotateCw, TriangleAlert } from "lucide-react";
import type { WhatnotWeekStatus } from "@/aggregation/services/platform-overview-service";
import { Badge, type BadgeTone } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";

export type WhatnotWeekItem = {
  reportWeek: string;
  /** "Sep 21 – Sep 27": Monday to Sunday (UTC). */
  label: string;
  status: WhatnotWeekStatus;
};

type WeekAction = "no_sales" | "remove";

const STATUS: Record<WhatnotWeekStatus, { label: string; tone: BadgeTone }> = {
  imported: { label: "Imported", tone: "green" },
  no_sales: { label: "No sales", tone: "slate" },
  missing: { label: "Missing", tone: "amber" },
  ready: { label: "Ready to import", tone: "amber" },
};

const CONFIRM: Record<WeekAction, { question: string; confirm: string; cancel: string }> = {
  no_sales: { question: "Record this week as having no sales?", confirm: "Record no sales", cancel: "Cancel" },
  remove: { question: "Remove this week's numbers?", confirm: "Remove week", cancel: "Keep" },
};

const VISIBLE_WEEKS = 8;

type Result = { tone: "done" | "failed"; message: string } | null;

/**
 * Report weeks newest first, each with what can be done about it: a missing or
 * newly published week can be recorded as having no sales (Whatnot has no rows to
 * put in such a report), and an imported week can be removed. Both ask first, with
 * focus on the choice that changes nothing, and both go through the import route
 * and the shared sync engine.
 */
export function WhatnotWeekList({
  weeks,
  sourceId,
  dataSpaceSlug,
}: {
  weeks: WhatnotWeekItem[];
  sourceId: string;
  dataSpaceSlug: string;
}) {
  const router = useRouter();
  const statusId = useId();
  const promptId = useId();
  const [showAll, setShowAll] = useState(false);
  const [confirming, setConfirming] = useState<{ reportWeek: string; action: WeekAction } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(null);
  /** The week whose action button gets focus back when its confirmation is cancelled. */
  const returnFocusTo = useRef<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const visible = showAll ? weeks : weeks.slice(0, VISIBLE_WEEKS);
  const hidden = weeks.length - visible.length;

  useEffect(() => {
    if (confirming) {
      cancelRef.current?.focus();
      return;
    }
    const week = returnFocusTo.current;
    returnFocusTo.current = null;
    if (week) triggers.current.get(week)?.focus();
  }, [confirming]);

  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  function cancel(week: WhatnotWeekItem) {
    returnFocusTo.current = week.reportWeek;
    setConfirming(null);
  }

  async function apply(week: WhatnotWeekItem, action: WeekAction) {
    if (pending) return;
    setPending(week.reportWeek);
    setConfirming(null);
    setResult(null);
    try {
      const response = await fetch(
        `/api/sources/${encodeURIComponent(sourceId)}/import?dataSpaceSlug=${encodeURIComponent(dataSpaceSlug)}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, reportWeek: week.reportWeek }) },
      );
      const body = await response.json().catch(() => ({})) as { ok?: boolean; error?: string | null };
      if (!response.ok || !body.ok) {
        setResult({ tone: "failed", message: body.error || "The change did not finish. Try again." });
        return;
      }
      setResult({
        tone: "done",
        message: action === "no_sales"
          ? `Recorded the week of ${week.label} as having no sales.`
          : `Removed the week of ${week.label}.`,
      });
      router.refresh();
    } catch {
      setResult({ tone: "failed", message: "The change did not reach the server. Check your connection and try again." });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid min-w-0 gap-3" data-testid="whatnot-weeks">
      {weeks.length === 0 ? (
        <p className="px-4 pt-4 text-sm text-label-secondary sm:px-5">Weeks appear here once you import a report.</p>
      ) : (
        <ul className="min-w-0 divide-y divide-separator">
          {visible.map((week) => {
            const status = STATUS[week.status];
            const busy = pending === week.reportWeek;
            const action: WeekAction = week.status === "imported" || week.status === "no_sales" ? "remove" : "no_sales";
            const asking = confirming?.reportWeek === week.reportWeek ? CONFIRM[confirming.action] : null;
            return (
              <li
                key={week.reportWeek}
                className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-5"
                data-week={week.reportWeek}
                data-status={week.status}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="tabular text-sm font-semibold text-label">{week.label}</span>
                  <Badge tone={status.tone} dot>{status.label}</Badge>
                </div>
                {asking && confirming ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-2" role="group" aria-label={`Confirm for the week of ${week.label}`}>
                    <span id={promptId} className="text-xs text-label-secondary">{asking.question}</span>
                    <Button
                      type="button"
                      variant={confirming.action === "remove" ? "danger" : "primary"}
                      className="min-h-9 px-3"
                      onClick={() => apply(week, confirming.action)}
                      aria-label={`${asking.confirm}: ${week.label}`}
                      aria-describedby={promptId}
                    >
                      {asking.confirm}
                    </Button>
                    <Button
                      ref={cancelRef}
                      type="button"
                      variant="ghost"
                      className="min-h-9 px-3"
                      onClick={() => cancel(week)}
                      aria-label={`${asking.cancel}: ${week.label}`}
                      aria-describedby={promptId}
                    >
                      {asking.cancel}
                    </Button>
                  </div>
                ) : (
                  <Button
                    ref={(element) => {
                      if (element) triggers.current.set(week.reportWeek, element);
                      else triggers.current.delete(week.reportWeek);
                    }}
                    type="button"
                    variant={action === "remove" ? "ghost" : "secondary"}
                    className="min-h-9 shrink-0 px-3"
                    onClick={() => setConfirming({ reportWeek: week.reportWeek, action })}
                    disabled={Boolean(pending)}
                    aria-label={action === "remove" ? `Remove the week of ${week.label}` : `No sales that week: ${week.label}`}
                  >
                    {busy ? <RotateCw className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                    {action === "remove" ? "Remove" : "No sales that week"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {hidden > 0 || showAll ? (
        <div className="px-4 sm:px-5">
          <Button type="button" variant="ghost" className="min-h-9 px-3" onClick={() => setShowAll((value) => !value)} aria-expanded={showAll}>
            {showAll ? "Show fewer weeks" : `Show ${hidden} older week${hidden === 1 ? "" : "s"}`}
          </Button>
        </div>
      ) : null}
      {/* Always rendered, so screen readers announce the result when it appears; focus moves to it after a change. */}
      <div id={statusId} role="status" aria-live="polite" className="min-w-0 px-4 sm:px-5">
        {result ? (
          <p
            ref={resultRef}
            tabIndex={-1}
            className={`mb-4 flex items-start gap-2 rounded-2xl px-3.5 py-3 text-sm leading-6 text-label outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30 ${result.tone === "done" ? "bg-positive-fill/10" : "bg-negative-fill/9"}`}
          >
            {result.tone === "done"
              ? <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-positive" aria-hidden="true" />
              : <TriangleAlert className="mt-1 h-4 w-4 shrink-0 text-negative" aria-hidden="true" />}
            {result.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
