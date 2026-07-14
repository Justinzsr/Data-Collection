import type {
  CredentialField,
  JsonRecord,
  MetricDefinition,
  Source,
  SourceTypeDefinition,
  SourceTypeKey,
  SyncMode,
  SyncTrigger,
} from "@/storage/db/schema";
import type { WebsiteEventIngestionInput } from "@/collection/tracking/website-event-ingestion";

export type ConnectorAvailability = "live" | "planned";

export type ConnectorSetupKind =
  | "oauth"
  | "credentials"
  | "webhook"
  | "tracker"
  | "hybrid"
  | "planned";

export interface DetectionResult {
  sourceTypeKey: SourceTypeKey;
  displayName: string;
  availability: ConnectorAvailability;
  setupKind: ConnectorSetupKind;
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
  webhookPayload?: JsonRecord | null;
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
  caption?: string | null;
  url?: string | null;
  thumbnailUrl?: string | null;
  publishedAt?: string | null;
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
  webEvents?: WebsiteEventIngestionInput[];
  skippedReason?: string;
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
  availability: ConnectorAvailability;
  setupKind: ConnectorSetupKind;
  defaultSyncMode: SyncMode;
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

export interface ConnectorSourceTypeDefinition extends SourceTypeDefinition {
  availability: ConnectorAvailability;
  setup_kind: ConnectorSetupKind;
  default_sync_mode: SyncMode;
  capabilities: ConnectorCapabilities;
  setup_instructions: string[];
}
