export type WebsiteDisplayDimensionKind = "utm" | "landing_path" | "referrer_host";

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const streetAddressPattern = /\b[0-9]{1,6}\s+(?:[A-Z0-9.'-]+\s+){0,5}(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct|way|highway|hwy)\b/iu;
const postOfficeBoxPattern = /\bP(?:OST)?\.?\s*O(?:FFICE)?\.?\s+BOX\s+[A-Z0-9-]+\b/iu;
const secretPattern = /(?:\b(?:bearer|basic)\s+[A-Z0-9._~+/=-]{8,}\b|\b(?:sk|pk|rk)_(?:live|test)_[A-Z0-9_-]{8,}\b|\beyJ[A-Z0-9_-]{8,}\.[A-Z0-9_-]{8,}\.[A-Z0-9_-]{8,}\b|(?:^|[?&#/_.-])(?:authorization|cookie|credential|password|passwd|secret|token|api[_-]?key|access[_-]?key|session[_-]?id)[=:/])/iu;

function decodedVariants(value: string): string[] | null {
  const variants = [value];
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const decoded = decodeURIComponent(variants.at(-1) ?? value);
      if (decoded === variants.at(-1)) break;
      variants.push(decoded);
    } catch {
      return null;
    }
  }
  if ((variants.at(-1) ?? value).includes("%")) return null;
  return [...new Set(variants)];
}

function validIpv4(value: string) {
  const octets = value.split(".");
  return octets.length === 4
    && octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255);
}

function containsRawIp(variants: string[]) {
  return variants.some((variant) => {
    const ipv4Candidates = variant.match(/(?:^|[^0-9])((?:[0-9]{1,3}\.){3}[0-9]{1,3})(?=$|[^0-9])/gu) ?? [];
    if (ipv4Candidates.some((candidate) => validIpv4(candidate.replace(/^[^0-9]+|[^0-9]+$/gu, "")))) {
      return true;
    }
    if (/(?:^|[^A-F0-9])(?:[A-F0-9]{0,4}:){2,}[A-F0-9:]{0,39}(?:$|[^A-F0-9])/iu.test(variant)) {
      return true;
    }
    try {
      const url = variant.startsWith("/") ? new URL(variant, "https://tracking.invalid") : new URL(variant);
      const host = url.hostname.replace(/^\[|\]$/gu, "");
      return validIpv4(host) || host.includes(":");
    } catch {
      return false;
    }
  });
}

function passesLuhnCheck(digits: string) {
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

const paymentSeparatorPattern = /^[\p{White_Space}\p{Punctuation}\p{Symbol}]$/u;

function isAsciiDigit(value: string) {
  return value >= "0" && value <= "9";
}

function digitsContainPaymentNumber(digits: string) {
  if (digits.length < 13) return false;
  for (let length = 13; length <= Math.min(19, digits.length); length += 1) {
    for (let start = 0; start + length <= digits.length; start += 1) {
      if (passesLuhnCheck(digits.slice(start, start + length))) return true;
    }
  }
  return false;
}

function candidateContainsPaymentNumber(candidate: string) {
  let candidateDigits = "";
  let digitRun = "";
  const flushDigitRun = () => {
    if (!digitRun) return false;
    if (digitRun.length >= 20) {
      const unsafe = digitsContainPaymentNumber(candidateDigits);
      candidateDigits = "";
      digitRun = "";
      return unsafe;
    }
    candidateDigits += digitRun;
    digitRun = "";
    return false;
  };

  for (const character of candidate) {
    if (isAsciiDigit(character)) digitRun += character;
    else if (flushDigitRun()) return true;
  }
  if (flushDigitRun()) return true;
  return digitsContainPaymentNumber(candidateDigits);
}

function containsPaymentNumber(value: string) {
  let candidate = "";
  for (const character of value) {
    if (isAsciiDigit(character) || paymentSeparatorPattern.test(character)) {
      candidate += character;
      continue;
    }
    if (candidateContainsPaymentNumber(candidate)) return true;
    candidate = "";
  }
  return candidateContainsPaymentNumber(candidate);
}

function isLikelyPhoneNumber(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/gu, "");
  if (trimmed.startsWith("+")) {
    return /^[+0-9 ().-]+$/u.test(trimmed) && digits.length >= 7 && digits.length <= 15;
  }
  const internationalPrefix = /^(?:20|27|30|31|32|33|34|36|39|40|41|43|44|45|46|47|48|49|51|52|53|54|55|56|57|58|60|61|62|63|64|65|66|81|82|84|86|90|91|92|93|94|95|98)/u;
  if (/^[0-9]{9,15}$/u.test(trimmed) && (trimmed.startsWith("0") || internationalPrefix.test(trimmed))) {
    return true;
  }
  const separators = trimmed.match(/[ ()-]/gu)?.length ?? 0;
  if (digits.length >= 9 && digits.length <= 15 && separators >= 2 && /^[0-9 ()-]+$/u.test(trimmed)) {
    return true;
  }
  const nationalDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const plausibleNanp = nationalDigits.length === 10
    && /^[2-9][0-9]{2}[2-9][0-9]{6}$/u.test(nationalDigits);
  return plausibleNanp && (
    /^[0-9]{10,11}$/u.test(trimmed)
    || /^(?:1[ .-])?\(?[2-9][0-9]{2}\)?[ .-][2-9][0-9]{2}[ .-][0-9]{4}$/u.test(trimmed)
  );
}

function containsProhibitedNumber(variants: string[]) {
  return variants.some((variant) => {
    const trimmed = variant.trim();
    if (isLikelyPhoneNumber(trimmed)) return true;
    if (containsPaymentNumber(variant)) return true;
    return (variant.match(/[+0-9][+0-9 ().-]{6,24}/gu) ?? [])
      .some((candidate) => isLikelyPhoneNumber(candidate.trim()));
  });
}

function containsUnsafeDisplayData(value: string) {
  const variants = decodedVariants(value);
  if (!variants) return true;
  if (containsRawIp(variants) || containsProhibitedNumber(variants)) return true;
  return variants.some((variant) => {
    const normalizedAddress = variant.replace(/[-_]+/gu, " ");
    return /[\u0000-\u001F\u007F]/u.test(variant)
      || emailPattern.test(variant)
      || streetAddressPattern.test(normalizedAddress)
      || postOfficeBoxPattern.test(normalizedAddress)
      || secretPattern.test(variant);
  });
}

export function sanitizeWebsiteDisplayDimension(
  value: string | undefined | null,
  kind: WebsiteDisplayDimensionKind,
  maximumLength: number,
) {
  const normalized = (value ?? "").trim();
  if (!normalized || normalized.length > maximumLength) return "";
  if (normalized.toLowerCase() === "unknown") return "Unknown";
  if (containsUnsafeDisplayData(normalized) || /[?#]/u.test(normalized)) return "";
  if (kind === "landing_path") {
    return normalized.startsWith("/") && !normalized.startsWith("//") ? normalized : "";
  }
  if (kind === "referrer_host") {
    const host = normalized.toLowerCase();
    if (host.includes("@") || host.includes(":")) return "";
    return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/u.test(host)
      ? host
      : "";
  }
  return normalized;
}
