"use client";

import { useEffect } from "react";
import { Toaster } from "sonner";
import { syncStoredTheme, useResolvedTheme } from "@/presentation/theme/theme-store";

export function Providers({ children }: { children: React.ReactNode }) {
  const theme = useResolvedTheme();
  useEffect(() => {
    syncStoredTheme();
  }, []);
  return (
    <>
      {children}
      <Toaster theme={theme} position="top-right" offset={{ top: 72, right: 20 }} mobileOffset={{ top: 72 }} gap={10} />
    </>
  );
}
