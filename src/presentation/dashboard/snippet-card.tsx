"use client";

import { useState } from "react";
import { Check, Clipboard } from "lucide-react";
import { Button } from "@/presentation/components/ui/button";

export function SnippetCard({ title, description, code }: { title: string; description: string; code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }
  return (
    <div className="inset-surface min-w-0 rounded-[18px] p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.018em] text-label">{title}</h2>
          <p className="mt-1 text-sm text-label-secondary">{description}</p>
        </div>
        <Button onClick={copy} variant={copied ? "tinted" : "secondary"} className="shrink-0">
          {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="code-scroll max-h-[28rem] rounded-[14px] bg-[var(--glass-strong)] p-4 text-xs leading-5 text-label shadow-[inset_0_0_0_1px_var(--glass-edge)]">{code}</pre>
    </div>
  );
}
