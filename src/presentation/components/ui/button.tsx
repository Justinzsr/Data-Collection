import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/presentation/components/ui/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "border-cyan-300/40 bg-cyan-300/14 text-cyan-50 shadow-[0_0_24px_rgba(56,189,248,0.12)] hover:bg-cyan-300/20",
  secondary: "border-slate-300/15 bg-slate-900/70 text-slate-100 hover:bg-slate-800/85",
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
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-cyan-300/40 disabled:cursor-not-allowed disabled:opacity-55",
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
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; variant?: Variant; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-cyan-300/40",
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}
