"use client";

import { useId, useState, type CSSProperties } from "react";
import {
  ArrowDown, ArrowRight, ArrowUpRight, ChartNoAxesCombined, Check,
  CheckCheck, ChevronRight, CircleHelp, Compass, Database, Globe2,
  Layers3, LayoutDashboard, LockKeyhole, MousePointer2, Plug,
  ShieldCheck, ShoppingBag, Sparkles, Users,
} from "lucide-react";
import { ThemeToggle } from "@/presentation/theme/theme-toggle";
import { platformSeriesColor } from "@/presentation/charts/chart-theme";
import {
  formatDemoCurrency, formatDemoNumber, getDemoPeriod, SAMPLE_CONNECTIONS,
  type DemoPeriod, type DemoView,
} from "./demo-data";
import styles from "./public-preview.module.css";

const VIEWS = [
  { value: "overview", label: "Overview", icon: LayoutDashboard },
  { value: "acquisition", label: "Acquisition", icon: Compass },
  { value: "connections", label: "Connections", icon: Plug },
] as const;

const VIEW_COPY = {
  overview: { title: "Your business, in focus.", description: "From the first visit to the next purchase. See the bigger picture." },
  acquisition: { title: "Every journey starts somewhere.", description: "Understand how people discover your store and what brings them back." },
  connections: { title: "A connected view.", description: "See how your sources come together in one workspace." },
};

function TrendChart({ values, colorKey, label, firstDay }: {
  values: number[]; colorKey: string; label: string; firstDay: number;
}) {
  const gradientId = `sample-trend-${useId().replace(/:/g, "")}`;
  const max = Math.max(...values) * 1.18;
  const points = values.map((value, index) => [
    12 + index / Math.max(values.length - 1, 1) * 696,
    196 - value / max * 176,
  ]);
  const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
  const color = platformSeriesColor(colorKey);

  return (
    <figure className={styles.chart} aria-label={label}>
      <svg viewBox="0 0 720 220" role="img" aria-label={label} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.24" />
            <stop offset="100%" stopColor={color} stopOpacity="0.015" />
          </linearGradient>
        </defs>
        {[32, 86, 141, 196].map((y) => <line key={y} x1="0" x2="720" y1={y} y2={y} stroke="var(--chart-grid)" strokeDasharray="3 6" />)}
        <path d={`${path} L 708 196 L 12 196 Z`} fill={`url(#${gradientId})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <circle cx={points.at(-1)?.[0]} cy={points.at(-1)?.[1]} r="4" fill={color} />
      </svg>
      <figcaption><span>Sample day {firstDay}</span><span>Day {firstDay + Math.floor(values.length / 2)}</span><span>Day 30</span></figcaption>
    </figure>
  );
}

function SampleConnections({ expanded = false }: { expanded?: boolean }) {
  return (
    <section className={`glass ${styles.card} ${expanded ? styles.connectionsExpanded : ""}`} aria-labelledby="demo-connections-title">
      <div className={styles.cardHeading}>
        <div><p className={styles.eyebrow}>Connected ecosystem</p><h2 id="demo-connections-title">Source health</h2></div>
        <span className={styles.subtlePill}>Sample status</span>
      </div>
      <ul className={styles.sourceList}>
        {SAMPLE_CONNECTIONS.map((source) => (
          <li key={source.name}>
            <span className={styles.sourceIcon} style={{ "--source-color": platformSeriesColor(source.icon) } as CSSProperties}>
              {source.icon === "website" ? <Globe2 size={18} /> : source.icon === "shopify" ? <ShoppingBag size={18} /> : source.icon === "instagram" ? <Users size={18} /> : <MousePointer2 size={18} />}
            </span>
            <div className={styles.sourceName}><strong>{source.name}</strong><span>{source.description}</span></div>
            {expanded ? <span className={styles.sourceMode}>{source.mode}</span> : null}
            <span className={styles.healthy}><Check size={12} aria-hidden="true" />{source.status}</span>
          </li>
        ))}
      </ul>
      <p className={styles.cardFootnote}><CircleHelp size={13} aria-hidden="true" />Illustrative connections. No accounts are connected to this demo.</p>
    </section>
  );
}

export function PublicPreview() {
  const [period, setPeriod] = useState<DemoPeriod>(30);
  const [view, setView] = useState<DemoView>("overview");
  const data = getDemoPeriod(period);
  const copy = VIEW_COPY[view];
  const isAcquisition = view === "acquisition";
  const metrics = [
    { label: "Revenue", value: formatDemoCurrency(data.total.revenue), detail: "Gross sample order value", icon: ShoppingBag },
    { label: "Sessions", value: formatDemoNumber(data.total.sessions), detail: "Visits to the demo store", icon: Globe2 },
    { label: "Orders", value: formatDemoNumber(data.total.orders), detail: "Completed sample purchases", icon: CheckCheck },
    { label: "Conversion", value: `${data.conversionRate.toFixed(2)}%`, detail: "Orders ÷ sessions", icon: MousePointer2 },
  ];
  const funnel = [
    { label: "Sessions", value: data.total.sessions },
    { label: "Added to cart", value: data.total.carts },
    { label: "Checkout started", value: data.total.checkouts },
    { label: "Purchased", value: data.total.orders },
  ];

  return (
    <div className={styles.preview} data-public-preview="true">
      <a className={styles.skipLink} href="#demo-main">Skip to demo dashboard</a>
      <header className={styles.topbar}>
        <a href="/demo" className={styles.brand} aria-label="DataHub public demo">
          <span className={styles.brandIcon}><Layers3 size={22} aria-hidden="true" /></span>
          <span>DataHub<span className={styles.brandCaption}>A business command center</span></span>
        </a>
        <div className={styles.topbarActions}>
          <div className={styles.themeToggle}><ThemeToggle /></div>
          <a href="/login" className={styles.signIn}>Sign in<ArrowUpRight size={15} aria-hidden="true" /></a>
        </div>
      </header>

      <div className={styles.workspace}>
        <aside className={`glass-chrome ${styles.sidebar}`} aria-label="Demo workspace">
          <div className={styles.workspaceName}><span className={styles.workspaceIcon}><Sparkles size={18} /></span><span><strong>Demo workspace</strong><small>Product preview</small></span></div>
          <p className={styles.sidebarLabel}>Workspace</p>
          <nav className={styles.navigation} aria-label="Demo navigation">
            {VIEWS.map(({ value, label, icon: Icon }) => <button key={value} type="button" className={view === value ? styles.navActive : ""} aria-pressed={view === value} onClick={() => setView(value)}><Icon size={17} aria-hidden="true" />{label}{view === value ? <ChevronRight size={14} className={styles.navChevron} /> : null}</button>)}
          </nav>
          <div className={styles.sidebarNote}><ShieldCheck size={19} aria-hidden="true" /><p>Made to explore.<br /><span>All data in this workspace is fictional.</span></p></div>
          <div className={styles.sidebarBottom}><LockKeyhole size={15} aria-hidden="true" /><span>Private workspaces require sign-in</span></div>
        </aside>

        <main id="demo-main" className={styles.main}>
          <div className={styles.previewNotice}><span className={styles.demoBadge}><span />Demo · Sample data</span><p>Explore the dashboard. Sign in to access a private workspace.</p></div>
          <div className={styles.mobileWorkspace}><span className={styles.workspaceIcon}><Sparkles size={16} /></span><strong>Demo workspace</strong></div>
          <nav className={`segmented ${styles.mobileNavigation}`} aria-label="Demo navigation on mobile">
            {VIEWS.map(({ value, label }) => <button type="button" key={value} className="segmented-item" aria-pressed={view === value} onClick={() => setView(value)}>{label}</button>)}
          </nav>
          <div className={styles.pageHeading}>
            <div><p className={styles.eyebrow}>The big picture</p><h1>{copy.title}</h1><p className={styles.description}>{copy.description}</p></div>
            {view !== "connections" ? <div className={styles.periodControl}><span>Sample period</span><div className="segmented" role="group" aria-label="Sample period">{([7, 30] as const).map((days) => <button key={days} type="button" className="segmented-item" aria-pressed={period === days} onClick={() => setPeriod(days)}>{days} days</button>)}</div></div> : null}
          </div>

          {view !== "connections" ? <>
            <div className={styles.metrics} aria-label={`${period}-day sample metrics`}>
              {metrics.map(({ label, value, detail, icon: Icon }) => <section key={label} className={`glass ${styles.metric}`}><div className={styles.metricLabel}><span>{label}</span><Icon size={16} aria-hidden="true" /></div><p className={styles.metricValue}>{value}</p><p className={styles.metricDetail}>{detail}</p></section>)}
            </div>

            <div className={styles.primaryGrid}>
              <section className={`glass ${styles.card} ${styles.trendCard}`} aria-labelledby="demo-trend-title">
                <div className={styles.cardHeading}><div><p className={styles.eyebrow}>Performance over time</p><h2 id="demo-trend-title">{isAcquisition ? "Website sessions" : "Revenue trend"}</h2></div><span className={styles.subtlePill}>{period} sample days</span></div>
                <div className={styles.trendHeadline}><strong>{isAcquisition ? formatDemoNumber(data.total.sessions) : formatDemoCurrency(data.total.revenue)}</strong><span>{isAcquisition ? "total visits" : "USD · gross sample sales"}</span></div>
                <TrendChart values={data.days.map((day) => isAcquisition ? day.sessions : day.revenue)} colorKey={isAcquisition ? "website" : "shopify"} label={`${period}-day sample ${isAcquisition ? "sessions" : "revenue"} trend`} firstDay={data.days[0].day} />
                <div className={styles.trendFooter}><span><span className={styles.legendDot} style={{ background: platformSeriesColor(isAcquisition ? "website" : "shopify") }} />{isAcquisition ? "Website sessions" : "Daily revenue"}</span><span>{isAcquisition ? `${formatDemoNumber(Math.round(data.total.sessions / period))} visits / day` : `${formatDemoCurrency(data.averageOrderValue)} avg. order`}</span></div>
              </section>

              <section className={`glass ${styles.card}`} aria-labelledby="demo-funnel-title"><div className={styles.cardHeading}><div><p className={styles.eyebrow}>From visit to value</p><h2 id="demo-funnel-title">Storefront funnel</h2></div><ArrowDown size={17} className={styles.mutedIcon} aria-hidden="true" /></div><ol className={styles.funnel}>{funnel.map((stage, index) => <li key={stage.label}><div className={styles.funnelLabel}><span><small>{String(index + 1).padStart(2, "0")}</small>{stage.label}</span><strong>{formatDemoNumber(stage.value)}</strong></div><div className={styles.funnelTrack}><span style={{ width: `${stage.value / data.total.sessions * 100}%`, minWidth: 5, background: platformSeriesColor("website") }} /></div><p>{index === 0 ? "All sample visits" : `${(stage.value / data.total.sessions * 100).toFixed(1)}% of sessions`}</p></li>)}</ol><div className={styles.funnelSummary}><span>Session-to-order rate</span><strong>{data.conversionRate.toFixed(2)}%<ArrowUpRight size={16} aria-hidden="true" /></strong></div></section>
            </div>

            <div className={styles.secondaryGrid}>
              <section className={`glass ${styles.card}`} aria-labelledby="demo-channels-title"><div className={styles.cardHeading}><div><p className={styles.eyebrow}>Discovery</p><h2 id="demo-channels-title">{isAcquisition ? "Acquisition mix" : "Where visits begin"}</h2></div><Compass size={18} className={styles.mutedIcon} aria-hidden="true" /></div><div className={styles.channelBar} aria-hidden="true">{data.channels.map((channel) => <span key={channel.label} style={{ width: `${channel.sessions / data.total.sessions * 100}%`, background: platformSeriesColor(channel.colorKey) }} />)}</div><ul className={styles.channels}>{data.channels.map((channel) => <li key={channel.label}><span className={styles.channelLabel}><span className={styles.legendDot} style={{ background: platformSeriesColor(channel.colorKey) }} />{channel.label}</span><strong>{formatDemoNumber(channel.sessions)}<small>{Math.round(channel.sessions / data.total.sessions * 100)}%</small></strong></li>)}</ul><p className={styles.cardFootnote}>Sample sessions by acquisition channel.</p></section>
              {isAcquisition ? <section className={`glass ${styles.card} ${styles.insightCard}`} aria-labelledby="demo-insight-title"><span className={styles.insightIcon}><ChartNoAxesCombined size={23} aria-hidden="true" /></span><p className={styles.eyebrow}>Reading this example</p><h2 id="demo-insight-title">Discovery meets conversion.</h2><p>Organic search contributes the largest share of visits in this sample. The funnel shows how those visits progress toward a purchase.</p><div className={styles.insightStats}><div><span>Sample sessions</span><strong>{formatDemoNumber(data.total.sessions)}</strong></div><div><span>Sample purchases</span><strong>{formatDemoNumber(data.total.orders)}</strong></div></div><p className={styles.cardFootnote}>Try a different period to explore the same fictional store.</p></section> : <SampleConnections />}
            </div>
          </> : <>
            <SampleConnections expanded />
            <section className={`glass ${styles.card}`} aria-labelledby="demo-pipeline-title"><div className={styles.cardHeading}><div><p className={styles.eyebrow}>From source to clarity</p><h2 id="demo-pipeline-title">One workspace. A connected view.</h2></div></div><div className={styles.pipeline}>{[{ icon: Plug, title: "Collect", description: "Bring visits, orders, and engagement together." }, { icon: Database, title: "Organize", description: "Keep each workspace and its sources separate." }, { icon: ChartNoAxesCombined, title: "Understand", description: "Turn daily activity into a clear business view." }].map(({ icon: Icon, title, description }) => <div key={title}><Icon size={21} aria-hidden="true" /><h3>{title}</h3><p>{description}</p></div>)}</div></section>
          </>}

          <footer className={styles.footer}><p><LockKeyhole size={14} aria-hidden="true" />You’re viewing fictional sample data. Real workspace data is private.</p><a href="/login">Open your workspace<ArrowRight size={14} aria-hidden="true" /></a></footer>
        </main>
      </div>
    </div>
  );
}
