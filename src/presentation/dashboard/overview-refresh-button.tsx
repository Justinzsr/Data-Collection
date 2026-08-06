"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/presentation/components/ui/button";

export function OverviewRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="secondary"
      className="min-h-11 px-3"
      disabled={pending}
      aria-live="polite"
      onClick={() => startTransition(() => router.refresh())}
    >
      <RefreshCw
        className={`h-4 w-4 ${pending ? "animate-spin motion-reduce:animate-none" : ""}`}
        aria-hidden="true"
      />
      {pending ? "Refreshing…" : "Refresh"}
    </Button>
  );
}
