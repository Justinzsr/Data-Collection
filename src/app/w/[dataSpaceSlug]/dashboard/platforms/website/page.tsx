import { ArrowRight } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { WEBSITE_COMMERCE_FUNNEL_V2_UI_FLAG } from "@/aggregation/services/website-commerce-funnel-v2-service";
import { getWebsiteFunnelOverview } from "@/aggregation/services/website-funnel-service";
import { resolvePrimaryWebsiteSource } from "@/collection/tracking/website-sources";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { LinkButton } from "@/presentation/components/ui/button";
import { currentTime } from "@/presentation/components/ui/relative-time";
import {
  buildMoonArqOverviewHref,
  parseMoonArqOverviewQuery,
  type MoonArqOverviewQuery,
} from "@/presentation/dashboard/moonarq-overview-query";
import { StorefrontBreakdowns } from "@/presentation/dashboard/storefront-breakdowns";
import { StorefrontConversionTrend } from "@/presentation/dashboard/storefront-conversion-trend";
import { StorefrontFunnel } from "@/presentation/dashboard/storefront-funnel";
import { StorefrontJourneys } from "@/presentation/dashboard/storefront-journeys";
import { WebsiteBusinessPulse } from "@/presentation/dashboard/website-business-pulse";
import { WebsiteCommerceFunnelV2 } from "@/presentation/dashboard/website-commerce-funnel-v2";
import { WebsiteOverviewControls } from "@/presentation/dashboard/website-overview-controls";
import { platformHealth } from "@/presentation/overview/platform-health";
import { PlatformPageHeader } from "@/presentation/platforms/platform-page-header";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

export const dynamic = "force-dynamic";

const displayFilterKeys = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "landing_path",
  "referrer_host",
] as const satisfies readonly (keyof MoonArqOverviewQuery)[];

/** Any filter value the privacy parser rejected or normalized is dropped from the URL before rendering. */
function requiresSanitizedRedirect(
  raw: Record<string, string | string[] | undefined>,
  normalized: MoonArqOverviewQuery,
) {
  return displayFilterKeys.some((key) => {
    const value = raw[key];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value !== "string") return false;
    return value.trim() !== normalized[key];
  });
}

export default async function WebsitePlatformPage({
  params,
  searchParams,
}: {
  params: Promise<{ dataSpaceSlug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ dataSpaceSlug }, rawQuery] = await Promise.all([params, searchParams]);
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const basePath = dashboardPath(dataSpace.slug);
  // The storefront funnel is defined for the MoonArq tracker; other spaces read their website events directly.
  if (dataSpace.slug !== "moonarq") redirect(`${basePath}/events`);

  const websitePath = `${basePath}/platforms/website`;
  const query = parseMoonArqOverviewQuery(rawQuery ?? {});
  if (requiresSanitizedRedirect(rawQuery ?? {}, query)) redirect(buildMoonArqOverviewHref(websitePath, query));

  const [overview, sources] = await Promise.all([
    getWebsiteFunnelOverview({
      dataSpaceId: dataSpace.id,
      range: query.range,
      comparison: query.compare,
      segment: query.segment,
      device: query.device,
      utmSource: query.utm_source,
      utmMedium: query.utm_medium,
      utmCampaign: query.utm_campaign,
      landingPath: query.landing_path,
      referrerHost: query.referrer_host,
      collectionPage: query.collection_page,
      productPage: query.product_page,
      acquisitionPage: query.acquisition_page,
      demoState: query.demo_state,
    }),
    listSources({ dataSpaceId: dataSpace.id }),
  ]);
  const source = resolvePrimaryWebsiteSource(sources);
  const health = platformHealth(source, currentTime());
  const v2Enabled = process.env[WEBSITE_COMMERCE_FUNNEL_V2_UI_FLAG]?.trim() === "true";

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-4">
      <PlatformPageHeader
        overviewHref={basePath}
        iconKey="website"
        title="Website"
        subtitle={`First-party visits, shopping intent, and checkout starts${source?.account_name ? ` on ${source.account_name}` : ""}.`}
        status={{ tone: health.tone, label: health.label }}
        testId="website-header"
        actions={source ? (
          <LinkButton href={`${basePath}/sources/${source.id}`} variant="secondary" className="min-h-11 sm:min-h-10">
            Source settings
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </LinkButton>
        ) : null}
      />
      <WebsiteOverviewControls overview={overview} query={query} basePath={websitePath} />
      <WebsiteBusinessPulse overview={overview} />
      <section className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]" aria-label="Storefront funnel and conversion trend">
        <StorefrontFunnel overview={overview} />
        <StorefrontConversionTrend overview={overview} query={query} basePath={websitePath} />
      </section>
      <StorefrontJourneys overview={overview} />
      <StorefrontBreakdowns overview={overview} query={query} basePath={websitePath} />
      {v2Enabled ? (
        <WebsiteCommerceFunnelV2 dataSpaceSlug={dataSpace.slug} range={query.range} segment={query.segment} />
      ) : null}
    </div>
  );
}
