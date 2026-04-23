"use client";

import { useState } from "react";
import { Check, Clipboard } from "lucide-react";
import { Button } from "@/presentation/components/ui/button";
import { GlassPanel } from "@/presentation/components/ui/panel";

export function SnippetCard({ title, description, code }: { title: string; description: string; code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }
  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-slate-400">{description}</p>
        </div>
        <Button onClick={copy} variant="secondary">
          {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="code-scroll rounded-lg border border-white/10 bg-black/40 p-4 text-xs leading-5 text-cyan-50">{code}</pre>
    </GlassPanel>
  );
}
