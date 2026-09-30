function Shimmer({ className }: { className: string }) {
  return <div className={`glass animate-pulse motion-reduce:animate-none ${className}`} />;
}

export default function DashboardLoading() {
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1600px] gap-4" role="status" aria-live="polite" aria-label="Loading dashboard">
      <span className="sr-only">Loading…</span>
      <Shimmer className="h-40 rounded-[28px]" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Shimmer className="h-32 rounded-[22px]" />
        <Shimmer className="h-32 rounded-[22px]" />
        <Shimmer className="h-32 rounded-[22px]" />
        <Shimmer className="h-32 rounded-[22px]" />
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <Shimmer className="h-80 rounded-3xl" />
        <Shimmer className="h-80 rounded-3xl" />
      </div>
    </div>
  );
}
