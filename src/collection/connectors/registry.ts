import type {
  ConnectorDefinition,
  ConnectorSourceTypeDefinition,
  DetectionResult,
} from "@/collection/connectors/types";
import type { Source, SourceStatus, SourceTypeKey } from "@/storage/db/schema";
import { supabaseConnector } from "@/collection/connectors/supabase/connector";
import { websiteConnector } from "@/collection/connectors/website/connector";
import { vercelWebAnalyticsDrainConnector } from "@/collection/connectors/vercel-web-analytics-drain/connector";
import {
  customApiConnector,
  customCsvConnector,
  vercelProjectConnector,
} from "@/collection/connectors/future-connectors";
import { shopifyConnector } from "@/collection/connectors/shopify/connector";
import { instagramConnector } from "@/collection/connectors/instagram/connector";
import { metaAdsConnector } from "@/collection/connectors/meta-ads/connector";
import { tiktokConnector } from "@/collection/connectors/tiktok/connector";
import { xiaohongshuConnector } from "@/collection/connectors/xiaohongshu/connector";

export const connectorRegistry: ConnectorDefinition[] = [
  vercelWebAnalyticsDrainConnector,
  supabaseConnector,
  vercelProjectConnector,
  shopifyConnector,
  tiktokConnector,
  instagramConnector,
  metaAdsConnector,
  customCsvConnector,
  customApiConnector,
  xiaohongshuConnector,
  websiteConnector,
];

export function getConnector(key: SourceTypeKey): ConnectorDefinition {
  const connector = connectorRegistry.find((item) => item.key === key);
  if (!connector) throw new Error(`Unknown connector: ${key}`);
  return connector;
}

export function getConnectorUnavailableReason(connector: ConnectorDefinition): string | null {
  if (connector.availability === "planned") {
    return `${connector.displayName} is planned and does not support live connections, connection tests, or sync yet.`;
  }
  return null;
}

export function getInitialSourceStatus(
  connector: ConnectorDefinition,
  databaseConfigured: boolean,
): SourceStatus {
  const needsCredentials =
    connector.requiredFields.some((field) => field.required) || connector.key === "supabase";

  if (needsCredentials) return "needs_credentials";
  if (connector.key === "website" && databaseConfigured) return "healthy";
  return "demo";
}

export function getSourceOperationBlockReason(
  source: Pick<Source, "source_type_key" | "status">,
): string | null {
  const connector = getConnector(source.source_type_key);
  const unavailable = getConnectorUnavailableReason(connector);
  if (unavailable) return unavailable;
  if (source.status === "disabled") return "This source is disabled and cannot be tested or synced.";
  return null;
}

export function getCredentialSetupBlockReason(
  connector: ConnectorDefinition,
  credentialKeys: Iterable<string>,
): string | null {
  const savedKeys = new Set(credentialKeys);
  const missing = connector.requiredFields.filter((field) => field.required && !savedKeys.has(field.key));
  if (missing.length === 0) return null;
  return `Add required credentials before testing or syncing: ${missing.map((field) => field.label).join(", ")}.`;
}

export function detectSource(input: string): DetectionResult[] {
  const value = input.trim();
  if (!value) return [];
  return connectorRegistry
    .map((connector) => connector.detect(value))
    .filter((result): result is DetectionResult => Boolean(result))
    .sort((a, b) => b.confidence - a.confidence);
}

export function bestDetection(input: string): DetectionResult | null {
  return detectSource(input)[0] ?? null;
}

export function listSourceTypes(): ConnectorSourceTypeDefinition[] {
  const now = new Date().toISOString();
  return connectorRegistry.map((connector) => ({
    key: connector.key,
    display_name: connector.displayName,
    description: connector.description,
    category: connector.category,
    icon: connector.icon,
    availability: connector.availability,
    setup_kind: connector.setupKind,
    default_sync_mode: connector.defaultSyncMode,
    capabilities: connector.capabilities,
    setup_instructions: connector.getSetupInstructions(),
    url_patterns: connector.urlPatterns.map((pattern) => pattern.source),
    required_fields: connector.requiredFields,
    optional_fields: connector.optionalFields,
    supported_metrics: connector.getMetricDefinitions().map((metric) => metric.key),
    auth_type: connector.authType,
    docs_url: connector.docsUrl ?? null,
    enabled: connector.availability === "live",
    created_at: now,
    updated_at: now,
  }));
}
