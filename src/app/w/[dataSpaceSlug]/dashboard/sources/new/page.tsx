import { Suspense } from "react";
import { notFound } from "next/navigation";
import { SectionHeader } from "@/presentation/components/ui/panel";
import { AddSourceWizard } from "@/presentation/source-onboarding/add-source-wizard";
import { dashboardPath } from "@/presentation/routes/data-space-routes";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";

export default async function NewSourcePage({ params }: { params: Promise<{ dataSpaceSlug: string }> }) {
  const { dataSpaceSlug } = await params;
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <SectionHeader
        eyebrow="Source onboarding"
        title={`Add Source to ${dataSpace.display_name}`}
        description="Paste a link, detect the platform, choose sync mode, understand credentials/setup, save the source, then run an initial sync or continue in demo mode."
      />
      <Suspense fallback={<div className="rounded-lg border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-300">Loading source wizard...</div>}>
        <AddSourceWizard dataSpaceSlug={dataSpace.slug} dataSpaceName={dataSpace.display_name} basePath={dashboardPath(dataSpace.slug)} />
      </Suspense>
    </div>
  );
}
