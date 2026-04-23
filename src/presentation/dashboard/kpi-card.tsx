import { ArrowUpRight, Info } from "lucide-react";
import { Badge } from "@/presentation/components/ui/badge";
import { GlassPanel } from "@/presentation/components/ui/panel";

function formatValue(value: string | number) {
  if (typeof value === "string") return value;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function KpiCard({ label, value, source, demo }: { label: string; value: string | number; source: string; demo?: boolean }) {
  return (
    <GlassPanel className="min-h-36 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm text-slate-400">
            {label}
            <Info className="h-3.5 w-3.5 text-slate-600" />
          </p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-white">{formatValue(value)}</p>
        </div>
        <ArrowUpRight className="h-5 w-5 text-cyan-200/70" />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Badge tone="cyan">{source}</Badge>
        {demo ? <Badge tone="amber">demo</Badge> : null}
      </div>
    </GlassPanel>
  );
}
