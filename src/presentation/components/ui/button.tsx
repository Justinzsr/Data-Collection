import Link from "next/link";
import type { AnchorHTMLAttributes, ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/presentation/components/ui/utils";

type Variant = "primary" | "secondary" | "tinted" | "ghost" | "danger";

const base =
  "inline-flex min-h-10 select-none items-center justify-center gap-2 rounded-full text-center px-4 py-2 text-[13px] font-medium tracking-[-0.005em] transition duration-200 ease-out focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100";

const variants: Record<Variant, string> = {
  primary:
    "bg-tint font-semibold text-on-tint shadow-(--tint-shadow) hover:bg-tint-hover",
  secondary: "glass-control text-label hover:bg-glass-strong",
  tinted: "bg-tint/12 font-semibold text-tint-text hover:bg-tint/18",
  ghost: "text-tint-text hover:bg-fill-hover",
  danger: "bg-negative-fill/12 text-negative hover:bg-negative-fill/18",
};

export function Button({
  className,
  variant = "secondary",
  ...props
}: ComponentPropsWithRef<"button"> & { variant?: Variant }) {
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
  // API actions such as OAuth starts answer with cross-origin redirects, so they must be
  // real page navigations: no prefetch and no client-side (RSC) navigation attempt.
  if (prefetch === undefined && href.startsWith("/api/")) {
    return (
      <a href={href} className={cn(base, variants[variant], className)} {...props}>
        {children}
      </a>
    );
  }

  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={cn(base, variants[variant], className)}
      {...props}
    >
      {children}
    </Link>
  );
}
