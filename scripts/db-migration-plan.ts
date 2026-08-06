export interface DatabaseMigrationPlanInput {
  filenames: readonly string[];
  appliedFilenames: ReadonlySet<string>;
  target: string | null;
}

export function selectPendingMigrations({
  filenames,
  appliedFilenames,
  target,
}: DatabaseMigrationPlanInput): string[] {
  const orderedFilenames = filenames
    .filter((filename) => filename.endsWith(".sql"))
    .toSorted();

  if (target !== null && !orderedFilenames.includes(target)) {
    throw new Error(`Unknown migration target: ${target}`);
  }

  return orderedFilenames.filter((filename) => {
    if (target !== null && filename > target) return false;
    return !appliedFilenames.has(filename);
  });
}
