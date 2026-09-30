import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/presentation/components/ui/utils";

export function GlassPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("glass min-w-0 rounded-3xl", className)} {...props} />;
}

/** Page header: an Apple-style large title with an optional eyebrow and actions. */
export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-4 px-1 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
        <h1 className="text-[28px] font-bold leading-[1.15] tracking-[-0.028em] text-label sm:text-[34px]">{title}</h1>
        {description ? <p className="mt-2 max-w-3xl text-[14px] leading-6 text-label-secondary">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

/** In-page section heading that sits directly on the canvas above a group of cards. */
export function SectionTitle({
  eyebrow,
  title,
  id,
  action,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  id?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2 px-1 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 id={id} className="mt-0.5 text-[20px] font-semibold tracking-[-0.022em] text-label">
          {title}
        </h2>
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Label/value tile used inside glass cards. */
export function StatTile({
  label,
  value,
  detail,
  tone = "default",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "default" | "warning";
  className?: string;
}) {
  return (
    <div className={cn("inset-surface min-w-0 p-3", className)}>
      <p className="break-words text-xs font-medium text-muted">{label}</p>
      <p
        className={cn(
          "mt-1 break-words font-semibold tracking-[-0.02em]",
          tone === "warning" ? "text-sm leading-5 text-warning" : "text-[22px] leading-7 text-label",
        )}
      >
        {value}
      </p>
      {detail ? <p className="mt-1 break-words text-xs leading-4 text-muted">{detail}</p> : null}
    </div>
  );
}

/** Tinted inline notice (Apple-style callout). */
export function Callout({
  tone = "info",
  title,
  children,
  icon,
  className,
  role,
}: {
  tone?: "info" | "warning" | "danger" | "success" | "neutral";
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  className?: string;
  role?: string;
}) {
  const tones = {
    info: "bg-tint/8 text-label-secondary [--callout-accent:var(--tint-text)]",
    warning: "bg-warning-fill/10 text-label-secondary [--callout-accent:var(--warning)]",
    danger: "bg-negative-fill/9 text-label-secondary [--callout-accent:var(--negative)]",
    success: "bg-positive-fill/10 text-label-secondary [--callout-accent:var(--positive)]",
    neutral: "bg-fill text-label-secondary [--callout-accent:var(--label)]",
  } as const;
  return (
    <div className={cn("flex min-w-0 gap-3 rounded-2xl p-3.5 text-sm leading-6", tones[tone], className)} role={role}>
      {icon ? <span className="mt-0.5 shrink-0 text-[var(--callout-accent)]">{icon}</span> : null}
      <div className="min-w-0">
        {title ? <p className="font-semibold text-[var(--callout-accent)]">{title}</p> : null}
        {children ? <div className={cn("min-w-0 break-words", title ? "mt-0.5" : undefined)}>{children}</div> : null}
      </div>
    </div>
  );
}
