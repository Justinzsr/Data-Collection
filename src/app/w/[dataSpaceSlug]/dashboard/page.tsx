import Link from "next/link";
import { Car, Plus, Video } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getPlatformOverview, type OverviewPlatformKey } from "@/aggregation/services/platform-overview-service";
import type { DateRangeKey } from "@/aggregation/services/summary-service";
import { getDataSpaceBySlug, isAutoLabDataSpace } from "@/storage/repositories/data-spaces-repository";
import { LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel } from "@/presentation/components/ui/panel";
import { IconTile } from "@/presentation/components/ui/platform-icon";
import { currentTime } from "@/presentation/components/ui/relative-time";
import {
  buildMoonArqOverviewHref,
  MOONARQ_OVERVIEW_DEMO_STATES,
  parseMoonArqOverviewQuery,
} from "@/presentation/dashboard/moonarq-overview-query";
import { AttentionBanner } from "@/presentation/overview/attention-banner";
import { OverviewHeader } from "@/presentation/overview/overview-header";
import { PaidAdsHero } from "@/presentation/overview/paid-ads-hero";
import { PlatformOverviewCard } from "@/presentation/overview/platform-overview-card";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const RANGES = ["today", "7d", "30d"] as const;
const OVERVIEW_DEMO_STATES = [...MOONARQ_OVERVIEW_DEMO_STATES, "ads-live"] as const;
type OverviewDemoState = (typeof OVERVIEW_DEMO_STATES)[number];

/** Storefront filters belong to the Website page; old Overview links carrying them are forwarded there. */
const WEBSITE_ONLY_PARAMS = [
  "compare",
  "segment",
  "trend",
  "device",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "landing_path",
  "referrer_host",
  "collection_page",
  "product_page",
  "acquisition_page",
] as const;

function single(query: SearchParams, key: string) {
  const value = query[key];
  return typeof value === "string" ? value : undefined;
}

function parseRange(value: string | undefined): DateRangeKey {
  return (RANGES as readonly string[]).includes(value ?? "") ? value as DateRangeKey : "30d";
}

function parseDemoState(value: string | undefined): OverviewDemoState {
  return (OVERVIEW_DEMO_STATES as readonly string[]).includes(value ?? "") ? value as OverviewDemoState : "populated";
}

const PLATFORM_PATHS: Record<OverviewPlatformKey, string> = {
  website: "/platforms/website",
  shopify: "/platforms/shopify",
  etsy: "/platforms/etsy",
  whatnot: "/platforms/whatnot",
  instagram: "/platforms/instagram",
  tiktok: "/platforms/tiktok",
  supabase: "/platforms/supabase",
};

function AddPlatformCard({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="group flex min-h-[13rem] min-w-0 flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-separator p-5 text-center transition hover:bg-fill focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30"
      data-testid="overview-add-platform"
    >
      <span className="grid h-11 w-11 place-items-center rounded-full bg-fill-strong text-tint-text transition group-hover:bg-tint/12" aria-hidden="true">
        <Plus className="h-5 w-5" />
      </span>
      <span>
        <span className="block text-[15px] font-semibold text-label">Add a platform</span>
        <span className="mt-1 block text-[13px] leading-5 text-label-secondary">Connect another source to see it here</span>
      </span>
    </Link>
  );
}

function AutoLabEmptyState({ basePath }: { basePath: string }) {
  return (
    <GlassPanel className="grid gap-5 p-5 sm:p-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <IconTile icon={Car} tone="warning" size="lg" className="mb-4" />
          <p className="eyebrow">Isolated testing space</p>
          <h2 className="mt-1 text-[24px] font-bold tracking-[-0.025em] text-label">Auto Lab has no sources yet</h2>
          <p className="mt-3 text-sm leading-6 text-label-secondary">
            Use this space to test personal car/content TikTok and Instagram accounts. Company sources are intentionally excluded from this workspace.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
          <LinkButton href={`${basePath}/sources/new?template=tiktok`} variant="primary">
            <Video className="h-4 w-4" />
            Add Auto Lab TikTok
          </LinkButton>
          <LinkButton href={`${basePath}/sources/new?template=instagram`} variant="secondary">
            <Plus className="h-4 w-4" />
            Add Auto Lab Instagram
          </LinkButton>
        </div>
      </div>
    </GlassPanel>
  );
}

export default async function DataSpaceDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ dataSpaceSlug: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const [{ dataSpaceSlug }, rawQuery] = await Promise.all([params, searchParams]);
  const query = rawQuery ?? {};
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const basePath = dashboardPath(dataSpace.slug);
  const isMoonArq = dataSpace.slug === "moonarq";

  if (isMoonArq && WEBSITE_ONLY_PARAMS.some((key) => query[key] !== undefined)) {
    // The parser drops anything that is not an allowlisted, privacy-safe value.
    redirect(buildMoonArqOverviewHref(`${basePath}/platforms/website`, parseMoonArqOverviewQuery(query)));
  }

  const range = parseRange(single(query, "range"));
  const demoState = parseDemoState(single(query, "demo_state"));
  const overview = await getPlatformOverview({
    dataSpace,
    rangeKey: range,
    demoState: demoState === "ads-live" ? "populated" : demoState,
    adsFixture: demoState === "ads-live",
  });
  const now = currentTime();
  const autoLabEmpty = isAutoLabDataSpace(dataSpace) && overview.sources.length === 0;
  const rangeHref = (next: DateRangeKey) => {
    const search = new URLSearchParams();
    if (next !== "30d") search.set("range", next);
    if (demoState !== "populated") search.set("demo_state", demoState);
    const value = search.toString();
    return `${basePath}${value ? `?${value}` : ""}`;
  };
  const rangeQuery = range === "30d" ? "" : `?range=${range}`;
  const adsDetailsSearch = new URLSearchParams();
  if (range !== "30d") adsDetailsSearch.set("range", range);
  // Local previews keep the paid-delivery fixture on the Ads page too.
  if (demoState === "ads-live") adsDetailsSearch.set("demo_state", "ads-live");
  const adsDetailsQuery = adsDetailsSearch.toString();
  const adsDetailsHref = `${basePath}/platforms/ads${adsDetailsQuery ? `?${adsDetailsQuery}` : ""}`;

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-5" data-testid="dashboard-overview">
      <OverviewHeader
        title={`${dataSpace.display_name} Overview`}
        subtitle="Every platform at a glance. Select one to see its full detail."
        range={range}
        rangeHref={rangeHref}
      />

      {autoLabEmpty ? <AutoLabEmptyState basePath={basePath} /> : null}

      <AttentionBanner sources={overview.sources} basePath={basePath} now={now} />

      {overview.paidAds ? (
        <PaidAdsHero
          ads={overview.paidAds}
          range={overview.range}
          dataSpaceSlug={dataSpace.slug}
          basePath={basePath}
          detailsHref={adsDetailsHref}
          now={now}
        />
      ) : null}

      {overview.cards.length > 0 ? (
        <section className="min-w-0" aria-labelledby="overview-platforms-title">
          <h2 id="overview-platforms-title" className="sr-only">Platforms</h2>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="overview-platform-grid">
            {overview.cards.map((card) => (
              <PlatformOverviewCard
                key={card.key}
                card={card}
                href={`${basePath}${PLATFORM_PATHS[card.key]}${rangeQuery}`}
                now={now}
              />
            ))}
            <AddPlatformCard href={`${basePath}/sources/new`} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
