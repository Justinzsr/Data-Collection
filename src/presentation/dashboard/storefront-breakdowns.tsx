import { ChevronDown } from "lucide-react";
import type {
  WebsiteAcquisitionRow,
  WebsiteCollectionPerformanceRow,
  WebsiteFunnelOverview,
  WebsiteProductPerformanceRow,
} from "@/aggregation/services/website-funnel-types";
import { Badge } from "@/presentation/components/ui/badge";
import { Button, LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel, SectionTitle } from "@/presentation/components/ui/panel";
import {
  buildMoonArqOverviewHref,
  DEFAULT_MOONARQ_OVERVIEW_QUERY,
  MOONARQ_OVERVIEW_FILTER_LIMITS,
  sanitizeMoonArqOverviewDimensionValue,
  type MoonArqOverviewQuery,
  type MoonArqOverviewDimensionKind,
  type MoonArqOverviewQueryPatch,
} from "@/presentation/dashboard/moonarq-overview-query";

function count(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function percent(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

export function optionValues(
  current: string,
  values: string[],
  safety?: { kind: MoonArqOverviewDimensionKind; maximumLength: number },
) {
  const sanitize = (value: string) => safety
    ? sanitizeMoonArqOverviewDimensionValue(value, safety.kind, safety.maximumLength)
    : value;
  const safeCurrent = sanitize(current);
  return [...new Set([...(safeCurrent ? [safeCurrent] : []), ...values.map(sanitize)])].filter(Boolean);
}

export function productIdentityDescription(row: WebsiteProductPerformanceRow) {
  if (row.identityState === "stable") return row.itemId ? `Stable SKU · ${row.itemId}` : "Stable item identity";
  if (row.identityState === "view_only") return "View-only identity — cart rate unavailable";
  if (row.identityState === "cart_only") return "Cart-only identity — view rate unavailable";
  return "Unknown / unmapped identity";
}

function CollectionDesktopRow({ row }: { row: WebsiteCollectionPerformanceRow }) {
  return (
    <tr className="border-t border-separator transition-colors hover:bg-fill">
      <th scope="row" className="px-3 py-3 font-medium text-label">
        {row.collectionName || "Unknown / unmapped"}
        {row.state === "unknown" ? <Badge tone="amber" className="ml-2">Unknown</Badge> : null}
      </th>
      <td className="px-3 py-3 text-label-secondary">{count(row.collectionViewSessions)}</td>
      <td className="px-3 py-3 text-label-secondary">{count(row.productViewSessions)}</td>
      <td className="px-3 py-3 text-label-secondary">{percent(row.progressionRate)}</td>
    </tr>
  );
}

function ProductDesktopRow({ row }: { row: WebsiteProductPerformanceRow }) {
  return (
    <tr className="border-t border-separator transition-colors hover:bg-fill">
      <th scope="row" className="px-3 py-3">
        <p className="font-medium text-label">{row.itemName || "Unknown / unmapped"}</p>
        <p className="mt-1 break-words text-xs font-normal text-[var(--muted)]">{productIdentityDescription(row)}</p>
      </th>
      <td className="px-3 py-3 text-label-secondary">{row.itemCategory || "Unknown"}</td>
      <td className="px-3 py-3 text-label-secondary">{count(row.productViewSessions)}</td>
      <td className="px-3 py-3 text-label-secondary">{count(row.addToCartSessions)}</td>
      <td className="px-3 py-3 text-label-secondary">{percent(row.viewToCartRate)}</td>
    </tr>
  );
}

function AcquisitionDesktopRow({ row }: { row: WebsiteAcquisitionRow }) {
  return (
    <tr className="border-t border-separator transition-colors hover:bg-fill">
      <th scope="row" className="px-3 py-3 font-medium text-label">
        <span className="block whitespace-normal break-words [overflow-wrap:anywhere]">
          {row.utmSource || "Unknown"} / {row.utmMedium || "Unknown"}
        </span>
        <span className="mt-1 block whitespace-normal break-words text-xs font-normal text-[var(--muted)] [overflow-wrap:anywhere]">
          {row.utmCampaign || "Unknown campaign"}
        </span>
      </th>
      <td className="max-w-64 px-3 py-3">
        <p className="whitespace-normal break-words text-label-secondary [overflow-wrap:anywhere]">
          {row.landingPath || "Unknown"}
        </p>
        <p className="mt-1 whitespace-normal break-words text-xs text-[var(--muted)] [overflow-wrap:anywhere]">
          {row.referrerHost || "Unknown referrer"}
        </p>
      </td>
      <td className="px-3 py-3 text-label-secondary">{count(row.sessions)}</td>
      <td className="px-3 py-3 text-label-secondary">{count(row.productIntentSessions)}</td>
      <td className="px-3 py-3 text-label-secondary">
        {row.checkoutSessions === null ? "—" : count(row.checkoutSessions)}
      </td>
      <td className="px-3 py-3 text-label-secondary">{percent(row.visitToCheckoutRate)}</td>
    </tr>
  );
}

function PreservedFilterState({ query }: { query: MoonArqOverviewQuery }) {
  return (
    <>
      {query.range !== DEFAULT_MOONARQ_OVERVIEW_QUERY.range ? <input type="hidden" name="range" value={query.range} /> : null}
      {query.compare !== DEFAULT_MOONARQ_OVERVIEW_QUERY.compare ? <input type="hidden" name="compare" value={query.compare} /> : null}
      {query.trend !== DEFAULT_MOONARQ_OVERVIEW_QUERY.trend ? <input type="hidden" name="trend" value={query.trend} /> : null}
      {query.demo_state !== DEFAULT_MOONARQ_OVERVIEW_QUERY.demo_state ? <input type="hidden" name="demo_state" value={query.demo_state} /> : null}
    </>
  );
}

function StorefrontFilters({
  overview,
  query,
  basePath,
}: {
  overview: WebsiteFunnelOverview;
  query: MoonArqOverviewQuery;
  basePath: string;
}) {
  const safeUtmSource = sanitizeMoonArqOverviewDimensionValue(
    query.utm_source,
    "utm",
    MOONARQ_OVERVIEW_FILTER_LIMITS.utm,
  );
  const safeUtmMedium = sanitizeMoonArqOverviewDimensionValue(
    query.utm_medium,
    "utm",
    MOONARQ_OVERVIEW_FILTER_LIMITS.utm,
  );
  const safeUtmCampaign = sanitizeMoonArqOverviewDimensionValue(
    query.utm_campaign,
    "utm",
    MOONARQ_OVERVIEW_FILTER_LIMITS.utm,
  );
  const safeLandingPath = sanitizeMoonArqOverviewDimensionValue(
    query.landing_path,
    "landing_path",
    MOONARQ_OVERVIEW_FILTER_LIMITS.landingPath,
  );
  const safeReferrerHost = sanitizeMoonArqOverviewDimensionValue(
    query.referrer_host,
    "referrer_host",
    MOONARQ_OVERVIEW_FILTER_LIMITS.referrerHost,
  );
  const clearHref = buildMoonArqOverviewHref(basePath, query, {
    segment: "all",
    device: "all",
    utm_source: "",
    utm_medium: "",
    utm_campaign: "",
    landing_path: "",
    referrer_host: "",
  });

  return (
    <GlassPanel className="p-4 sm:p-5">
      <form action={basePath} method="get" className="grid min-w-0 gap-4">
        <PreservedFilterState query={query} />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">Recomputed filters</p>
            <h2 className="mt-1 text-[17px] font-semibold tracking-[-0.018em] text-label">Storefront segment and acquisition</h2>
            <p className="mt-1 text-sm leading-6 text-label-secondary">
              Filters rerun the first-party funnel; they do not filter only the tables below.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" className="min-h-11">Apply filters</Button>
            <LinkButton href={clearHref} variant="ghost" className="min-h-11">Clear</LinkButton>
          </div>
        </div>

        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted">
            Journey segment
            <select
              name="segment"
              defaultValue={query.segment}
              className="field h-11 min-w-0"
            >
              <option value="all">All storefront</option>
              <option value="ready-made">Ready-made</option>
              <option value="builder">Build Your Own</option>
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted">
            Device category
            <select
              name="device"
              defaultValue={query.device}
              className="field h-11 min-w-0"
            >
              <option value="all">All devices</option>
              {optionValues(query.device === "all" ? "" : query.device, overview.filterOptions.devices).map((value) => (
                <option key={value} value={value}>{value === "unknown" ? "Unknown" : value === "bot" ? "Bot" : value}</option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted">
            UTM source
            <select
              name="utm_source"
              defaultValue={safeUtmSource}
              className="field h-11 min-w-0"
            >
              <option value="">All UTM sources</option>
              {optionValues(safeUtmSource, overview.filterOptions.utmSources, {
                kind: "utm",
                maximumLength: MOONARQ_OVERVIEW_FILTER_LIMITS.utm,
              }).map((value) => (
                <option key={value} value={value}>{value || "Unknown"}</option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted">
            UTM medium
            <select
              name="utm_medium"
              defaultValue={safeUtmMedium}
              className="field h-11 min-w-0"
            >
              <option value="">All UTM media</option>
              {optionValues(safeUtmMedium, overview.filterOptions.utmMediums, {
                kind: "utm",
                maximumLength: MOONARQ_OVERVIEW_FILTER_LIMITS.utm,
              }).map((value) => (
                <option key={value} value={value}>{value || "Unknown"}</option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted">
            UTM campaign
            <select
              name="utm_campaign"
              defaultValue={safeUtmCampaign}
              className="field h-11 min-w-0"
            >
              <option value="">All campaigns</option>
              {optionValues(safeUtmCampaign, overview.filterOptions.utmCampaigns, {
                kind: "utm",
                maximumLength: MOONARQ_OVERVIEW_FILTER_LIMITS.utm,
              }).map((value) => (
                <option key={value} value={value}>{value || "Unknown"}</option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted">
            Landing path
            <select
              name="landing_path"
              defaultValue={safeLandingPath}
              className="field h-11 min-w-0"
            >
              <option value="">All landing paths</option>
              {optionValues(safeLandingPath, overview.filterOptions.landingPaths, {
                kind: "landing_path",
                maximumLength: MOONARQ_OVERVIEW_FILTER_LIMITS.landingPath,
              }).map((value) => (
                <option key={value} value={value}>{value || "Unknown"}</option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted">
            Referrer host
            <select
              name="referrer_host"
              defaultValue={safeReferrerHost}
              className="field h-11 min-w-0"
            >
              <option value="">All referrers</option>
              {optionValues(safeReferrerHost, overview.filterOptions.referrerHosts, {
                kind: "referrer_host",
                maximumLength: MOONARQ_OVERVIEW_FILTER_LIMITS.referrerHost,
              }).map((value) => (
                <option key={value} value={value}>{value || "Unknown"}</option>
              ))}
            </select>
          </label>
        </div>
      </form>
    </GlassPanel>
  );
}

type PaginationQueryKey = "collection_page" | "product_page" | "acquisition_page";

function paginationPatch(key: PaginationQueryKey, page: number): MoonArqOverviewQueryPatch {
  if (key === "collection_page") return { collection_page: page };
  if (key === "acquisition_page") return { acquisition_page: page };
  return { product_page: page };
}

function TablePagination({
  label,
  page,
  totalRows,
  hasPreviousPage,
  hasNextPage,
  queryKey,
  query,
  basePath,
}: {
  label: string;
  page: number;
  totalRows: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  queryKey: PaginationQueryKey;
  query: MoonArqOverviewQuery;
  basePath: string;
}) {
  if (!hasPreviousPage && !hasNextPage) return null;
  return (
    <nav
      className="flex items-center justify-between gap-3 border-t border-separator pt-3"
      aria-label={`${label} pagination`}
    >
      {hasPreviousPage ? (
        <LinkButton
          href={buildMoonArqOverviewHref(basePath, query, paginationPatch(queryKey, Math.max(1, page - 1)))}
          variant="secondary"
          className="min-h-11"
          rel="prev"
          aria-label={`Previous ${label.toLowerCase()} page`}
        >
          Previous
        </LinkButton>
      ) : <span />}
      <p className="text-center text-sm text-label-secondary">
        Page {page} · {count(totalRows)} rows
      </p>
      {hasNextPage ? (
        <LinkButton
          href={buildMoonArqOverviewHref(basePath, query, paginationPatch(queryKey, page + 1))}
          variant="secondary"
          className="min-h-11"
          rel="next"
          aria-label={`Next ${label.toLowerCase()} page`}
        >
          Next
        </LinkButton>
      ) : <span />}
    </nav>
  );
}

function CollectionAndProductPerformance({
  overview,
  query,
  basePath,
}: {
  overview: WebsiteFunnelOverview;
  query: MoonArqOverviewQuery;
  basePath: string;
}) {
  return (
    <section className="grid min-w-0 gap-3" aria-labelledby="storefront-performance-title">
      <SectionTitle eyebrow="Discovery and intent" title="Collection and product performance" id="storefront-performance-title" />

      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <GlassPanel className="overflow-hidden">
          <div className="border-b border-separator p-4">
            <h3 className="font-semibold text-label">Collection discovery</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Only provable collection-to-product session progression.</p>
          </div>
          <div
            className="hidden overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-tint lg:block"
            role="region"
            aria-label="Scrollable collection performance table"
            tabIndex={0}
          >
            <table className="w-full min-w-[34rem] text-left text-sm">
              <caption className="sr-only">Collection view and product progression sessions</caption>
              <thead className="text-xs text-[var(--muted)] [&_th]:font-medium">
                <tr>
                  <th scope="col" className="px-3 py-2.5">Collection</th>
                  <th scope="col" className="px-3 py-2.5">Views</th>
                  <th scope="col" className="px-3 py-2.5">Product intent</th>
                  <th scope="col" className="px-3 py-2.5">Progression</th>
                </tr>
              </thead>
              <tbody>{overview.collections.rows.map((row) => <CollectionDesktopRow key={row.key} row={row} />)}</tbody>
            </table>
          </div>
          <div className="grid gap-2 p-3 lg:hidden">
            {overview.collections.rows.map((row) => (
              <article key={row.key} className="inset-surface p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-label">{row.collectionName || "Unknown / unmapped"}</p>
                  {row.state === "unknown" ? <Badge tone="amber">Unknown</Badge> : null}
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-[var(--muted)]">Views</dt><dd className="mt-1 text-label">{count(row.collectionViewSessions)}</dd></div>
                  <div><dt className="text-[var(--muted)]">Product</dt><dd className="mt-1 text-label">{count(row.productViewSessions)}</dd></div>
                  <div><dt className="text-[var(--muted)]">Rate</dt><dd className="mt-1 text-label">{percent(row.progressionRate)}</dd></div>
                </dl>
              </article>
            ))}
          </div>
          <div className="p-3">
            <TablePagination
              label="Collection performance"
              page={overview.collections.page}
              totalRows={overview.collections.totalRows}
              hasPreviousPage={overview.collections.hasPreviousPage}
              hasNextPage={overview.collections.hasNextPage}
              queryKey="collection_page"
              query={query}
              basePath={basePath}
            />
          </div>
        </GlassPanel>

        <GlassPanel className="overflow-hidden" data-testid="product-performance">
          <div className="border-b border-separator p-4">
            <h3 className="font-semibold text-label">Product intent</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">View-to-cart rates require a stable shared item identity.</p>
          </div>
          <div
            className="hidden overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-tint lg:block"
            role="region"
            aria-label="Scrollable product performance table"
            tabIndex={0}
          >
            <table className="w-full min-w-[42rem] text-left text-sm">
              <caption className="sr-only">Product view and add-to-cart session performance</caption>
              <thead className="text-xs text-[var(--muted)] [&_th]:font-medium">
                <tr>
                  <th scope="col" className="px-3 py-2.5">Product</th>
                  <th scope="col" className="px-3 py-2.5">Category</th>
                  <th scope="col" className="px-3 py-2.5">Views</th>
                  <th scope="col" className="px-3 py-2.5">Cart</th>
                  <th scope="col" className="px-3 py-2.5">View-to-cart</th>
                </tr>
              </thead>
              <tbody>{overview.products.rows.map((row) => <ProductDesktopRow key={row.key} row={row} />)}</tbody>
            </table>
          </div>
          <div className="grid gap-2 p-3 lg:hidden">
            {overview.products.rows.map((row) => (
              <article key={row.key} className="inset-surface p-3">
                <p className="font-medium text-label">{row.itemName || "Unknown / unmapped"}</p>
                <p className="mt-1 break-words text-xs text-[var(--muted)]">{productIdentityDescription(row)}</p>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-[var(--muted)]">Views</dt><dd className="mt-1 text-label">{count(row.productViewSessions)}</dd></div>
                  <div><dt className="text-[var(--muted)]">Cart</dt><dd className="mt-1 text-label">{count(row.addToCartSessions)}</dd></div>
                  <div><dt className="text-[var(--muted)]">Rate</dt><dd className="mt-1 text-label">{percent(row.viewToCartRate)}</dd></div>
                </dl>
              </article>
            ))}
          </div>
          <div className="p-3">
            <TablePagination
              label="Product performance"
              page={overview.products.page}
              totalRows={overview.products.totalRows}
              hasPreviousPage={overview.products.hasPreviousPage}
              hasNextPage={overview.products.hasNextPage}
              queryKey="product_page"
              query={query}
              basePath={basePath}
            />
          </div>
        </GlassPanel>
      </div>
    </section>
  );
}

function AcquisitionAndDevices({
  overview,
  query,
  basePath,
}: {
  overview: WebsiteFunnelOverview;
  query: MoonArqOverviewQuery;
  basePath: string;
}) {
  return (
    <section className="grid min-w-0 gap-3" aria-labelledby="storefront-acquisition-title">
      <div className="grid gap-1">
        <SectionTitle eyebrow="Acquisition context" title="Acquisition and device" id="storefront-acquisition-title" />
        <p className="px-1 text-sm leading-6 text-label-secondary">
          Normalized first-party UTM, landing-path, referrer-host, and device fields. Unknown remains visible.
        </p>
      </div>

      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.5fr)]">
        <GlassPanel className="overflow-hidden" data-testid="acquisition-performance">
          <div
            className="hidden overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-tint lg:block"
            role="region"
            aria-label="Scrollable acquisition performance table"
            tabIndex={0}
          >
            <table className="w-full min-w-[52rem] text-left text-sm">
              <caption className="sr-only">Acquisition session and checkout performance</caption>
              <thead className="text-xs text-[var(--muted)] [&_th]:font-medium">
                <tr>
                  <th scope="col" className="px-3 py-2.5">UTM</th>
                  <th scope="col" className="px-3 py-2.5">Landing / referrer</th>
                  <th scope="col" className="px-3 py-2.5">Sessions</th>
                  <th scope="col" className="px-3 py-2.5">Intent</th>
                  <th scope="col" className="px-3 py-2.5">Checkout started</th>
                  <th scope="col" className="px-3 py-2.5">Visit-to-checkout rate</th>
                </tr>
              </thead>
              <tbody>{overview.acquisition.rows.map((row) => <AcquisitionDesktopRow key={row.key} row={row} />)}</tbody>
            </table>
          </div>
          <div className="grid gap-2 p-3 lg:hidden">
            {overview.acquisition.rows.map((row) => (
              <article
                key={row.key}
                className="inset-surface p-3"
                data-acquisition-mobile-row
              >
                <dl className="grid grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                  <dt className="text-[var(--muted)]">UTM source</dt>
                  <dd className="whitespace-normal break-words text-label [overflow-wrap:anywhere]">{row.utmSource || "Unknown"}</dd>
                  <dt className="text-[var(--muted)]">UTM medium</dt>
                  <dd className="whitespace-normal break-words text-label [overflow-wrap:anywhere]">{row.utmMedium || "Unknown"}</dd>
                  <dt className="text-[var(--muted)]">Campaign</dt>
                  <dd className="whitespace-normal break-words text-label [overflow-wrap:anywhere]">{row.utmCampaign || "Unknown campaign"}</dd>
                  <dt className="text-[var(--muted)]">Landing page</dt>
                  <dd className="whitespace-normal break-words text-label [overflow-wrap:anywhere]">{row.landingPath || "Unknown landing path"}</dd>
                  <dt className="text-[var(--muted)]">Referrer</dt>
                  <dd className="whitespace-normal break-words text-label [overflow-wrap:anywhere]">{row.referrerHost || "Unknown referrer"}</dd>
                  <dt className="text-[var(--muted)]">Sessions</dt>
                  <dd className="text-label">{count(row.sessions)}</dd>
                  <dt className="text-[var(--muted)]">Product intent</dt>
                  <dd className="text-label">{count(row.productIntentSessions)}</dd>
                  <dt className="text-[var(--muted)]">Checkout started</dt>
                  <dd className="text-label">{row.checkoutSessions === null ? "—" : count(row.checkoutSessions)}</dd>
                  <dt className="text-[var(--muted)]">Visit-to-checkout rate</dt>
                  <dd className="text-label">{percent(row.visitToCheckoutRate)}</dd>
                </dl>
              </article>
            ))}
          </div>
          <div className="p-3">
            <TablePagination
              label="Acquisition performance"
              page={overview.acquisition.page}
              totalRows={overview.acquisition.totalRows}
              hasPreviousPage={overview.acquisition.hasPreviousPage}
              hasNextPage={overview.acquisition.hasNextPage}
              queryKey="acquisition_page"
              query={query}
              basePath={basePath}
            />
          </div>
        </GlassPanel>

        <GlassPanel className="p-4">
          <h3 className="font-semibold text-label">Device category</h3>
          <div className="mt-3 grid gap-2">
            {overview.devices.map((row) => (
              <div key={row.device} className="inset-surface p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="capitalize text-sm font-medium text-label">{row.device}</p>
                  <p className="text-[17px] font-semibold tracking-[-0.018em] text-label">{count(row.sessions)}</p>
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {count(row.productIntentSessions)} intent · {row.checkoutSessions === null ? "checkout not measured" : `${count(row.checkoutSessions)} checkout`} · {percent(row.visitToCheckoutRate)}
                </p>
              </div>
            ))}
          </div>
        </GlassPanel>
      </div>
    </section>
  );
}

function QualityDisclosure({ overview }: { overview: WebsiteFunnelOverview }) {
  const quality = overview.quality;
  const equalTime = quality.equalTimeIntentSessions + quality.equalTimeCartSessions + quality.equalTimeCheckoutSessions;
  const unsequenced = quality.unsequencedIntentSessions + quality.unsequencedCartSessions + quality.unsequencedCheckoutSessions;
  const unavailable = overview.dataState === "source_unavailable"
    || overview.dataState === "pre_coverage";

  return (
    <details className="group glass rounded-3xl" data-testid="storefront-quality">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-3xl px-4 py-3 transition hover:bg-fill-hover sm:px-5">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold tracking-[-0.01em] text-label">Data quality and reconciliation</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">Sequence ambiguity, unmapped events, and like-for-like daily rollup checks</p>
        </div>
        <span className="flex shrink-0 items-center gap-2">
        <Badge
          tone={
            overview.reconciliation.state === "disagrees"
            || overview.reconciliation.state === "delayed"
              ? "amber"
              : "slate"
          }
        >
          {overview.reconciliation.state}
        </Badge>
        <ChevronDown className="h-4 w-4 text-muted transition group-open:rotate-180" aria-hidden="true" />
        </span>
      </summary>
      {unavailable ? (
        <div className="border-t border-separator p-4" role="status">
          <p className="text-sm font-medium text-label">Quality diagnostics unavailable</p>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            {overview.dataState === "pre_coverage"
              ? "This range predates Website tracking coverage, so zeros would be misleading."
              : "Diagnostics require exactly one available authoritative Website source."}
          </p>
        </div>
      ) : (
      <div className="grid gap-4 border-t border-separator p-4 lg:grid-cols-3">
        <div>
          <h3 className="text-xs font-semibold text-[var(--muted)]">Sequence policy</h3>
          <p className="mt-2 text-sm leading-6 text-label-secondary">
            {count(equalTime)} co-timed session progressions were excluded from strict ordering; {count(unsequenced)} out-of-order or skipped-stage signals remain outside the monotonic funnel.
          </p>
          <p className="mt-2 text-xs text-[var(--muted)]">{count(quality.duplicateDeliveriesRemoved)} duplicate deliveries removed.</p>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-[var(--muted)]">Unknown and invalid</h3>
          <ul className="mt-2 grid gap-1.5 text-sm text-label-secondary">
            {quality.unknownEvents.map((item) => (
              <li key={item.eventName}>{item.eventName || "Unknown event"} · {count(item.events)}</li>
            ))}
            {quality.invalidPropertyEvents.map((item) => (
              <li key={`invalid-${item.eventName}`}>{item.eventName || "Unknown event"} invalid properties · {count(item.events)}</li>
            ))}
            {quality.unknownEvents.length === 0 && quality.invalidPropertyEvents.length === 0
              ? <li className="text-[var(--muted)]">No unmapped event diagnostics in this selection.</li>
              : null}
          </ul>
          {quality.unknownEventTotalRows > quality.unknownEvents.length ? (
            <p className="mt-2 text-xs text-[var(--muted)]">
              Showing {count(quality.unknownEvents.length)} of {count(quality.unknownEventTotalRows)} unknown event names.
            </p>
          ) : null}
        </div>
        <div>
          <h3 className="text-xs font-semibold text-[var(--muted)]">Raw vs daily aggregate</h3>
          <p className="mt-2 text-sm leading-6 text-label-secondary">{overview.reconciliation.note}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div><dt className="text-[var(--muted)]">Completed-day raw page views</dt><dd className="mt-1 text-label">{count(overview.reconciliation.rawPageViews)}</dd></div>
            <div><dt className="text-[var(--muted)]">Daily page views</dt><dd className="mt-1 text-label">{overview.reconciliation.dailyPageViews === null ? "—" : count(overview.reconciliation.dailyPageViews)}</dd></div>
            <div><dt className="text-[var(--muted)]">Completed-day raw custom events</dt><dd className="mt-1 text-label">{count(overview.reconciliation.rawCustomEvents)}</dd></div>
            <div><dt className="text-[var(--muted)]">Daily custom events</dt><dd className="mt-1 text-label">{overview.reconciliation.dailyCustomEvents === null ? "—" : count(overview.reconciliation.dailyCustomEvents)}</dd></div>
          </dl>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Period-distinct visitors and sessions are not compared with summed daily distinct counts.</p>
        </div>
      </div>
      )}
    </details>
  );
}

export function StorefrontBreakdowns({
  overview,
  query,
  basePath,
}: {
  overview: WebsiteFunnelOverview;
  query: MoonArqOverviewQuery;
  basePath: string;
}) {
  return (
    <div className="grid min-w-0 gap-5">
      <StorefrontFilters overview={overview} query={query} basePath={basePath} />
      <CollectionAndProductPerformance overview={overview} query={query} basePath={basePath} />
      <AcquisitionAndDevices overview={overview} query={query} basePath={basePath} />
      <QualityDisclosure overview={overview} />
    </div>
  );
}
