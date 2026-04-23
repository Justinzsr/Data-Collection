import { ShieldCheck } from "lucide-react";
import { LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel } from "@/presentation/components/ui/panel";

export default function LoginPage() {
  const bypass = process.env.DEV_AUTH_BYPASS !== "false";
  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <GlassPanel className="w-full max-w-md p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-cyan-200/20 bg-cyan-300/10">
          <ShieldCheck className="h-6 w-6 text-cyan-100" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-white">MoonArq private login</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Supabase Auth is used when configured. Local development can use DEV_AUTH_BYPASS=true; turn it off before deployment.
        </p>
        <div className="mt-6">
          {bypass ? <LinkButton href="/dashboard" variant="primary">Enter with dev bypass</LinkButton> : <p className="text-sm text-amber-100">Configure Supabase Auth to continue.</p>}
        </div>
      </GlassPanel>
    </main>
  );
}
