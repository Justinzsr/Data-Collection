export const APP_TIME_ZONE = "America/Los_Angeles";
export type AppDateRangeKey = "today" | "7d" | "30d";

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function appDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    second: Number(lookup.second),
  };
}

export function appDateTimeParts(value: DateInput = new Date()) {
  return appDateParts(toDate(value) ?? new Date());
}

function appLocalDateTimeToUtc(dateKey: string, hour: number, minute: number, second: number, millisecond: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const guess = new Date(desiredUtc);
  const actual = appDateParts(guess);
  const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second, millisecond);
  return new Date(guess.getTime() + (desiredUtc - actualUtc));
}

export function dateKeyInAppTimeZone(value: DateInput = new Date()) {
  const date = toDate(value) ?? new Date();
  const parts = appDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getAppDateRange(range: AppDateRangeKey = "30d", now: DateInput = new Date()) {
  const endDate = dateKeyInAppTimeZone(now);
  const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
  return {
    startDate: addDaysToDateKey(endDate, -(days - 1)),
    endDate,
  };
}

export function startOfAppDateUtc(dateKey: string) {
  return appLocalDateTimeToUtc(dateKey, 0, 0, 0, 0).toISOString();
}

export function endOfAppDateUtc(dateKey: string) {
  return appLocalDateTimeToUtc(dateKey, 23, 59, 59, 999).toISOString();
}

export function formatAppDateTime(value: DateInput, fallback = "never") {
  const date = toDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function formatAppDate(value: DateInput, fallback = "never") {
  const date = toDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatAppTime(value: DateInput, fallback = "never") {
  const date = toDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}
