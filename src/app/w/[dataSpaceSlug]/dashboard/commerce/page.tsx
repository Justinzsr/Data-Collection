import { ShoppingBag } from "lucide-react";
import { notFound } from "next/navigation";
import { getCommerceDashboard } from "@/aggregation/services/commerce-service";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { Badge } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { PlatformModuleCard } from "@/presentation/dashboard/platform-module-card";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

export const dynamic = "force-dynamic";

export default async function CommercePage({ params }: { params: Promise<{ dataSpaceSlug: string }> }) {
  const { dataSpaceSlug } = await params;
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const basePath = dashboardPath(dataSpace.slug);
  const commerce = await getCommerceDashboard({ dataSpaceId: dataSpace.id, dataSpaceName: dataSpace.display_name });
  const sourceHref = commerce.module.sourceId
    ? `${basePath}/sources/${commerce.module.sourceId}`
    : `${basePath}/sources/new?template=shopify`;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-5">
      <SectionHeader
        eyebrow="Official Shopify Admin API"
        title={`${dataSpace.display_name} Commerce`}
        description={commerce.message}
        action={
          <LinkButton href={sourceHref} variant="primary">
            <ShoppingBag className="h-4 w-4" />
            {commerce.module.sourceId ? "Open Shopify source" : "Connect Shopify"}
          </LinkButton>
        }
      />

      <PlatformModuleCard module={commerce.module} basePath={basePath} dataSpaceSlug={dataSpace.slug} />

      <GlassPanel className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="green">read-only</Badge>
          <Badge tone="cyan">server encrypted</Badge>
          <Badge tone="slate">60-day rolling window</Badge>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          MoonArq requests order totals and line-item names and quantities only. It does not request customer names,
          email addresses, phone numbers, addresses, IP data, notes, or payment details. Test orders are excluded, and
          every sync recomputes store-local daily totals so retries do not double count.
        </p>
      </GlassPanel>
    </div>
  );
}
