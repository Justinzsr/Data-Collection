import { getContentDashboard } from "@/aggregation/services/content-service";
import { Badge } from "@/presentation/components/ui/badge";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";

export default async function ContentPage() {
  const content = await getContentDashboard();
  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <SectionHeader eyebrow="Aggregation layer" title="Content performance" description="TikTok and Instagram are scaffolded with official API direction and demo placeholder metrics." />
      <div className="grid gap-4 md:grid-cols-2">
        {content.items.map((item) => (
          <GlassPanel key={item.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium text-white">{item.title}</p>
                <p className="mt-1 text-sm text-slate-400">{item.caption}</p>
              </div>
              <Badge tone="amber">demo</Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone="indigo">{item.source_type_key}</Badge>
              <Badge>{item.content_type}</Badge>
              <Badge>scaffolded</Badge>
            </div>
          </GlassPanel>
        ))}
      </div>
    </div>
  );
}
