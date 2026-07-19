import { notFound } from "next/navigation";
import { EmailMarketingDashboard } from "@/presentation/email-marketing/email-marketing-dashboard";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";

export const dynamic = "force-dynamic";

export default async function EmailMarketingPage({
  params,
}: {
  params: Promise<{ dataSpaceSlug: string }>;
}) {
  const { dataSpaceSlug } = await params;
  if (dataSpaceSlug !== "moonarq") notFound();
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  return <EmailMarketingDashboard dataSpaceName={dataSpace.display_name} dataSpaceSlug={dataSpace.slug} />;
}
