import { cn } from "@/presentation/components/ui/utils";

const tones = {
  cyan: "bg-tint/12 text-tint-text",
  green: "bg-positive-fill/15 text-positive",
  amber: "bg-warning-fill/16 text-warning",
  rose: "bg-negative-fill/12 text-negative",
  slate: "bg-fill-strong text-label-secondary",
  indigo: "bg-indigo-fill/14 text-indigo",
};

const dots: Record<keyof typeof tones, string> = {
  cyan: "bg-tint",
  green: "bg-positive-fill",
  amber: "bg-warning-fill",
  rose: "bg-negative-fill",
  slate: "bg-label-quaternary",
  indigo: "bg-indigo-fill",
};

export type BadgeTone = keyof typeof tones;

export function Badge({
  children,
  tone = "slate",
  dot = false,
  className,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-[3px] text-xs font-semibold leading-4 tracking-[-0.005em]",
        tones[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dots[tone])} /> : null}
      {children}
    </span>
  );
}

export function statusTone(status: string): BadgeTone {
  if (["healthy", "success", "connected"].includes(status)) return "green";
  if (["demo", "running", "info"].includes(status)) return "cyan";
  if (["needs_credentials", "warning", "queued", "skipped"].includes(status)) return "amber";
  if (["error", "disabled"].includes(status)) return "rose";
  return "slate";
}
