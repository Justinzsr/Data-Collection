import { notFound } from "next/navigation";
import { getCommerceDashboard } from "@/aggregation/services/commerce-service";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { Badge } from "@/presentation/components/ui/badge";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";

export const dynamic = "force-dynamic";

export default async function CommercePage({ params }: { params: Promise<{ dataSpaceSlug: string }> }) {
  const { dataSpaceSlug } = await params;
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const commerce = await getCommerceDashboard();

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <SectionHeader eyebrow="Future connector" title={`${dataSpace.display_name} Commerce`} description={commerce.message} />
      <GlassPanel className="p-5">
        <h2 className="text-base font-semibold text-white">Shopify setup placeholder</h2>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Shopify can be connected later with an Admin API access token stored as an encrypted per-source credential. It will be assigned to {dataSpace.display_name} at creation time and will not appear in other data spaces.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {commerce.plannedMetrics.map((metric) => <Badge key={metric} tone="amber">{metric}</Badge>)}
        </div>
      </GlassPanel>
    </div>
  );
}
