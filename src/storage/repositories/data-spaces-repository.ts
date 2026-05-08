import { isRuntimeDatabaseConfigured, queryRows } from "@/storage/db/client";
import type { DataSpace } from "@/storage/db/schema";
import {
  AUTO_LAB_DATA_SPACE_SLUG,
  DEFAULT_DATA_SPACE_SLUG,
  staticDataSpaces,
} from "@/storage/data-spaces";
import { getDemoStore } from "@/storage/repositories/demo-store";
export { AUTO_LAB_DATA_SPACE_SLUG, DEFAULT_DATA_SPACE_SLUG, staticDataSpaces };

function isMissingDataSpacesError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error.code === "42P01" || error.code === "42703"));
}

export async function listDataSpaces(): Promise<DataSpace[]> {
  if (!isRuntimeDatabaseConfigured()) return getDemoStore().dataSpaces;
  try {
    return await queryRows<DataSpace>(
      `
        select *
        from data_spaces
        where status = 'active'
        order by is_default desc, display_name asc
      `,
    );
  } catch (error) {
    if (isMissingDataSpacesError(error)) return staticDataSpaces();
    throw error;
  }
}

export async function getDataSpaceBySlug(slug: string): Promise<DataSpace | null> {
  const normalized = slug.trim().toLowerCase();
  if (!isRuntimeDatabaseConfigured()) {
    return getDemoStore().dataSpaces.find((space) => space.slug === normalized) ?? null;
  }
  try {
    const rows = await queryRows<DataSpace>(
      `
        select *
        from data_spaces
        where slug = $1 and status = 'active'
        limit 1
      `,
      [normalized],
    );
    return rows[0] ?? null;
  } catch (error) {
    if (isMissingDataSpacesError(error)) return staticDataSpaces().find((space) => space.slug === normalized) ?? null;
    throw error;
  }
}

export async function getDefaultDataSpace(): Promise<DataSpace> {
  const spaces = await listDataSpaces();
  return spaces.find((space) => space.is_default) ?? spaces[0] ?? staticDataSpaces()[0];
}

export async function requireDataSpaceBySlug(slug: string): Promise<DataSpace> {
  const dataSpace = await getDataSpaceBySlug(slug);
  if (!dataSpace) throw new Error(`Unknown data space: ${slug}`);
  return dataSpace;
}

export function isAutoLabDataSpace(dataSpace: Pick<DataSpace, "slug">) {
  return dataSpace.slug === AUTO_LAB_DATA_SPACE_SLUG;
}
