import { notFound } from "next/navigation";
import { getContentDashboard } from "@/aggregation/services/content-service";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { Badge } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

export const dynamic = "force-dynamic";

export default async function ContentPage({ params }: { params: Promise<{ dataSpaceSlug: string }> }) {
  const { dataSpaceSlug } = await params;
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const content = await getContentDashboard({ dataSpaceId: dataSpace.id });
  const basePath = dashboardPath(dataSpace.slug);

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <SectionHeader
        eyebrow="Aggregation layer"
        title={`${dataSpace.display_name} Content performance`}
        description="TikTok and Instagram remain official-API scaffolds for now. Content rows shown here are scoped through sources in the current data space."
      />
      {content.items.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {content.items.map((item) => (
            <GlassPanel key={item.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-white">{item.title}</p>
                  <p className="mt-1 text-sm text-slate-400">{item.caption}</p>
                </div>
                <Badge tone="amber">scaffolded</Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge tone="indigo">{item.source_type_key}</Badge>
                <Badge>{item.content_type}</Badge>
                <Badge>{dataSpace.display_name}</Badge>
              </div>
            </GlassPanel>
          ))}
        </div>
      ) : (
        <GlassPanel className="p-5">
          <h2 className="text-lg font-semibold text-white">{dataSpace.display_name} has no content sources yet</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {dataSpace.slug === "auto-lab"
              ? "Use this space to test personal car/content TikTok and Instagram accounts."
              : "Connect a content source later with official APIs or webhooks before content metrics appear."}
          </p>
          {dataSpace.slug === "auto-lab" ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <LinkButton href={`${basePath}/sources/new?template=tiktok`} variant="primary">Add Auto Lab TikTok</LinkButton>
              <LinkButton href={`${basePath}/sources/new?template=instagram`} variant="secondary">Add Auto Lab Instagram</LinkButton>
            </div>
          ) : null}
        </GlassPanel>
      )}
    </div>
  );
}
