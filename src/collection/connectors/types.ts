import type {
  CredentialField,
  JsonRecord,
  MetricDefinition,
  Source,
  SourceTypeKey,
  SyncTrigger,
} from "@/storage/db/schema";

export interface DetectionResult {
  sourceTypeKey: SourceTypeKey;
  displayName: string;
  confidence: number;
  normalizedUrl: string | null;
  externalAccountId?: string | null;
  accountName?: string | null;
  reasons: string[];
  requiredSetup: string[];
  possibleMetrics: string[];
  demoAvailable: boolean;
}

export interface ConnectorCapabilities {
  supportsWebhook: boolean;
  supportsPolling: boolean;
  supportsManualSync: boolean;
  recommendedSyncFrequencyMinutes: number;
  canBackfill: boolean;
  canTestConnection: boolean;
}

export interface ConnectorContext {
  source: Source;
  credentials: Record<string, string>;
  isDemoMode: boolean;
}

export interface SyncContext extends ConnectorContext {
  trigger: SyncTrigger;
  cursor?: JsonRecord | null;
}

export interface RawPayload {
  externalId?: string | null;
  fetchedAt: string;
  payload: JsonRecord;
  payloadHash?: string;
  status?: "stored" | "duplicate" | "error";
  cursor?: JsonRecord | null;
}

export interface NormalizedMetric {
  date: string;
  sourceId: string | null;
  sourceTypeKey: SourceTypeKey;
  metricKey: string;
  metricValue: number;
  unit: string;
  dimensions?: JsonRecord;
}

export interface NormalizedContentMetric {
  date: string;
  sourceId: string;
  sourceTypeKey: SourceTypeKey;
  externalContentId: string;
  contentType: string;
  title?: string | null;
  url?: string | null;
  metricKey: string;
  metricValue: number;
  unit: string;
  dimensions?: JsonRecord;
}

export interface NormalizedMetricBundle {
  metrics: NormalizedMetric[];
  contentMetrics?: NormalizedContentMetric[];
}

export interface SyncResult {
  rawPayloads: RawPayload[];
  cursorAfter?: JsonRecord | null;
  recordsFetched: number;
  recordsInserted?: number;
  recordsUpdated?: number;
  message: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  status: "demo" | "connected" | "needs_credentials" | "unsupported" | "error";
  message: string;
  details?: JsonRecord;
}

export interface ConnectorDefinition {
  key: SourceTypeKey;
  displayName: string;
  description: string;
  category: string;
  icon: string;
  urlPatterns: RegExp[];
  requiredFields: CredentialField[];
  optionalFields: CredentialField[];
  authType: string;
  docsUrl?: string | null;
  capabilities: ConnectorCapabilities;
  detect(inputUrl: string): DetectionResult | null;
  testConnection(ctx: ConnectorContext): Promise<ConnectionTestResult>;
  sync(ctx: SyncContext): Promise<SyncResult>;
  normalize(rawPayloads: RawPayload[], source: Source): Promise<NormalizedMetricBundle>;
  getMetricDefinitions(): MetricDefinition[];
  getSetupInstructions(source?: Source): string[];
}
