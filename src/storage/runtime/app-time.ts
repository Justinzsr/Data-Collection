export const APP_TIME_ZONE = "America/Los_Angeles";
export type AppDateRangeKey = "today" | "7d" | "30d";

type DateInput = string | number | Date | null | undefined;

export interface AppDateRange {
  startDate: string;
  endDate: string;
}

export interface HalfOpenAppDateRangeUtc {
  startInclusive: string;
  endExclusive: string;
}

export interface ComparableAppDateRangesUtc {
  current: HalfOpenAppDateRangeUtc;
  previous: HalfOpenAppDateRangeUtc | null;
  previousDateRange: AppDateRange;
  isPartialCurrentDay: boolean;
}

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

export function isAppDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function normalizeDateOnlyKey(value: DateInput, fallback = dateKeyInAppTimeZone()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed.slice(0, 10);
    const isoDatePrefix = /^(\d{4}-\d{2}-\d{2})(?:[T\s]|$)/.exec(trimmed);
    if (isoDatePrefix) return isoDatePrefix[1];
  }

  return fallback;
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

function appDateKeyDayNumber(dateKey: string) {
  if (!isAppDateKey(dateKey)) throw new RangeError(`Invalid Pacific date key: ${dateKey}`);
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid Pacific date key: ${dateKey}`);
  }
  return Math.floor(date.getTime() / 86_400_000);
}

export function endExclusiveOfAppDateUtc(dateKey: string) {
  appDateKeyDayNumber(dateKey);
  return startOfAppDateUtc(addDaysToDateKey(dateKey, 1));
}

export function getHalfOpenAppDateRangeUtc(range: AppDateRange): HalfOpenAppDateRangeUtc {
  const startDay = appDateKeyDayNumber(range.startDate);
  const endDay = appDateKeyDayNumber(range.endDate);
  if (endDay < startDay) throw new RangeError("Pacific date range end must not precede its start.");
  return {
    startInclusive: startOfAppDateUtc(range.startDate),
    endExclusive: endExclusiveOfAppDateUtc(range.endDate),
  };
}

function sameWallClockCandidates(dateKey: string, reference: Date) {
  const referenceParts = appDateParts(reference);
  const [year, month, day] = dateKey.split("-").map(Number);
  const desiredUtc = Date.UTC(
    year,
    month - 1,
    day,
    referenceParts.hour,
    referenceParts.minute,
    referenceParts.second,
    reference.getUTCMilliseconds(),
  );
  const candidates: Date[] = [];

  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = new Date(desiredUtc - offsetMinutes * 60_000);
    const parts = appDateParts(candidate);
    if (
      `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}` === dateKey
      && parts.hour === referenceParts.hour
      && parts.minute === referenceParts.minute
      && parts.second === referenceParts.second
      && candidate.getUTCMilliseconds() === reference.getUTCMilliseconds()
    ) {
      candidates.push(candidate);
    }
  }

  return candidates.sort((left, right) => left.getTime() - right.getTime());
}

function appUtcOffsetMinutes(date: Date) {
  const parts = appDateParts(date);
  return (
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      date.getUTCMilliseconds(),
    ) - date.getTime()
  ) / 60_000;
}

export function sameAppWallClockOnDateUtc(
  dateKey: string,
  reference: DateInput = new Date(),
) {
  appDateKeyDayNumber(dateKey);
  const referenceDate = toDate(reference);
  if (!referenceDate) return null;
  const candidates = sameWallClockCandidates(dateKey, referenceDate);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].toISOString();

  const referenceOffset = appUtcOffsetMinutes(referenceDate);
  return (
    candidates.find((candidate) => appUtcOffsetMinutes(candidate) === referenceOffset)
    ?? candidates[0]
  ).toISOString();
}

export function getComparableAppDateRangesUtc(
  range: AppDateRange,
  now: DateInput = new Date(),
): ComparableAppDateRangesUtc {
  const startDay = appDateKeyDayNumber(range.startDate);
  const endDay = appDateKeyDayNumber(range.endDate);
  if (endDay < startDay) throw new RangeError("Pacific date range end must not precede its start.");

  const reference = toDate(now);
  if (!reference) throw new RangeError("Comparison cutoff must be a valid timestamp.");

  const fullCurrent = getHalfOpenAppDateRangeUtc(range);
  const today = dateKeyInAppTimeZone(reference);
  const isPartialCurrentDay = range.endDate === today;
  const dayCount = endDay - startDay + 1;
  const previousDateRange = {
    startDate: addDaysToDateKey(range.startDate, -dayCount),
    endDate: addDaysToDateKey(range.startDate, -1),
  };
  const previousStartInclusive = startOfAppDateUtc(previousDateRange.startDate);
  const previousPeriodBoundary = startOfAppDateUtc(range.startDate);
  const currentEndExclusive = isPartialCurrentDay
    ? reference.toISOString()
    : fullCurrent.endExclusive;
  const currentElapsedMs = Date.parse(currentEndExclusive) - Date.parse(fullCurrent.startInclusive);
  const equalElapsedPreviousEnd = new Date(
    Date.parse(previousStartInclusive) + currentElapsedMs,
  ).toISOString();
  const previousEndExclusive = currentElapsedMs <= 0
    ? null
    : isPartialCurrentDay
      && Date.parse(equalElapsedPreviousEnd) > Date.parse(previousPeriodBoundary)
        ? null
        : isPartialCurrentDay
          ? equalElapsedPreviousEnd
          : previousPeriodBoundary;

  return {
    current: {
      startInclusive: fullCurrent.startInclusive,
      endExclusive: currentEndExclusive,
    },
    previous: previousEndExclusive
      ? { startInclusive: previousStartInclusive, endExclusive: previousEndExclusive }
      : null,
    previousDateRange,
    isPartialCurrentDay,
  };
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
