"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";

export type MetaAdsAccountCandidate = {
  id: string;
  name: string | null;
  accountStatus: number | null;
  currency: string | null;
  timezone: string | null;
};

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text };
  }
}

export function MetaAdsAccountSelector({
  sourceId,
  dataSpaceSlug,
  candidates,
  selectedAccountId,
}: {
  sourceId: string;
  dataSpaceSlug: string;
  candidates: MetaAdsAccountCandidate[];
  selectedAccountId: string | null;
}) {
  const router = useRouter();
  const [selectingId, setSelectingId] = useState<string | null>(null);

  async function selectAccount(account: MetaAdsAccountCandidate) {
    setSelectingId(account.id);
    try {
      const response = await fetch(
        `/api/sources/${encodeURIComponent(sourceId)}/meta-ads-account?dataSpaceSlug=${encodeURIComponent(dataSpaceSlug)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId: account.id }),
        },
      );
      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Could not select the Meta ad account.");
      }
      toast.success("Meta ad account selected", {
        description: `${account.name ?? account.id} was saved for read-only sync.`,
      });
      router.refresh();
    } catch (error) {
      toast.error("Could not select account", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setSelectingId(null);
    }
  }

  if (candidates.length === 0) return null;

  return (
    <div className="mt-4 grid gap-3">
      <div>
        <p className="text-sm font-medium text-white">Choose the Meta ad account to monitor</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          These accounts came directly from the completed OAuth connection. The selection is saved by the server and the OAuth token never reaches this page.
        </p>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {candidates.map((candidate) => {
          const selected = selectedAccountId === candidate.id;
          const loading = selectingId === candidate.id;
          return (
            <div key={candidate.id} className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2">
                  <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{candidate.name ?? "Unnamed Meta ad account"}</p>
                    <p className="mt-1 break-all font-mono text-xs text-slate-500">{candidate.id}</p>
                  </div>
                </div>
                {selected ? <Badge tone="green">selected</Badge> : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
                {candidate.currency ? <Badge>{candidate.currency}</Badge> : null}
                {candidate.timezone ? <Badge className="max-w-full truncate">{candidate.timezone}</Badge> : null}
                {candidate.accountStatus !== null ? <Badge>status {candidate.accountStatus}</Badge> : null}
              </div>
              <Button
                type="button"
                variant={selected ? "secondary" : "primary"}
                className="mt-3 w-full"
                disabled={Boolean(selectingId) || selected}
                onClick={() => selectAccount(candidate)}
              >
                {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : selected ? <Check className="h-4 w-4" /> : null}
                {loading ? "Selecting..." : selected ? "Selected" : "Use this account"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
