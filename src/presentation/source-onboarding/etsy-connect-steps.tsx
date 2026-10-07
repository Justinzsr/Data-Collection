"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy, ExternalLink, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { ETSY_FIELDS } from "@/collection/connectors/etsy/constants";
import { ETSY_CALLBACK_PATH, etsyOAuthStartPath } from "@/collection/connectors/etsy/paths";
import { Button, LinkButton } from "@/presentation/components/ui/button";
import { CredentialForm } from "@/presentation/source-onboarding/credential-form";
import { cn } from "@/presentation/components/ui/utils";

const ETSY_APP_KEY_FIELDS: string[] = [ETSY_FIELDS.keystring, ETSY_FIELDS.sharedSecret];

function subscribeToNothing() {
  return () => {};
}

/** The site's own address, which is where Etsy must send the seller back. Null while rendering on the server. */
function useOrigin() {
  return useSyncExternalStore(subscribeToNothing, () => window.location.origin, () => null);
}

function StepMarker({ step, done }: { step: number; done: boolean }) {
  return (
    <span
      className={cn(
        "grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold tabular",
        done ? "bg-positive-fill/14 text-positive" : "bg-tint/12 text-tint-text",
      )}
      aria-hidden="true"
    >
      {done ? <Check className="h-4 w-4" /> : step}
    </span>
  );
}

/**
 * The three things an Etsy connection needs, in order: the callback URL on the
 * seller's Etsy app, that app's keys (encrypted on the server), and approval on
 * Etsy. Used after adding an Etsy source and on its source page.
 */
export function EtsyConnectSteps({
  sourceId,
  dataSpaceSlug,
  returnPath,
  connected,
  initialKeysSaved,
}: {
  sourceId: string;
  dataSpaceSlug: string;
  returnPath: string;
  connected: boolean;
  initialKeysSaved: boolean;
}) {
  const origin = useOrigin();
  const [keysSaved, setKeysSaved] = useState(initialKeysSaved);
  const callbackUrl = origin ? `${origin}${ETSY_CALLBACK_PATH}` : null;
  const startHref = etsyOAuthStartPath({ sourceId, dataSpaceSlug, returnPath });

  async function copyCallbackUrl() {
    if (!callbackUrl) return;
    try {
      await navigator.clipboard.writeText(callbackUrl);
      toast.success("Callback URL copied");
    } catch {
      toast.error("Couldn't copy the URL. Select it and copy it instead.");
    }
  }

  return (
    <ol className="grid min-w-0 gap-5" data-testid="etsy-connect-steps">
      <li className="flex min-w-0 gap-3">
        <StepMarker step={1} done={false} />
        <div className="grid min-w-0 flex-1 gap-2.5">
          <div>
            <h3 className="text-[15px] font-semibold leading-7 text-label">Add this callback URL to your Etsy app</h3>
            <p className="text-sm leading-6 text-label-secondary">
              In Etsy&apos;s developer portal, open your app (or create one for your shop) and add the URL exactly as shown.
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 break-all rounded-xl bg-fill px-3 py-2.5 font-mono text-xs leading-5 text-label" data-testid="etsy-callback-url">
              {callbackUrl ?? ETSY_CALLBACK_PATH}
            </code>
            <Button type="button" variant="secondary" onClick={copyCallbackUrl} disabled={!callbackUrl} className="shrink-0">
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy URL
            </Button>
          </div>
          <a
            href="https://www.etsy.com/developers/your-apps"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-full text-sm font-medium text-tint-text hover:underline focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-tint/30 sm:min-h-8"
          >
            Open your Etsy apps
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>
      </li>

      <li className="flex min-w-0 gap-3">
        <StepMarker step={2} done={keysSaved} />
        <div className="grid min-w-0 flex-1 gap-2.5">
          <div>
            <h3 className="text-[15px] font-semibold leading-7 text-label">Save the app&apos;s keystring and shared secret</h3>
            <p className="text-sm leading-6 text-label-secondary">Both are on your app&apos;s page on Etsy. They&apos;re encrypted on the server and never shown again.</p>
          </div>
          <CredentialForm
            sourceId={sourceId}
            dataSpaceSlug={dataSpaceSlug}
            title="Etsy app keys"
            onSavedChange={(fieldKeys) => setKeysSaved(ETSY_APP_KEY_FIELDS.every((key) => fieldKeys.includes(key)))}
          />
        </div>
      </li>

      <li className="flex min-w-0 gap-3">
        <StepMarker step={3} done={connected} />
        <div className="grid min-w-0 flex-1 gap-2.5">
          <div>
            <h3 className="text-[15px] font-semibold leading-7 text-label">Approve read-only access on Etsy</h3>
            <p className="text-sm leading-6 text-label-secondary">
              Etsy asks you to allow reading your shop, listings, and orders. Nothing can be listed, changed, or sent from here.
            </p>
          </div>
          {keysSaved ? (
            <LinkButton href={startHref} variant={connected ? "secondary" : "primary"} className="w-full sm:w-fit">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              {connected ? "Reconnect Etsy" : "Connect Etsy"}
            </LinkButton>
          ) : (
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              <Button type="button" variant="primary" disabled className="w-full sm:w-fit" aria-describedby={`etsy-connect-hint-${sourceId}`}>
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                Connect Etsy
              </Button>
              <p id={`etsy-connect-hint-${sourceId}`} className="text-xs text-[var(--muted)]">Save both keys first.</p>
            </div>
          )}
        </div>
      </li>
    </ol>
  );
}
