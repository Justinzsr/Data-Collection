import type { ConnectorDefinition, DetectionResult } from "@/collection/connectors/types";
import type { SourceTypeDefinition, SourceTypeKey } from "@/storage/db/schema";
import { supabaseConnector } from "@/collection/connectors/supabase/connector";
import { websiteConnector } from "@/collection/connectors/website/connector";
import {
  customApiConnector,
  customCsvConnector,
  instagramConnector,
  shopifyConnector,
  tiktokConnector,
  vercelProjectConnector,
} from "@/collection/connectors/future-connectors";

export const connectorRegistry: ConnectorDefinition[] = [
  supabaseConnector,
  vercelProjectConnector,
  shopifyConnector,
  tiktokConnector,
  instagramConnector,
  customCsvConnector,
  customApiConnector,
  websiteConnector,
];

export function getConnector(key: SourceTypeKey): ConnectorDefinition {
  const connector = connectorRegistry.find((item) => item.key === key);
  if (!connector) throw new Error(`Unknown connector: ${key}`);
  return connector;
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

export function listSourceTypes(): SourceTypeDefinition[] {
  const now = new Date().toISOString();
  return connectorRegistry.map((connector) => ({
    key: connector.key,
    display_name: connector.displayName,
    description: connector.description,
    category: connector.category,
    icon: connector.icon,
    url_patterns: connector.urlPatterns.map((pattern) => pattern.source),
    required_fields: connector.requiredFields,
    optional_fields: connector.optionalFields,
    supported_metrics: connector.getMetricDefinitions().map((metric) => metric.key),
    auth_type: connector.authType,
    docs_url: connector.docsUrl ?? null,
    enabled: true,
    created_at: now,
    updated_at: now,
  }));
}
