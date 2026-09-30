import type { PlatformModule } from "@/aggregation/services/platform-modules-service";
import { PlatformModuleCard } from "@/presentation/dashboard/platform-module-card";

export function PlatformModuleGrid({ modules, basePath, dataSpaceSlug }: { modules: PlatformModule[]; basePath?: string; dataSpaceSlug?: string }) {
  return (
    <section className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Platform modules</p>
          <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.022em] text-label">Connected platform command grid</h2>
        </div>
        <p className="max-w-2xl text-sm leading-6 text-label-secondary">
          Each card is a source module with sync state, setup health, primary metrics, and a mini signal graph.
        </p>
      </div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {modules.map((module) => (
          <PlatformModuleCard key={`${module.sourceTypeKey}-${module.sourceId ?? "placeholder"}`} module={module} basePath={basePath} dataSpaceSlug={dataSpaceSlug} />
        ))}
      </div>
    </section>
  );
}
