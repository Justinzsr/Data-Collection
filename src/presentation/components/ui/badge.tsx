import { cn } from "@/presentation/components/ui/utils";

const tones = {
  cyan: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
  green: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
  amber: "border-amber-300/25 bg-amber-400/10 text-amber-100",
  rose: "border-rose-300/25 bg-rose-400/10 text-rose-100",
  slate: "border-slate-300/15 bg-slate-400/10 text-slate-200",
  indigo: "border-indigo-300/25 bg-indigo-400/10 text-indigo-100",
};

export function Badge({
  children,
  tone = "slate",
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof tones;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

export function statusTone(status: string): keyof typeof tones {
  if (["healthy", "success", "connected"].includes(status)) return "green";
  if (["demo", "running"].includes(status)) return "cyan";
  if (["needs_credentials", "warning", "queued", "skipped"].includes(status)) return "amber";
  if (["error", "disabled"].includes(status)) return "rose";
  return "slate";
}
