import { notFound, redirect } from "next/navigation";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

export const dynamic = "force-dynamic";

/** Commerce now lives on the Shopify platform page; keep old links working. */
export default async function CommercePage({ params }: { params: Promise<{ dataSpaceSlug: string }> }) {
  const { dataSpaceSlug } = await params;
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  redirect(dashboardPath(dataSpace.slug, "/platforms/shopify"));
}
