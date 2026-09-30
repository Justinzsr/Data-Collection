import { Compass } from "lucide-react";
import { LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel } from "@/presentation/components/ui/panel";
import { IconTile } from "@/presentation/components/ui/platform-icon";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <GlassPanel className="w-full max-w-md rounded-[32px] p-8 text-center">
        <IconTile icon={Compass} tone="tint" size="lg" className="mx-auto" />
        <h1 className="mt-5 text-[26px] font-bold tracking-[-0.028em] text-label">Page not found</h1>
        <p className="mt-2 text-sm leading-6 text-label-secondary">
          This page or workspace does not exist, or it belongs to a data space you cannot open.
        </p>
        <LinkButton href="/w/moonarq/dashboard" variant="primary" className="mt-6 min-h-11 w-full">
          Back to Overview
        </LinkButton>
      </GlassPanel>
    </main>
  );
}
