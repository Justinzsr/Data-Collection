import { listConnectorEvents } from "@/storage/repositories/events-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { listSyncRuns } from "@/storage/repositories/sync-runs-repository";

export async function getSystemHealth(options: { dataSpaceId?: string } = {}) {
  const [sources, runs, events] = await Promise.all([
    listSources({ dataSpaceId: options.dataSpaceId }),
    listSyncRuns(50, undefined, { dataSpaceId: options.dataSpaceId }),
    listConnectorEvents(50, { dataSpaceId: options.dataSpaceId }),
  ]);
  return {
    sourcesTotal: sources.length,
    healthySources: sources.filter((source) => ["demo", "healthy"].includes(source.status)).length,
    warningSources: sources.filter((source) => ["needs_credentials", "warning"].includes(source.status)).length,
    errorSources: sources.filter((source) => source.status === "error").length,
    activeRuns: runs.filter((run) => run.status === "running"),
    recentRuns: runs.slice(0, 20),
    recentEvents: events.slice(0, 20),
  };
}
