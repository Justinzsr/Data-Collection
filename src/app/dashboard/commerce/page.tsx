import { getCommerceDashboard } from "@/aggregation/services/commerce-service";
import { Badge } from "@/presentation/components/ui/badge";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";

export default async function CommercePage() {
  const commerce = await getCommerceDashboard();
  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <SectionHeader eyebrow="Future connector" title="Commerce" description={commerce.message} />
      <GlassPanel className="p-5">
        <h2 className="text-base font-semibold text-white">Shopify setup placeholder</h2>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Shopify can be connected later with an Admin API access token stored as an encrypted per-source credential. Because operations are not active yet, commerce does not dominate the executive dashboard.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {commerce.plannedMetrics.map((metric) => <Badge key={metric} tone="amber">{metric}</Badge>)}
        </div>
      </GlassPanel>
    </div>
  );
}
