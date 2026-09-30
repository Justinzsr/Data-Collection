import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/presentation/components/ui/utils";

type Variant = "primary" | "secondary" | "tinted" | "ghost" | "danger";

const base =
  "inline-flex min-h-10 select-none items-center justify-center gap-2 rounded-full text-center px-4 py-2 text-[13px] font-medium tracking-[-0.005em] transition duration-200 ease-out focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-tint/30 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100";

const variants: Record<Variant, string> = {
  primary:
    "bg-tint font-semibold text-on-tint shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_6px_18px_-8px_var(--tint)] hover:bg-tint-hover",
  secondary: "glass-control text-label hover:bg-glass-strong",
  tinted: "bg-tint/12 font-semibold text-tint-text hover:bg-tint/18",
  ghost: "text-tint-text hover:bg-fill-hover",
  danger: "bg-negative-fill/12 text-negative hover:bg-negative-fill/18",
};

export function buttonClassName(variant: Variant = "secondary", className?: string) {
  return cn(base, variants[variant], className);
}

export function Button({
  className,
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        base,
        variants[variant],
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
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
      className={cn(base, variants[variant], className)}
      {...props}
    >
      {children}
    </Link>
  );
}
