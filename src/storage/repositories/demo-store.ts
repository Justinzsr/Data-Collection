import type { DemoWorkspace } from "@/storage/db/schema";
import { createDemoWorkspace } from "@/storage/seed/demo-data";

declare global {
  var __MOONARQ_DEMO_STORE__: DemoWorkspace | undefined;
}

export function getDemoStore(): DemoWorkspace {
  if (!globalThis.__MOONARQ_DEMO_STORE__) {
    globalThis.__MOONARQ_DEMO_STORE__ = createDemoWorkspace();
  }
  return globalThis.__MOONARQ_DEMO_STORE__;
}

export function resetDemoStore(): DemoWorkspace {
  globalThis.__MOONARQ_DEMO_STORE__ = createDemoWorkspace();
  return globalThis.__MOONARQ_DEMO_STORE__;
}
