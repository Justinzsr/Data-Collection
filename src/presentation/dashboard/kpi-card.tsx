import { Badge } from "@/presentation/components/ui/badge";
import { GlassPanel } from "@/presentation/components/ui/panel";

function formatValue(value: string | number) {
  if (typeof value === "string") return value;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function KpiCard({ label, value, source, demo }: { label: string; value: string | number; source: string; demo?: boolean }) {
  return (
    <GlassPanel className="flex min-h-32 flex-col rounded-[22px] p-4">
      <p className="text-[13px] font-medium leading-5 text-label-secondary">{label}</p>
      <p className="tabular mt-2 text-[30px] font-semibold leading-9 tracking-[-0.035em] text-label">{formatValue(value)}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        <Badge tone="slate" className="font-mono font-medium">{source}</Badge>
        {demo ? <Badge tone="amber">demo</Badge> : null}
      </div>
    </GlassPanel>
  );
}
