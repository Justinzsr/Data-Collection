import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/presentation/components/ui/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "border-cyan-200/25 bg-cyan-200 text-slate-950 shadow-[0_8px_24px_rgba(68,166,207,0.14)] hover:bg-cyan-100",
  secondary: "border-slate-300/12 bg-white/[0.045] text-slate-100 hover:border-slate-300/20 hover:bg-white/[0.075]",
  ghost: "border-transparent bg-transparent text-slate-300 hover:bg-white/6 hover:text-white",
  danger: "border-rose-300/25 bg-rose-500/12 text-rose-100 hover:bg-rose-500/18",
};

export function Button({
  className,
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-cyan-300/40 disabled:cursor-not-allowed disabled:opacity-55",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function LinkButton({
  className,
  variant = "secondary",
  href,
  children,
  prefetch,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: Variant;
  children: ReactNode;
  prefetch?: boolean | "auto" | null;
}) {
  const resolvedPrefetch = prefetch !== undefined
    ? prefetch
    : href.startsWith("/api/")
      ? false
      : undefined;

  return (
    <Link
      href={href}
      prefetch={resolvedPrefetch}
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-cyan-300/40",
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}
