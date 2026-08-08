import type { JsonValue } from "@/storage/db/schema";

export const WEBSITE_FUNNEL_EVENT_NAMES = Object.freeze([
  "page_view",
  "view_item_list",
  "view_item",
  "add_to_cart",
  "begin_checkout",
  "build_start",
  "build_complete",
  "save_design",
  "email_signup",
] as const);

export type WebsiteFunnelEventName = (typeof WEBSITE_FUNNEL_EVENT_NAMES)[number];

export const WEBSITE_FUNNEL_STAGES = Object.freeze([
  Object.freeze({
    key: "visit",
    label: "Website visit",
    eventNames: Object.freeze(["page_view"] as const),
    previousStageKey: null,
  }),
  Object.freeze({
    key: "product_intent",
    label: "Product intent",
    eventNames: Object.freeze(["view_item", "build_start"] as const),
    previousStageKey: "visit",
  }),
  Object.freeze({
    key: "add_to_cart",
    label: "Added to cart",
    eventNames: Object.freeze(["add_to_cart"] as const),
    previousStageKey: "product_intent",
  }),
  Object.freeze({
    key: "begin_checkout",
    label: "Checkout started",
    eventNames: Object.freeze(["begin_checkout"] as const),
    previousStageKey: "add_to_cart",
  }),
] as const);

export type WebsiteFunnelStageKey = (typeof WEBSITE_FUNNEL_STAGES)[number]["key"];

export const WEBSITE_FUNNEL_EQUAL_TIME_POLICY = Object.freeze({
  key: "strictly_after",
  description:
    "A downstream stage qualifies only when its occurred_at is strictly later than the prior qualifying stage. Equal-time events do not advance the strict sequence and must be counted as ambiguity diagnostics; a later strictly ordered occurrence may still qualify.",
} as const);

const ITEM_FIELDS = Object.freeze([
  "item_id",
  "item_name",
  "item_category",
  "item_list_name",
  "price",
  "quantity",
] as const);
const LINKED_ITEM_FIELDS = Object.freeze([...ITEM_FIELDS, "item_instance_id"] as const);
const ITEM_LIST_FIELDS = Object.freeze(["item_list_name", "items"] as const);
const COMMERCE_FIELDS = Object.freeze(["currency", "value", "items"] as const);
const BUILD_START_FIELDS = Object.freeze(["item_category"] as const);
const BUILD_OUTCOME_FIELDS = Object.freeze([
  "currency",
  "item_category",
  "item_instance_id",
  "stone_count",
  "value",
] as const);
const EMAIL_SIGNUP_FIELDS = Object.freeze(["discount_code", "method"] as const);

const MAX_ITEM_ID_LENGTH = 256;
const MAX_ITEM_NAME_LENGTH = 256;
const MAX_ITEM_CATEGORY_LENGTH = 160;
const MAX_ITEM_LIST_NAME_LENGTH = 256;
const MAX_EMAIL_SIGNUP_VALUE_LENGTH = 160;
const MAX_ITEMS = 100;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface WebsiteFunnelItemProperties {
  item_id: string;
  item_name: string;
  item_category: string;
  item_list_name?: string;
  item_instance_id?: string;
  price?: number;
  quantity?: number;
}

export interface WebsiteFunnelItemListProperties {
  item_list_name: string;
  items: WebsiteFunnelItemProperties[];
}

export interface WebsiteFunnelCommerceProperties {
  currency: string;
  value: number;
  items: WebsiteFunnelItemProperties[];
}

export interface WebsiteFunnelBuildStartProperties {
  item_category: string;
}

export interface WebsiteFunnelBuildOutcomeProperties {
  currency: string;
  item_category: string;
  item_instance_id?: string;
  stone_count: number;
  value: number;
}

export interface WebsiteFunnelEmailSignupProperties {
  discount_code: string;
  method: string;
}

export type WebsiteFunnelPageViewProperties = Record<string, JsonValue>;

export interface WebsiteFunnelEventPropertiesByName {
  page_view: WebsiteFunnelPageViewProperties;
  view_item_list: WebsiteFunnelItemListProperties;
  view_item: WebsiteFunnelCommerceProperties;
  add_to_cart: WebsiteFunnelCommerceProperties;
  begin_checkout: WebsiteFunnelCommerceProperties;
  build_start: WebsiteFunnelBuildStartProperties;
  build_complete: WebsiteFunnelBuildOutcomeProperties;
  save_design: WebsiteFunnelBuildOutcomeProperties;
  email_signup: WebsiteFunnelEmailSignupProperties;
}

export type WebsiteFunnelPropertyIssueCode =
  | "unknown_event"
  | "not_object"
  | "missing_field"
  | "unexpected_field"
  | "invalid_type"
  | "invalid_value";

export interface WebsiteFunnelPropertyIssue {
  code: WebsiteFunnelPropertyIssueCode;
  path: string;
  message: string;
}

type ValidKnownEventResult<Name extends WebsiteFunnelEventName = WebsiteFunnelEventName> = {
  classification: "known";
  eventName: Name;
  valid: true;
  properties: WebsiteFunnelEventPropertiesByName[Name];
  issues: [];
};

type InvalidKnownEventResult<Name extends WebsiteFunnelEventName = WebsiteFunnelEventName> = {
  classification: "known";
  eventName: Name;
  valid: false;
  properties: null;
  issues: WebsiteFunnelPropertyIssue[];
};

export type WebsiteFunnelKnownEventValidation<Name extends WebsiteFunnelEventName = WebsiteFunnelEventName> =
  | ValidKnownEventResult<Name>
  | InvalidKnownEventResult<Name>;

export type WebsiteFunnelEventValidation =
  | WebsiteFunnelKnownEventValidation
  | {
    classification: "unknown";
    eventName: string;
    valid: false;
    properties: null;
    issues: WebsiteFunnelPropertyIssue[];
  };

export interface WebsiteFunnelEventClassification {
  validation: WebsiteFunnelEventValidation;
  stageKey: WebsiteFunnelStageKey | null;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function issue(
  issues: WebsiteFunnelPropertyIssue[],
  code: WebsiteFunnelPropertyIssueCode,
  path: string,
  message: string,
) {
  issues.push({ code, path, message });
}

function validateExactFields(
  value: UnknownRecord,
  fields: readonly string[],
  path: string,
  issues: WebsiteFunnelPropertyIssue[],
) {
  const allowed = new Set(fields);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issue(issues, "unexpected_field", `${path}.${key}`, `${key} is not part of the frozen Storefront event contract.`);
    }
  }
}

function requiredString(
  value: UnknownRecord,
  key: string,
  path: string,
  maxLength: number,
  issues: WebsiteFunnelPropertyIssue[],
) {
  if (!Object.hasOwn(value, key)) {
    issue(issues, "missing_field", `${path}.${key}`, `${key} is required.`);
    return null;
  }
  if (typeof value[key] !== "string") {
    issue(issues, "invalid_type", `${path}.${key}`, `${key} must be a string.`);
    return null;
  }
  const normalized = value[key].trim();
  if (!normalized || normalized.length > maxLength) {
    issue(issues, "invalid_value", `${path}.${key}`, `${key} must contain 1 to ${maxLength} characters.`);
    return null;
  }
  return normalized;
}

function optionalString(
  value: UnknownRecord,
  key: string,
  path: string,
  maxLength: number,
  issues: WebsiteFunnelPropertyIssue[],
) {
  if (!Object.hasOwn(value, key)) return undefined;
  if (typeof value[key] !== "string") {
    issue(issues, "invalid_type", `${path}.${key}`, `${key} must be a string when provided.`);
    return null;
  }
  const normalized = value[key].trim();
  if (!normalized || normalized.length > maxLength) {
    issue(issues, "invalid_value", `${path}.${key}`, `${key} must contain 1 to ${maxLength} characters when provided.`);
    return null;
  }
  return normalized;
}

function optionalUuidV4(
  value: UnknownRecord,
  key: string,
  path: string,
  issues: WebsiteFunnelPropertyIssue[],
) {
  const candidate = optionalString(value, key, path, 36, issues);
  if (candidate === undefined || candidate === null) return candidate;
  if (!UUID_V4_PATTERN.test(candidate)) {
    issue(issues, "invalid_value", `${path}.${key}`, `${key} must be a UUIDv4 when provided.`);
    return null;
  }
  return candidate.toLowerCase();
}

function requiredNonNegativeNumber(
  value: UnknownRecord,
  key: string,
  path: string,
  issues: WebsiteFunnelPropertyIssue[],
) {
  if (!Object.hasOwn(value, key)) {
    issue(issues, "missing_field", `${path}.${key}`, `${key} is required.`);
    return null;
  }
  const candidate = value[key];
  if (typeof candidate !== "number") {
    issue(issues, "invalid_type", `${path}.${key}`, `${key} must be a number.`);
    return null;
  }
  if (!Number.isFinite(candidate) || candidate < 0) {
    issue(issues, "invalid_value", `${path}.${key}`, `${key} must be a finite, non-negative number.`);
    return null;
  }
  return candidate;
}

function optionalNonNegativeNumber(
  value: UnknownRecord,
  key: string,
  path: string,
  issues: WebsiteFunnelPropertyIssue[],
) {
  if (!Object.hasOwn(value, key)) return undefined;
  const candidate = value[key];
  if (typeof candidate !== "number") {
    issue(issues, "invalid_type", `${path}.${key}`, `${key} must be a number when provided.`);
    return null;
  }
  if (!Number.isFinite(candidate) || candidate < 0) {
    issue(issues, "invalid_value", `${path}.${key}`, `${key} must be finite and non-negative when provided.`);
    return null;
  }
  return candidate;
}

function requiredCurrency(value: UnknownRecord, path: string, issues: WebsiteFunnelPropertyIssue[]) {
  const currency = requiredString(value, "currency", path, 3, issues);
  if (currency !== null && !/^[A-Z]{3}$/u.test(currency)) {
    issue(issues, "invalid_value", `${path}.currency`, "currency must be a three-letter uppercase ISO currency code.");
    return null;
  }
  return currency;
}

function validateItem(
  value: unknown,
  path: string,
  issues: WebsiteFunnelPropertyIssue[],
  allowItemInstanceId: boolean,
) {
  if (!isRecord(value)) {
    issue(issues, "not_object", path, "Each item must be an object.");
    return null;
  }
  validateExactFields(value, allowItemInstanceId ? LINKED_ITEM_FIELDS : ITEM_FIELDS, path, issues);
  const itemId = requiredString(value, "item_id", path, MAX_ITEM_ID_LENGTH, issues);
  const itemName = requiredString(value, "item_name", path, MAX_ITEM_NAME_LENGTH, issues);
  const itemCategory = requiredString(value, "item_category", path, MAX_ITEM_CATEGORY_LENGTH, issues);
  const itemListName = optionalString(value, "item_list_name", path, MAX_ITEM_LIST_NAME_LENGTH, issues);
  const itemInstanceId = allowItemInstanceId
    ? optionalUuidV4(value, "item_instance_id", path, issues)
    : undefined;
  const price = optionalNonNegativeNumber(value, "price", path, issues);
  const quantity = optionalNonNegativeNumber(value, "quantity", path, issues);
  if (typeof quantity === "number" && (!Number.isInteger(quantity) || quantity < 1)) {
    issue(issues, "invalid_value", `${path}.quantity`, "quantity must be a positive integer when provided.");
  }
  if (
    itemId === null
    || itemName === null
    || itemCategory === null
    || itemListName === null
    || itemInstanceId === null
    || price === null
    || quantity === null
  ) {
    return null;
  }
  return {
    item_id: itemId,
    item_name: itemName,
    item_category: itemCategory,
    ...(itemListName === undefined ? {} : { item_list_name: itemListName }),
    ...(itemInstanceId === undefined ? {} : { item_instance_id: itemInstanceId }),
    ...(price === undefined ? {} : { price }),
    ...(quantity === undefined ? {} : { quantity }),
  } satisfies WebsiteFunnelItemProperties;
}

function validateItems(
  value: UnknownRecord,
  path: string,
  issues: WebsiteFunnelPropertyIssue[],
  allowItemInstanceId: boolean,
) {
  if (!Object.hasOwn(value, "items")) {
    issue(issues, "missing_field", `${path}.items`, "items is required.");
    return null;
  }
  if (!Array.isArray(value.items)) {
    issue(issues, "invalid_type", `${path}.items`, "items must be an array.");
    return null;
  }
  if (value.items.length === 0 || value.items.length > MAX_ITEMS) {
    issue(issues, "invalid_value", `${path}.items`, `items must contain between 1 and ${MAX_ITEMS} entries.`);
    return null;
  }
  const items = value.items.map((item, index) => validateItem(
    item,
    `${path}.items[${index}]`,
    issues,
    allowItemInstanceId,
  ));
  return items.some((item) => item === null) ? null : items as WebsiteFunnelItemProperties[];
}

function validatePageView(properties: unknown, issues: WebsiteFunnelPropertyIssue[]) {
  if (!isRecord(properties) || !isJsonValue(properties)) {
    issue(issues, "not_object", "properties", "page_view properties must be a JSON object.");
    return null;
  }
  return properties as WebsiteFunnelPageViewProperties;
}

function storefrontProperties(properties: unknown) {
  if (!isRecord(properties) || !Object.hasOwn(properties, "attribution")) return properties;
  return Object.fromEntries(
    Object.entries(properties).filter(([key]) => key !== "attribution"),
  );
}

function validateItemList(properties: unknown, issues: WebsiteFunnelPropertyIssue[]) {
  if (!isRecord(properties)) {
    issue(issues, "not_object", "properties", "view_item_list properties must be an object.");
    return null;
  }
  validateExactFields(properties, ITEM_LIST_FIELDS, "properties", issues);
  const itemListName = requiredString(properties, "item_list_name", "properties", MAX_ITEM_LIST_NAME_LENGTH, issues);
  const items = validateItems(properties, "properties", issues, false);
  if (itemListName === null || items === null) return null;
  return { item_list_name: itemListName, items } satisfies WebsiteFunnelItemListProperties;
}

function validateCommerce(
  properties: unknown,
  issues: WebsiteFunnelPropertyIssue[],
  allowItemInstanceId: boolean,
) {
  if (!isRecord(properties)) {
    issue(issues, "not_object", "properties", "Commerce event properties must be an object.");
    return null;
  }
  validateExactFields(properties, COMMERCE_FIELDS, "properties", issues);
  const currency = requiredCurrency(properties, "properties", issues);
  const value = requiredNonNegativeNumber(properties, "value", "properties", issues);
  const items = validateItems(properties, "properties", issues, allowItemInstanceId);
  if (currency === null || value === null || items === null) return null;
  return { currency, value, items } satisfies WebsiteFunnelCommerceProperties;
}

function validateBuildStart(properties: unknown, issues: WebsiteFunnelPropertyIssue[]) {
  if (!isRecord(properties)) {
    issue(issues, "not_object", "properties", "build_start properties must be an object.");
    return null;
  }
  validateExactFields(properties, BUILD_START_FIELDS, "properties", issues);
  const itemCategory = requiredString(properties, "item_category", "properties", MAX_ITEM_CATEGORY_LENGTH, issues);
  if (itemCategory === null) return null;
  return { item_category: itemCategory } satisfies WebsiteFunnelBuildStartProperties;
}

function validateBuildOutcome(properties: unknown, issues: WebsiteFunnelPropertyIssue[]) {
  if (!isRecord(properties)) {
    issue(issues, "not_object", "properties", "Build outcome properties must be an object.");
    return null;
  }
  validateExactFields(properties, BUILD_OUTCOME_FIELDS, "properties", issues);
  const currency = requiredCurrency(properties, "properties", issues);
  const itemCategory = requiredString(properties, "item_category", "properties", MAX_ITEM_CATEGORY_LENGTH, issues);
  const itemInstanceId = optionalUuidV4(properties, "item_instance_id", "properties", issues);
  const stoneCount = requiredNonNegativeNumber(properties, "stone_count", "properties", issues);
  const value = requiredNonNegativeNumber(properties, "value", "properties", issues);
  if (typeof stoneCount === "number" && !Number.isInteger(stoneCount)) {
    issue(issues, "invalid_value", "properties.stone_count", "stone_count must be an integer.");
  }
  if (
    currency === null
    || itemCategory === null
    || itemInstanceId === null
    || stoneCount === null
    || value === null
  ) return null;
  return {
    currency,
    item_category: itemCategory,
    ...(itemInstanceId === undefined ? {} : { item_instance_id: itemInstanceId }),
    stone_count: stoneCount,
    value,
  } satisfies WebsiteFunnelBuildOutcomeProperties;
}

function validateEmailSignup(properties: unknown, issues: WebsiteFunnelPropertyIssue[]) {
  if (!isRecord(properties)) {
    issue(issues, "not_object", "properties", "email_signup properties must be an object.");
    return null;
  }
  validateExactFields(properties, EMAIL_SIGNUP_FIELDS, "properties", issues);
  const discountCode = requiredString(properties, "discount_code", "properties", MAX_EMAIL_SIGNUP_VALUE_LENGTH, issues);
  const method = requiredString(properties, "method", "properties", MAX_EMAIL_SIGNUP_VALUE_LENGTH, issues);
  if (discountCode === null || method === null) return null;
  return { discount_code: discountCode, method } satisfies WebsiteFunnelEmailSignupProperties;
}

export function isWebsiteFunnelEventName(value: string): value is WebsiteFunnelEventName {
  return WEBSITE_FUNNEL_EVENT_NAMES.includes(value as WebsiteFunnelEventName);
}

export function validateWebsiteFunnelEventProperties<Name extends WebsiteFunnelEventName>(
  eventName: Name,
  properties: unknown,
): WebsiteFunnelKnownEventValidation<Name>;
export function validateWebsiteFunnelEventProperties(eventName: string, properties: unknown): WebsiteFunnelEventValidation;
export function validateWebsiteFunnelEventProperties(
  eventName: string,
  properties: unknown,
): WebsiteFunnelEventValidation {
  if (!isWebsiteFunnelEventName(eventName)) {
    return {
      classification: "unknown",
      eventName,
      valid: false,
      properties: null,
      issues: [{
        code: "unknown_event",
        path: "event_name",
        message: `${eventName || "(empty)"} is not part of the frozen Storefront event taxonomy.`,
      }],
    };
  }

  const issues: WebsiteFunnelPropertyIssue[] = [];
  const contractProperties = eventName === "page_view"
    ? properties
    : storefrontProperties(properties);
  const validated = eventName === "page_view"
    ? validatePageView(contractProperties, issues)
    : eventName === "view_item_list"
      ? validateItemList(contractProperties, issues)
      : eventName === "view_item" || eventName === "add_to_cart" || eventName === "begin_checkout"
        ? validateCommerce(
            contractProperties,
            issues,
            eventName === "add_to_cart" || eventName === "begin_checkout",
          )
        : eventName === "build_start"
          ? validateBuildStart(contractProperties, issues)
          : eventName === "build_complete" || eventName === "save_design"
            ? validateBuildOutcome(contractProperties, issues)
            : validateEmailSignup(contractProperties, issues);

  if (validated === null || issues.length > 0) {
    return {
      classification: "known",
      eventName,
      valid: false,
      properties: null,
      issues,
    };
  }

  return {
    classification: "known",
    eventName,
    valid: true,
    properties: validated,
    issues: [],
  } as WebsiteFunnelKnownEventValidation;
}

function stageKeyForEvent(eventName: WebsiteFunnelEventName): WebsiteFunnelStageKey | null {
  for (const stage of WEBSITE_FUNNEL_STAGES) {
    if ((stage.eventNames as readonly WebsiteFunnelEventName[]).includes(eventName)) return stage.key;
  }
  return null;
}

export function classifyWebsiteFunnelEvent(eventName: string, properties: unknown): WebsiteFunnelEventClassification {
  const validation = validateWebsiteFunnelEventProperties(eventName, properties);
  return {
    validation,
    stageKey: validation.valid ? stageKeyForEvent(validation.eventName) : null,
  };
}

export function isStrictWebsiteFunnelProgression(previousOccurredAt: string, nextOccurredAt: string) {
  const previous = Date.parse(previousOccurredAt);
  const next = Date.parse(nextOccurredAt);
  return Number.isFinite(previous) && Number.isFinite(next) && next > previous;
}

function isNonNegativeFinite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function calculateRatePercent(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
) {
  if (!isNonNegativeFinite(numerator) || !isNonNegativeFinite(denominator) || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

export function calculateDeltaPercent(
  current: number | null | undefined,
  previous: number | null | undefined,
) {
  if (!isNonNegativeFinite(current) || !isNonNegativeFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function calculateAbsoluteDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
) {
  if (!isNonNegativeFinite(current) || !isNonNegativeFinite(previous)) return null;
  return current - previous;
}
