import { DEFAULT_DATA_SPACE_SLUG } from "@/storage/data-spaces";

export function dashboardBasePath(dataSpaceSlug = DEFAULT_DATA_SPACE_SLUG) {
  return `/w/${dataSpaceSlug}/dashboard`;
}

export function dashboardPath(dataSpaceSlug: string, suffix = "") {
  return `${dashboardBasePath(dataSpaceSlug)}${suffix}`;
}

export function dataSpaceQuery(dataSpaceSlug: string) {
  return `dataSpaceSlug=${encodeURIComponent(dataSpaceSlug)}`;
}
