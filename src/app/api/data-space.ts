import { getDataSpaceBySlug, getDefaultDataSpace } from "@/storage/repositories/data-spaces-repository";

export async function resolveDataSpaceFromRequest(request: Request) {
  const dataSpaceSlug = new URL(request.url).searchParams.get("dataSpaceSlug");
  if (!dataSpaceSlug) return getDefaultDataSpace();
  return getDataSpaceBySlug(dataSpaceSlug);
}
