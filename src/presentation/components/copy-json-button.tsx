"use client";

import { Clipboard } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/presentation/components/ui/button";

export function CopyJsonButton({ value }: { value: unknown }) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="min-h-8 px-2 py-1 text-xs"
      onClick={async () => {
        await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
        toast.success("Copied safe row JSON");
      }}
    >
      <Clipboard className="h-3.5 w-3.5" />
      Copy JSON
    </Button>
  );
}
