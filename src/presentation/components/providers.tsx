"use client";

import { Toaster } from "sonner";
import { useResolvedTheme } from "@/presentation/theme/theme-store";

export function Providers({ children }: { children: React.ReactNode }) {
  const theme = useResolvedTheme();
  return (
    <>
      {children}
      <Toaster theme={theme} position="top-right" offset={{ top: 72, right: 20 }} mobileOffset={{ top: 72 }} gap={10} />
    </>
  );
}
