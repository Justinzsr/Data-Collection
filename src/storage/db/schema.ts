export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = Record<string, JsonValue>;

export type SourceTypeKey =
  | "website"
  | "supabase"
  | "vercel_project"
  | "shopify"
  | "tiktok"
  | "instagram"
  | "custom_api"
  | "custom_csv";

export type SourceStatus =
  | "demo"
  | "needs_credentials"
  | "healthy"
  | "warning"
  | "error"
  | "disabled";

export type SyncMode = "webhook" | "hourly" | "manual" | "hybrid";
export type SyncTrigger = "webhook" | "cron" | "manual" | "initial" | "retry";
export type SyncRunStatus = "queued" | "running" | "success" | "error" | "skipped";
export type ConnectorEventSeverity = "info" | "warning" | "error";

export interface CredentialField {
  key: string;
  label: string;
  description: string;
  required: boolean;
  secret: boolean;
  type?: "text" | "password" | "url" | "select";
  placeholder?: string;
}

export interface SourceTypeDefinition {
  key: SourceTypeKey;
  display_name: string;
  description: string;
  category: string;
  icon: string | null;
  url_patterns: string[];
  required_fields: CredentialField[];
  optional_fields: CredentialField[];
  supported_metrics: string[];
  auth_type: string;
  docs_url: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Source {
  id: string;
  source_type_key: SourceTypeKey;
  display_name: string;
  input_url: string | null;
  normalized_url: string | null;
  external_account_id: string | null;
  account_name: string | null;
  status: SourceStatus;
  sync_mode: SyncMode;
  sync_frequency_minutes: number;
  supports_webhook: boolean;
  webhook_url: string | null;
  webhook_secret_hint: string | null;
  last_manual_sync_at: string | null;
  last_cron_sync_at: string | null;
  last_webhook_sync_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  next_sync_at: string | null;
  metadata: JsonRecord;
  created_at: string;
  updated_at: string;
}

export interface SourceCredential {
  id: string;
  source_id: string;
  field_key: string;
  encrypted_value: string;
  iv: string;
  auth_tag: string;
  value_hint: string | null;
  key_version: number;
  created_at: string;
  updated_at: string;
}

export interface SyncRun {
  id: string;
  source_id: string | null;
  source_type_key: SourceTypeKey | null;
  trigger: SyncTrigger;
  status: SyncRunStatus;
  idempotency_key: string | null;
  lock_key: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  records_fetched: number;
  records_inserted: number;
  records_updated: number;
  metrics_upserted: number;
  error_message: string | null;
  error_stack: string | null;
  cursor_before: JsonRecord | null;
  cursor_after: JsonRecord | null;
  metadata: JsonRecord;
  created_at: string;
}

export interface SourceLock {
  source_id: string;
  locked_by_sync_run_id: string;
  lock_key: string;
  acquired_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface RawIngestion {
  id: string;
  source_id: string | null;
  source_type_key: SourceTypeKey;
  external_id: string | null;
  fetched_at: string;
  payload: JsonRecord;
  payload_hash: string;
  status: "stored" | "duplicate" | "error";
  cursor: JsonRecord | null;
  created_at: string;
}

export interface MetricDaily {
  id: string;
  date: string;
  source_id: string | null;
  source_type_key: SourceTypeKey;
  metric_key: string;
  metric_value: number;
  unit: string;
  dimensions: JsonRecord;
  dimensions_hash: string;
  created_at: string;
  updated_at: string;
}

export interface ContentItem {
  id: string;
  source_id: string;
  source_type_key: SourceTypeKey;
  external_content_id: string;
  content_type: string;
  title: string | null;
  caption: string | null;
  url: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  metadata: JsonRecord;
  created_at: string;
  updated_at: string;
}

export interface ContentMetric {
  id: string;
  date: string;
  content_item_id: string;
  source_id: string;
  source_type_key: SourceTypeKey;
  metric_key: string;
  metric_value: number;
  unit: string;
  dimensions: JsonRecord;
  created_at: string;
  updated_at: string;
}

export interface WebEvent {
  id: string;
  source_id: string | null;
  public_tracking_key: string | null;
  anonymous_id: string;
  session_id: string;
  user_id: string | null;
  event_name: string;
  path: string;
  url: string;
  referrer: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  country: string | null;
  device_type: string | null;
  properties: JsonRecord;
  occurred_at: string;
  created_at: string;
}

export interface MetricDefinition {
  key: string;
  display_name: string;
  description: string;
  source_type_key: SourceTypeKey | null;
  category: string;
  unit: string;
  higher_is_better: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConnectorEvent {
  id: string;
  source_id: string | null;
  event_type: string;
  severity: ConnectorEventSeverity;
  message: string;
  metadata: JsonRecord;
  created_at: string;
}

export interface DemoWorkspace {
  sources: Source[];
  credentials: SourceCredential[];
  syncRuns: SyncRun[];
  sourceLocks: SourceLock[];
  rawIngestions: RawIngestion[];
  metricsDaily: MetricDaily[];
  contentItems: ContentItem[];
  contentMetrics: ContentMetric[];
  webEvents: WebEvent[];
  metricDefinitions: MetricDefinition[];
  connectorEvents: ConnectorEvent[];
}
