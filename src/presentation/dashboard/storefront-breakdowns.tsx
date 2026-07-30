import type {
  WebsiteAcquisitionRow,
  WebsiteCollectionPerformanceRow,
  WebsiteFunnelOverview,
  WebsiteProductPerformanceRow,
} from "@/aggregation/services/website-funnel-types";
import { Badge } from "@/presentation/components/ui/badge";
import { Button, LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel } from "@/presentation/components/ui/panel";
import {
  buildMoonArqOverviewHref,
  DEFAULT_MOONARQ_OVERVIEW_QUERY,
  type MoonArqOverviewQuery,
  type MoonArqOverviewQueryPatch,
} from "@/presentation/dashboard/moonarq-overview-query";

function count(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function percent(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function optionValues(current: string, values: string[]) {
  return [...new Set([...(current ? [current] : []), ...values])].filter(Boolean);
}

export function productIdentityDescription(row: WebsiteProductPerformanceRow) {
  if (row.identityState === "stable") return row.itemId ? `Stable SKU · ${row.itemId}` : "Stable item identity";
  if (row.identityState === "view_only") return "View-only identity — cart rate unavailable";
  if (row.identityState === "cart_only") return "Cart-only identity — view rate unavailable";
  return "Unknown / unmapped identity";
}

function CollectionDesktopRow({ row }: { row: WebsiteCollectionPerformanceRow }) {
  return (
    <tr className="border-t border-white/[0.07]">
      <th scope="row" className="px-3 py-3 font-medium text-slate-200">
        {row.collectionName || "Unknown / unmapped"}
        {row.state === "unknown" ? <Badge tone="amber" className="ml-2">Unknown</Badge> : null}
      </th>
      <td className="px-3 py-3 text-slate-300">{count(row.collectionViewSessions)}</td>
      <td className="px-3 py-3 text-slate-300">{count(row.productViewSessions)}</td>
      <td className="px-3 py-3 text-slate-300">{percent(row.progressionRate)}</td>
    </tr>
  );
}

function ProductDesktopRow({ row }: { row: WebsiteProductPerformanceRow }) {
  return (
    <tr className="border-t border-white/[0.07]">
      <th scope="row" className="px-3 py-3">
        <p className="font-medium text-slate-200">{row.itemName || "Unknown / unmapped"}</p>
        <p className="mt-1 break-words text-xs font-normal text-slate-500">{productIdentityDescription(row)}</p>
      </th>
      <td className="px-3 py-3 text-slate-300">{row.itemCategory || "Unknown"}</td>
      <td className="px-3 py-3 text-slate-300">{count(row.productViewSessions)}</td>
      <td className="px-3 py-3 text-slate-300">{count(row.addToCartSessions)}</td>
      <td className="px-3 py-3 text-slate-300">{percent(row.viewToCartRate)}</td>
    </tr>
  );
}

function AcquisitionDesktopRow({ row }: { row: WebsiteAcquisitionRow }) {
  return (
    <tr className="border-t border-white/[0.07]">
      <th scope="row" className="px-3 py-3 font-medium text-slate-200">
        <span className="block">{row.utmSource || "Unknown"} / {row.utmMedium || "Unknown"}</span>
        <span className="mt-1 block text-xs font-normal text-slate-500">{row.utmCampaign || "Unknown campaign"}</span>
      </th>
      <td className="max-w-56 px-3 py-3">
        <p className="truncate text-slate-300" title={row.landingPath || "Unknown"}>{row.landingPath || "Unknown"}</p>
        <p className="mt-1 truncate text-xs text-slate-500" title={row.referrerHost || "Unknown"}>
          {row.referrerHost || "Unknown referrer"}
        </p>
      </td>
      <td className="px-3 py-3 text-slate-300">{count(row.sessions)}</td>
      <td className="px-3 py-3 text-slate-300">{count(row.productIntentSessions)}</td>
      <td className="px-3 py-3 text-slate-300">
        {row.checkoutSessions === null ? "—" : count(row.checkoutSessions)}
      </td>
      <td className="px-3 py-3 text-slate-300">{percent(row.visitToCheckoutRate)}</td>
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
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">Recomputed filters</p>
            <h2 className="mt-1 text-lg font-semibold text-[#f5f2eb]">Storefront segment and acquisition</h2>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              Filters rerun the first-party funnel; they do not filter only the tables below.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" className="min-h-11">Apply filters</Button>
            <LinkButton href={clearHref} variant="ghost" className="min-h-11">Clear</LinkButton>
          </div>
        </div>

        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-slate-400">
            Journey segment
            <select
              name="segment"
              defaultValue={query.segment}
              className="h-11 min-w-0 rounded-lg border border-white/10 bg-slate-950/90 px-3 text-sm text-slate-100"
            >
              <option value="all">All storefront</option>
              <option value="ready-made">Ready-made</option>
              <option value="builder">Build Your Own</option>
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-slate-400">
            Device category
            <select
              name="device"
              defaultValue={query.device}
              className="h-11 min-w-0 rounded-lg border border-white/10 bg-slate-950/90 px-3 text-sm text-slate-100"
            >
              <option value="all">All devices</option>
              {optionValues(query.device === "all" ? "" : query.device, overview.filterOptions.devices).map((value) => (
                <option key={value} value={value}>{value === "unknown" ? "Unknown" : value === "bot" ? "Bot" : value}</option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-slate-400">
            UTM source
            <select
              name="utm_source"
              defaultValue={query.utm_source}
              className="h-11 min-w-0 rounded-lg border border-white/10 bg-slate-950/90 px-3 text-sm text-slate-100"
            >
              <option value="">All UTM sources</option>
              {optionValues(query.utm_source, overview.filterOptions.utmSources).map((value) => (
                <option key={value} value={value}>{value || "Unknown"}</option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-slate-400">
            UTM medium
            <select
              name="utm_medium"
              defaultValue={query.utm_medium}
              className="h-11 min-w-0 rounded-lg border border-white/10 bg-slate-950/90 px-3 text-sm text-slate-100"
            >
              <option value="">All UTM media</option>
              {optionValues(query.utm_medium, overview.filterOptions.utmMediums).map((value) => (
                <option key={value} value={value}>{value || "Unknown"}</option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-slate-400">
            UTM campaign
            <select
              name="utm_campaign"
              defaultValue={query.utm_campaign}
              className="h-11 min-w-0 rounded-lg border border-white/10 bg-slate-950/90 px-3 text-sm text-slate-100"
            >
              <option value="">All campaigns</option>
              {optionValues(query.utm_campaign, overview.filterOptions.utmCampaigns).map((value) => (
                <option key={value} value={value}>{value || "Unknown"}</option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-slate-400">
            Landing path
            <select
              name="landing_path"
              defaultValue={query.landing_path}
              className="h-11 min-w-0 rounded-lg border border-white/10 bg-slate-950/90 px-3 text-sm text-slate-100"
            >
              <option value="">All landing paths</option>
              {optionValues(query.landing_path, overview.filterOptions.landingPaths).map((value) => (
                <option key={value} value={value}>{value || "Unknown"}</option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-slate-400">
            Referrer host
            <select
              name="referrer_host"
              defaultValue={query.referrer_host}
              className="h-11 min-w-0 rounded-lg border border-white/10 bg-slate-950/90 px-3 text-sm text-slate-100"
            >
              <option value="">All referrers</option>
              {optionValues(query.referrer_host, overview.filterOptions.referrerHosts).map((value) => (
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
      className="flex items-center justify-between gap-3 border-t border-white/[0.08] pt-3"
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
      <p className="text-center text-sm text-slate-400">
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
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">Discovery and intent</p>
        <h2 id="storefront-performance-title" className="mt-1 text-xl font-semibold text-[#f5f2eb]">
          Collection and product performance
        </h2>
      </div>

      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <GlassPanel className="overflow-hidden">
          <div className="border-b border-white/[0.08] p-4">
            <h3 className="font-semibold text-slate-100">Collection discovery</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">Only provable collection-to-product session progression.</p>
          </div>
          <div
            className="hidden overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-300 lg:block"
            role="region"
            aria-label="Scrollable collection performance table"
            tabIndex={0}
          >
            <table className="w-full min-w-[34rem] text-left text-sm">
              <caption className="sr-only">Collection view and product progression sessions</caption>
              <thead className="text-xs uppercase tracking-[0.12em] text-slate-500">
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
              <article key={row.key} className="rounded-lg border border-white/[0.08] bg-black/15 p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-slate-200">{row.collectionName || "Unknown / unmapped"}</p>
                  {row.state === "unknown" ? <Badge tone="amber">Unknown</Badge> : null}
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-slate-500">Views</dt><dd className="mt-1 text-slate-200">{count(row.collectionViewSessions)}</dd></div>
                  <div><dt className="text-slate-500">Product</dt><dd className="mt-1 text-slate-200">{count(row.productViewSessions)}</dd></div>
                  <div><dt className="text-slate-500">Rate</dt><dd className="mt-1 text-slate-200">{percent(row.progressionRate)}</dd></div>
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
          <div className="border-b border-white/[0.08] p-4">
            <h3 className="font-semibold text-slate-100">Product intent</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">View-to-cart rates require a stable shared item identity.</p>
          </div>
          <div
            className="hidden overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-300 lg:block"
            role="region"
            aria-label="Scrollable product performance table"
            tabIndex={0}
          >
            <table className="w-full min-w-[42rem] text-left text-sm">
              <caption className="sr-only">Product view and add-to-cart session performance</caption>
              <thead className="text-xs uppercase tracking-[0.12em] text-slate-500">
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
              <article key={row.key} className="rounded-lg border border-white/[0.08] bg-black/15 p-3">
                <p className="font-medium text-slate-200">{row.itemName || "Unknown / unmapped"}</p>
                <p className="mt-1 break-words text-xs text-slate-500">{productIdentityDescription(row)}</p>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-slate-500">Views</dt><dd className="mt-1 text-slate-200">{count(row.productViewSessions)}</dd></div>
                  <div><dt className="text-slate-500">Cart</dt><dd className="mt-1 text-slate-200">{count(row.addToCartSessions)}</dd></div>
                  <div><dt className="text-slate-500">Rate</dt><dd className="mt-1 text-slate-200">{percent(row.viewToCartRate)}</dd></div>
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
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">Acquisition context</p>
        <h2 id="storefront-acquisition-title" className="mt-1 text-xl font-semibold text-[#f5f2eb]">
          Acquisition and device
        </h2>
        <p className="mt-1 text-sm leading-6 text-slate-400">
          Normalized first-party UTM, landing-path, referrer-host, and device fields. Unknown remains visible.
        </p>
      </div>

      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.5fr)]">
        <GlassPanel className="overflow-hidden">
          <div
            className="hidden overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-300 lg:block"
            role="region"
            aria-label="Scrollable acquisition performance table"
            tabIndex={0}
          >
            <table className="w-full min-w-[52rem] text-left text-sm">
              <caption className="sr-only">Acquisition session and checkout performance</caption>
              <thead className="text-xs uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2.5">UTM</th>
                  <th scope="col" className="px-3 py-2.5">Landing / referrer</th>
                  <th scope="col" className="px-3 py-2.5">Sessions</th>
                  <th scope="col" className="px-3 py-2.5">Intent</th>
                  <th scope="col" className="px-3 py-2.5">Checkout</th>
                  <th scope="col" className="px-3 py-2.5">Rate</th>
                </tr>
              </thead>
              <tbody>{overview.acquisition.rows.map((row) => <AcquisitionDesktopRow key={row.key} row={row} />)}</tbody>
            </table>
          </div>
          <div className="grid gap-2 p-3 lg:hidden">
            {overview.acquisition.rows.map((row) => (
              <article key={row.key} className="rounded-lg border border-white/[0.08] bg-black/15 p-3">
                <p className="font-medium text-slate-200">
                  {row.utmSource || "Unknown"} / {row.utmMedium || "Unknown"}
                </p>
                <p className="mt-1 break-words text-xs text-slate-500">{row.utmCampaign || "Unknown campaign"}</p>
                <p className="mt-2 break-words text-xs text-slate-400">{row.landingPath || "Unknown landing path"}</p>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-slate-500">Sessions</dt><dd className="mt-1 text-slate-200">{count(row.sessions)}</dd></div>
                  <div>
                    <dt className="text-slate-500">Checkout</dt>
                    <dd className="mt-1 text-slate-200">
                      {row.checkoutSessions === null ? "—" : count(row.checkoutSessions)}
                    </dd>
                  </div>
                  <div><dt className="text-slate-500">Rate</dt><dd className="mt-1 text-slate-200">{percent(row.visitToCheckoutRate)}</dd></div>
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
          <h3 className="font-semibold text-slate-100">Device category</h3>
          <div className="mt-3 grid gap-2">
            {overview.devices.map((row) => (
              <div key={row.device} className="rounded-lg border border-white/[0.08] bg-black/15 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="capitalize text-sm font-medium text-slate-200">{row.device}</p>
                  <p className="text-lg font-semibold text-white">{count(row.sessions)}</p>
                </div>
                <p className="mt-1 text-xs text-slate-500">
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
    <details className="group glass rounded-2xl" data-testid="storefront-quality">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-slate-200">Data quality and reconciliation</p>
          <p className="mt-0.5 text-xs text-slate-500">Sequence ambiguity, unmapped events, and like-for-like daily rollup checks</p>
        </div>
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
      </summary>
      {unavailable ? (
        <div className="border-t border-white/[0.08] p-4" role="status">
          <p className="text-sm font-medium text-slate-200">Quality diagnostics unavailable</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            {overview.dataState === "pre_coverage"
              ? "This range predates Website tracking coverage, so zeros would be misleading."
              : "Diagnostics require exactly one available authoritative Website source."}
          </p>
        </div>
      ) : (
      <div className="grid gap-4 border-t border-white/[0.08] p-4 lg:grid-cols-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Sequence policy</h3>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {count(equalTime)} co-timed session progressions were excluded from strict ordering; {count(unsequenced)} out-of-order or skipped-stage signals remain outside the monotonic funnel.
          </p>
          <p className="mt-2 text-xs text-slate-500">{count(quality.duplicateDeliveriesRemoved)} duplicate deliveries removed.</p>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Unknown and invalid</h3>
          <ul className="mt-2 grid gap-1.5 text-sm text-slate-300">
            {quality.unknownEvents.map((item) => (
              <li key={item.eventName}>{item.eventName || "Unknown event"} · {count(item.events)}</li>
            ))}
            {quality.invalidPropertyEvents.map((item) => (
              <li key={`invalid-${item.eventName}`}>{item.eventName || "Unknown event"} invalid properties · {count(item.events)}</li>
            ))}
            {quality.unknownEvents.length === 0 && quality.invalidPropertyEvents.length === 0
              ? <li className="text-slate-500">No unmapped event diagnostics in this selection.</li>
              : null}
          </ul>
          {quality.unknownEventTotalRows > quality.unknownEvents.length ? (
            <p className="mt-2 text-xs text-slate-500">
              Showing {count(quality.unknownEvents.length)} of {count(quality.unknownEventTotalRows)} unknown event names.
            </p>
          ) : null}
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Raw vs daily aggregate</h3>
          <p className="mt-2 text-sm leading-6 text-slate-300">{overview.reconciliation.note}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div><dt className="text-slate-500">Completed-day raw page views</dt><dd className="mt-1 text-slate-200">{count(overview.reconciliation.rawPageViews)}</dd></div>
            <div><dt className="text-slate-500">Daily page views</dt><dd className="mt-1 text-slate-200">{overview.reconciliation.dailyPageViews === null ? "—" : count(overview.reconciliation.dailyPageViews)}</dd></div>
            <div><dt className="text-slate-500">Completed-day raw custom events</dt><dd className="mt-1 text-slate-200">{count(overview.reconciliation.rawCustomEvents)}</dd></div>
            <div><dt className="text-slate-500">Daily custom events</dt><dd className="mt-1 text-slate-200">{overview.reconciliation.dailyCustomEvents === null ? "—" : count(overview.reconciliation.dailyCustomEvents)}</dd></div>
          </dl>
          <p className="mt-2 text-xs leading-5 text-slate-500">Period-distinct visitors and sessions are not compared with summed daily distinct counts.</p>
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
