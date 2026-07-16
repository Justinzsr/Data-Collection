import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, prefetch, ...props }: { children: ReactNode; prefetch?: boolean | "auto" | null; href: string }) =>
    createElement("a", {
      ...props,
      "data-prefetch": prefetch === undefined ? "default" : String(prefetch),
    }, children),
}));

import { LinkButton } from "@/presentation/components/ui/button";

describe("LinkButton", () => {
  it("disables Next prefetch for API action links", () => {
    const markup = renderToStaticMarkup(
      <LinkButton href="/api/oauth/meta-ads/start?instagramSourceId=source-1">Connect Meta Ads</LinkButton>,
    );

    expect(markup).toContain('data-prefetch="false"');
  });

  it("keeps Next's default prefetch behavior for dashboard page links", () => {
    const markup = renderToStaticMarkup(
      <LinkButton href="/w/moonarq/dashboard">Overview</LinkButton>,
    );

    expect(markup).toContain('data-prefetch="default"');
  });

  it("preserves an explicit prefetch override", () => {
    const markup = renderToStaticMarkup(
      <LinkButton href="/api/read-only-preview" prefetch="auto">Preview</LinkButton>,
    );

    expect(markup).toContain('data-prefetch="auto"');
  });
});
