export type WebsiteDisplayDimensionKind = "utm" | "landing_path" | "referrer_host";

const internationalEmailPattern = /[^@\s]+@(?:[^@\s.]+\.)+[^@\s._]{2,63}(?![A-Za-z0-9_\u0080-\u{10FFFF}])/u;
const streetAddressPattern = /\b[0-9]{1,6}[\p{Letter}]?\s+(?:[\p{Letter}\p{Number}.'-]+\s+){0,5}(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct|way|highway|hwy|place|pl|terrace|ter|trail|trl|parkway|pkwy|circle|cir|crescent|cres)\b/iu;
const postOfficeBoxPattern = /\bP(?:OST)?\.?\s*O(?:FFICE)?\.?\s+BOX\s+[A-Z0-9-]+\b/iu;
const bearerCredentialPattern = /\bbearer\s+[A-Z0-9._~+/-]+={0,}(?![A-Z0-9._~+/=-])/iu;
const basicCredentialPattern = /\bbasic\s+([A-Z0-9+/]{2,}={0,2})(?![A-Z0-9+/=])/giu;
const standaloneCredentialPattern = /(?:\b(?:sk|pk|rk)_(?:live|test)_[A-Z0-9_-]{8,}(?![A-Z0-9_-])|\beyJ[A-Z0-9_-]{8,}\.[A-Z0-9_-]{8,}\.[A-Z0-9_-]{8,}(?![A-Z0-9_-])|\b(?:gh[pousr]_[A-Z0-9]{30,255}|github_pat_[A-Z0-9_]{20,255}|shpat_[A-Z0-9_-]{16,255}|xox[baprs]-[A-Z0-9-]{16,255})(?![A-Z0-9_-])|\b(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9]))/iu;
const sensitiveKeyValueDelimiterPattern = /[=:/]/gu;
const sensitiveKeyInspectionCodePointLimit = 1_200;
const sensitiveKeyDelimiterInspectionLimit = 64;
const encodedUnsafeDisplayDelimiterPattern = /%(?:25)*(?:23|3f|40)/iu;
const prohibitedCanonicalKeyFragments = [
  "email", "phone", "telephone", "mobilenumber", "shippingaddress", "billingaddress",
  "streetaddress", "fulladdress", "postaladdress", "customeraddress", "cardnumber",
  "creditcard", "cardholder", "cardlast", "paymenttoken", "paymentdata", "paymentmethod",
  "paymentintent", "cvv", "cvc", "accesstoken", "refreshtoken", "authorization",
  "password", "secret", "firstname", "lastname", "fullname", "customername",
] as const;
const aggregateIdentifierKeySuffixes = [
  "sourceid", "eventid", "sessionid", "anonymousid", "userid", "publictrackingkey",
  "trackingkey", "useragent", "paymentcard", "token", "cookie", "credential", "passwd",
  "apikey", "accesskey", "clientsecret",
] as const;
const sensitiveCanonicalKeyFamilies = new Set<string>([
  ...prohibitedCanonicalKeyFragments,
  ...aggregateIdentifierKeySuffixes,
]);
const sensitiveCanonicalKeySafeTerminalSuffixes = new Map<string, string>([
  ["accesstoken", "izer"],
  ["token", "izer"],
  ["apikey", "note"],
  ["sourceid", "entifier"],
  ["eventid", "ea"],
  ["sessionid", "ea"],
  ["anonymousid", "ea"],
  ["userid", "ea"],
  ["trackingkey", "note"],
  ["useragent", "ive"],
]);
const urlUserinfoSchemePattern = /(?:(?:https?|ftp|ws|wss):[\\/]*|[A-Z][A-Z0-9+.-]*:[\\/]{2,}|:[\\/]{2,})[^\s/?#\\]*@/iu;
const urlUserinfoRelativePattern = /[\\/]{2,}[^\s/?#\\]*@/gu;

function hasRelativeAuthorityLeftBoundary(value: string, start: number) {
  if (start === 0) return true;
  const left = value[start - 1] ?? "";
  if (left !== ":") return !/[\p{Letter}\p{Number}]/u.test(left);
  const beforeColon = value.slice(0, start - 1);
  return !/(?:^|[^A-Z0-9+.-])[A-Z][A-Z0-9+.-]*$/iu.test(beforeColon);
}

function containsUrlUserinfo(value: string) {
  if (urlUserinfoSchemePattern.test(value)) return true;
  return [...value.matchAll(urlUserinfoRelativePattern)].some((match) => {
    const start = match.index ?? 0;
    return hasRelativeAuthorityLeftBoundary(value, start);
  });
}

function basicPayloadContainsColon(token: string) {
  const unpadded = token.replace(/=+$/u, "");
  if (unpadded.length < 2 || unpadded.length % 4 === 1) return false;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let bits = 0;
  let bitCount = 0;
  for (const character of unpadded) {
    const value = alphabet.indexOf(character);
    if (value < 0) return false;
    bits = (bits << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      if (((bits >> bitCount) & 0xff) === 0x3a) return true;
      bits &= (1 << bitCount) - 1;
    }
  }
  return false;
}

function containsAuthorizationCredential(value: string) {
  if (bearerCredentialPattern.test(value)) return true;
  return [...value.matchAll(basicCredentialPattern)]
    .some((match) => basicPayloadContainsColon(match[1] ?? ""));
}

function containsSensitiveKeyValue(value: string) {
  const delimiterMatches = [...value.matchAll(sensitiveKeyValueDelimiterPattern)];
  const canonicalValue = value.toLowerCase().replace(/[^a-z0-9]/gu, "");
  if (
    delimiterMatches.length > sensitiveKeyDelimiterInspectionLimit
    && (
      [...sensitiveCanonicalKeyFamilies].some((family) => canonicalValue.includes(family))
      || canonicalValue.includes("ip")
    )
  ) return true;
  return delimiterMatches.some((match) => {
    const delimiterIndex = match.index ?? 0;
    const rawKeyCodePoints = Array.from(value.slice(0, delimiterIndex));
    if (rawKeyCodePoints.length > sensitiveKeyInspectionCodePointLimit) return true;
    const rawKey = rawKeyCodePoints.join("").trim();
    const canonicalKey = rawKey.toLowerCase().replace(/[^a-z0-9]/gu, "");
    const keyWords = rawKey
      .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/gu)
      .filter(Boolean);
    for (let start = 0; start < keyWords.length; start += 1) {
      let joinedWords = "";
      for (let end = start; end < keyWords.length; end += 1) {
        joinedWords += keyWords[end];
        if (joinedWords.length > 24) break;
        if (sensitiveCanonicalKeyFamilies.has(joinedWords)) {
          return true;
        }
      }
    }
    if ([...sensitiveCanonicalKeyFamilies].some((family) => {
      const safeTerminalSuffix = sensitiveCanonicalKeySafeTerminalSuffixes.get(family);
      if (!safeTerminalSuffix) return canonicalKey.includes(family);
      const safeTerminalForm = `${family}${safeTerminalSuffix}`;
      const withoutSafeTerminalForm = canonicalKey.endsWith(safeTerminalForm)
        ? canonicalKey.slice(0, -safeTerminalForm.length)
        : canonicalKey;
      return withoutSafeTerminalForm.includes(family);
    })) {
      return true;
    }
    if (
      canonicalKey === "ip"
      || canonicalKey === "ipaddress"
      || canonicalKey.endsWith("ipaddress")
      || canonicalKey.endsWith("clientip")
      || canonicalKey.endsWith("remoteip")
    ) return true;
    return false;
  });
}

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

// Frozen Unicode 17 Cf (170 scalars / 21 ranges; range-source SHA-256
// bdc1af61ef90e6d0a4b8f08318fbf5ae45544598fd08a712b4e8ded4094a345f)
// plus the existing IDNA/default-ignorable probe set.
// Format controls are removed and space-mapped only in privacy probes; safe
// display values retain their original representation.
const privacyIgnorablePattern = /[\u00AD\u034F\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u115F-\u1160\u17B4-\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB\u{110BD}\u{110CD}\u{13430}-\u{1343F}\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0001}\u{E0020}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;
const unicodeDotPattern = /[\u3002\uFF0E\uFF61]/gu;
const privacyNonLexicalNonAsciiPattern = /[^\u0020-\u007E\p{Letter}\p{Number}\p{White_Space}]/gu;
const alternativeNumericHostUrlPattern = /^(?:(?:https?|ftp|ws|wss):[\\/]*|file:[\\/]{2}|[\\/]{2,})(?:[^/?#@\\]*@)*(?:0x[0-9a-f]+|[0-9]+)(?:\.(?:0x[0-9a-f]+|[0-9]+)){0,3}\.?(?::[0-9]*)?(?:[/?#\\]|$)/iu;
// Frozen Unicode 17 Decimal_Number block starts (77 blocks / 770 scalars;
// block-source SHA-256 0de30dc272c64c193227c422dcb022d6be02d95c397452e96b6e9481175e33df).
const unicodeDecimalDigitBlockStarts = [
  0x30, 0x660, 0x6F0, 0x7C0, 0x966, 0x9E6, 0xA66, 0xAE6, 0xB66, 0xBE6,
  0xC66, 0xCE6, 0xD66, 0xDE6, 0xE50, 0xED0, 0xF20, 0x1040, 0x1090, 0x17E0,
  0x1810, 0x1946, 0x19D0, 0x1A80, 0x1A90, 0x1B50, 0x1BB0, 0x1C40, 0x1C50,
  0xA620, 0xA8D0, 0xA900, 0xA9D0, 0xA9F0, 0xAA50, 0xABF0, 0xFF10, 0x104A0,
  0x10D30, 0x10D40, 0x11066, 0x110F0, 0x11136, 0x111D0, 0x112F0, 0x11450,
  0x114D0, 0x11650, 0x116C0, 0x116D0, 0x116DA, 0x11730, 0x118E0, 0x11950,
  0x11BF0, 0x11C50, 0x11D50, 0x11DA0, 0x11DE0, 0x11F50, 0x16130, 0x16A60,
  0x16AC0, 0x16B50, 0x16D70, 0x1CCF0, 0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC,
  0x1D7F6, 0x1E140, 0x1E2F0, 0x1E4F0, 0x1E5F1, 0x1E950, 0x1FBF0,
] as const;
const unicodeDecimalDigitMap = new Map(
  unicodeDecimalDigitBlockStarts.flatMap((start) => (
    Array.from({ length: 10 }, (_, digit) => [String.fromCodePoint(start + digit), String(digit)] as const)
  )),
);

function normalizedPrivacyProbe(value: string, ignoredReplacement = "") {
  return value
    .normalize("NFKC")
    .replace(privacyIgnorablePattern, ignoredReplacement)
    .replace(unicodeDotPattern, ".")
    .replace(privacyNonLexicalNonAsciiPattern, ignoredReplacement);
}

function normalizedNumericPrivacyProbe(value: string, ignoredReplacement = "") {
  const mapped = [...normalizedPrivacyProbe(value)]
    .map((character) => unicodeDecimalDigitMap.get(character) ?? character)
    .join("");
  if (!ignoredReplacement) return mapped;
  return [...normalizedPrivacyProbe(value, ignoredReplacement)]
    .map((character) => unicodeDecimalDigitMap.get(character) ?? character)
    .join("");
}

function validPercentEscapeCount(value: string) {
  return value.match(/%[0-9A-Fa-f]{2}/gu)?.length ?? 0;
}

function containsRawIp(variants: string[]) {
  return variants.some((variant) => {
    if (/(?:^|[^0-9])(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])(?![0-9])/u.test(variant)) {
      return true;
    }
    if (/(?:^|[^A-F0-9])(?:[A-F0-9]{0,4}:){2,}[A-F0-9:]{0,39}(?:$|[^A-F0-9])/iu.test(variant)) {
      return true;
    }
    const candidateHasIpHost = (candidate: string) => {
      if (alternativeNumericHostUrlPattern.test(candidate)) return true;
      try {
        const url = /^[\\/]/u.test(candidate)
          ? new URL(candidate, "https://tracking.invalid")
          : new URL(candidate);
        const host = url.hostname.replace(/^\[|\]$/gu, "");
        return validIpv4(host) || host.includes(":");
      } catch {
        return false;
      }
    };
    const urlProbe = normalizedPrivacyProbe(variant);
    for (const tokenMatch of urlProbe.matchAll(/\S+/gu)) {
      const token = tokenMatch[0];
      for (const match of token.matchAll(/(?:https?|ftp|ws|wss|file):/giu)) {
        if (candidateHasIpHost(token.slice(match.index))) return true;
      }
    }
    for (const match of urlProbe.matchAll(/[\\/]{2,}/gu)) {
      const start = match.index ?? 0;
      if (
        hasRelativeAuthorityLeftBoundary(urlProbe, start)
        && candidateHasIpHost(urlProbe.slice(start))
      ) return true;
    }
    return false;
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

// Frozen Unicode 17 White_Space, Punctuation, and Symbol ranges. Keeping this
// table explicit makes the privacy boundary independent of runtime ICU updates.
const paymentSeparatorCharacterClass = [
  String.raw`\u0009-\u000D\u0020-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E\u0085\u00A0-\u00A9\u00AB-\u00AC\u00AE-\u00B1\u00B4\u00B6-\u00B8\u00BB\u00BF\u00D7\u00F7\u02C2-\u02C5\u02D2-\u02DF\u02E5-\u02EB\u02ED\u02EF-\u02FF\u0375\u037E\u0384-\u0385\u0387\u03F6\u0482\u055A-\u055F\u0589-\u058A\u058D-\u058F\u05BE\u05C0\u05C3\u05C6\u05F3-\u05F4\u0606-\u060F\u061B\u061D-\u061F\u066A-\u066D\u06D4\u06DE\u06E9\u06FD-\u06FE\u0700-\u070D\u07F6-\u07F9\u07FE-\u07FF\u0830-\u083E\u085E\u0888\u0964-\u0965\u0970\u09F2-\u09F3\u09FA-\u09FB\u09FD\u0A76\u0AF0-\u0AF1\u0B70\u0BF3-\u0BFA\u0C77\u0C7F\u0C84\u0D4F\u0D79\u0DF4\u0E3F\u0E4F\u0E5A-\u0E5B\u0F01-\u0F17\u0F1A-\u0F1F\u0F34\u0F36\u0F38\u0F3A-\u0F3D`,
  String.raw`\u0F85\u0FBE-\u0FC5\u0FC7-\u0FCC\u0FCE-\u0FDA\u104A-\u104F\u109E-\u109F\u10FB\u1360-\u1368\u1390-\u1399\u1400\u166D-\u166E\u1680\u169B-\u169C\u16EB-\u16ED\u1735-\u1736\u17D4-\u17D6\u17D8-\u17DB\u1800-\u180A\u1940\u1944-\u1945\u19DE-\u19FF\u1A1E-\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B4E-\u1B4F\u1B5A-\u1B6A\u1B74-\u1B7F\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E-\u1C7F\u1CC0-\u1CC7\u1CD3\u1FBD\u1FBF-\u1FC1\u1FCD-\u1FCF\u1FDD-\u1FDF\u1FED-\u1FEF\u1FFD-\u1FFE\u2000-\u200A\u2010-\u2029\u202F-\u205F\u207A-\u207E\u208A-\u208E\u20A0-\u20C1\u2100-\u2101\u2103-\u2106\u2108-\u2109\u2114\u2116-\u2118\u211E-\u2123\u2125\u2127\u2129\u212E\u213A-\u213B\u2140-\u2144\u214A-\u214D\u214F\u218A-\u218B`,
  String.raw`\u2190-\u2429\u2440-\u244A\u249C-\u24E9\u2500-\u2775\u2794-\u2B73\u2B76-\u2BFF\u2CE5-\u2CEA\u2CF9-\u2CFC\u2CFE-\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E5D\u2E80-\u2E99\u2E9B-\u2EF3\u2F00-\u2FD5\u2FF0-\u3004\u3008-\u3020\u3030\u3036-\u3037\u303D-\u303F\u309B-\u309C\u30A0\u30FB\u3190-\u3191\u3196-\u319F\u31C0-\u31E5\u31EF\u3200-\u321E\u322A-\u3247\u3250\u3260-\u327F\u328A-\u32B0\u32C0-\u33FF\u4DC0-\u4DFF\uA490-\uA4C6\uA4FE-\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA700-\uA716\uA720-\uA721\uA789-\uA78A\uA828-\uA82B\uA836-\uA839\uA874-\uA877\uA8CE-\uA8CF\uA8F8-\uA8FA\uA8FC\uA92E-\uA92F\uA95F\uA9C1-\uA9CD\uA9DE-\uA9DF\uAA5C-\uAA5F\uAA77-\uAA79\uAADE-\uAADF\uAAF0-\uAAF1\uAB5B`,
  String.raw`\uAB6A-\uAB6B\uABEB\uFB29\uFBB2-\uFBD2\uFD3E-\uFD4F\uFD90-\uFD91\uFDC8-\uFDCF\uFDFC-\uFDFF\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE66\uFE68-\uFE6B\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65\uFFE0-\uFFE6\uFFE8-\uFFEE\uFFFC-\uFFFD\u{10100}-\u{10102}\u{10137}-\u{1013F}\u{10179}-\u{10189}\u{1018C}-\u{1018E}\u{10190}-\u{1019C}\u{101A0}\u{101D0}-\u{101FC}\u{1039F}\u{103D0}\u{1056F}\u{10857}\u{10877}-\u{10878}\u{1091F}\u{1093F}\u{10A50}-\u{10A58}\u{10A7F}\u{10AC8}\u{10AF0}-\u{10AF6}\u{10B39}-\u{10B3F}\u{10B99}-\u{10B9C}\u{10D6E}\u{10D8E}-\u{10D8F}\u{10EAD}\u{10ED0}-\u{10ED8}\u{10F55}-\u{10F59}\u{10F86}-\u{10F89}\u{11047}-\u{1104D}\u{110BB}-\u{110BC}\u{110BE}-\u{110C1}`,
  String.raw`\u{11140}-\u{11143}\u{11174}-\u{11175}\u{111C5}-\u{111C8}\u{111CD}\u{111DB}\u{111DD}-\u{111DF}\u{11238}-\u{1123D}\u{112A9}\u{113D4}-\u{113D5}\u{113D7}-\u{113D8}\u{1144B}-\u{1144F}\u{1145A}-\u{1145B}\u{1145D}\u{114C6}\u{115C1}-\u{115D7}\u{11641}-\u{11643}\u{11660}-\u{1166C}\u{116B9}\u{1173C}-\u{1173F}\u{1183B}\u{11944}-\u{11946}\u{119E2}\u{11A3F}-\u{11A46}\u{11A9A}-\u{11A9C}\u{11A9E}-\u{11AA2}\u{11B00}-\u{11B09}\u{11BE1}\u{11C41}-\u{11C45}\u{11C70}-\u{11C71}\u{11EF7}-\u{11EF8}\u{11F43}-\u{11F4F}\u{11FD5}-\u{11FF1}\u{11FFF}\u{12470}-\u{12474}\u{12FF1}-\u{12FF2}\u{16A6E}-\u{16A6F}\u{16AF5}\u{16B37}-\u{16B3F}\u{16B44}-\u{16B45}\u{16D6D}-\u{16D6F}\u{16E97}-\u{16E9A}\u{16FE2}`,
  String.raw`\u{1BC9C}\u{1BC9F}\u{1CC00}-\u{1CCEF}\u{1CCFA}-\u{1CCFC}\u{1CD00}-\u{1CEB3}\u{1CEBA}-\u{1CED0}\u{1CEE0}-\u{1CEF0}\u{1CF50}-\u{1CFC3}\u{1D000}-\u{1D0F5}\u{1D100}-\u{1D126}\u{1D129}-\u{1D164}\u{1D16A}-\u{1D16C}\u{1D183}-\u{1D184}\u{1D18C}-\u{1D1A9}\u{1D1AE}-\u{1D1EA}\u{1D200}-\u{1D241}\u{1D245}\u{1D300}-\u{1D356}\u{1D6C1}\u{1D6DB}\u{1D6FB}\u{1D715}\u{1D735}\u{1D74F}\u{1D76F}\u{1D789}\u{1D7A9}\u{1D7C3}\u{1D800}-\u{1D9FF}\u{1DA37}-\u{1DA3A}\u{1DA6D}-\u{1DA74}\u{1DA76}-\u{1DA83}\u{1DA85}-\u{1DA8B}\u{1E14F}\u{1E2FF}\u{1E5FF}\u{1E95E}-\u{1E95F}\u{1ECAC}\u{1ECB0}\u{1ED2E}\u{1EEF0}-\u{1EEF1}\u{1F000}-\u{1F02B}\u{1F030}-\u{1F093}\u{1F0A0}-\u{1F0AE}\u{1F0B1}-\u{1F0BF}`,
  String.raw`\u{1F0C1}-\u{1F0CF}\u{1F0D1}-\u{1F0F5}\u{1F10D}-\u{1F1AD}\u{1F1E6}-\u{1F202}\u{1F210}-\u{1F23B}\u{1F240}-\u{1F248}\u{1F250}-\u{1F251}\u{1F260}-\u{1F265}\u{1F300}-\u{1F6D8}\u{1F6DC}-\u{1F6EC}\u{1F6F0}-\u{1F6FC}\u{1F700}-\u{1F7D9}\u{1F7E0}-\u{1F7EB}\u{1F7F0}\u{1F800}-\u{1F80B}\u{1F810}-\u{1F847}\u{1F850}-\u{1F859}\u{1F860}-\u{1F887}\u{1F890}-\u{1F8AD}\u{1F8B0}-\u{1F8BB}\u{1F8C0}-\u{1F8C1}\u{1F8D0}-\u{1F8D8}\u{1F900}-\u{1FA57}\u{1FA60}-\u{1FA6D}\u{1FA70}-\u{1FA7C}\u{1FA80}-\u{1FA8A}\u{1FA8E}-\u{1FAC6}\u{1FAC8}\u{1FACD}-\u{1FADC}\u{1FADF}-\u{1FAEA}\u{1FAEF}-\u{1FAF8}\u{1FB00}-\u{1FB92}\u{1FB94}-\u{1FBEF}\u{1FBFA}`,
].join("");
const paymentSeparatorPattern = new RegExp(`^[${paymentSeparatorCharacterClass}]$`, "u");

export function isWebsitePaymentSeparator(character: string) {
  return paymentSeparatorPattern.test(character);
}

function isWebsitePaymentObfuscatingSeparator(character: string) {
  return isWebsitePaymentSeparator(character) || /[\p{Mark}\p{Format}]/u.test(character);
}

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
    if (isAsciiDigit(character) || isWebsitePaymentObfuscatingSeparator(character)) {
      candidate += character;
      continue;
    }
    if (candidateContainsPaymentNumber(candidate)) return true;
    candidate = "";
  }
  return candidateContainsPaymentNumber(candidate);
}

const formattedPhonePattern = /(?:\+(?=[+0-9 ()/.-]{6,24}(?:$|[^+0-9 ()/.-]))(?=(?:[+ ()/.-]*[0-9]){7,15}(?![+ ()/.-]*[0-9]))|(?<![0-9])[0-9](?=[0-9 ()/-]{6,24}(?:$|[^0-9 ()/-]))(?=(?:[ ()/-]*[0-9]){8,14}(?![ ()/-]*[0-9]))(?=[0-9 ()/-]*[ ()/-][0-9 ()/-]*[ ()/-])|(?<![0-9])(?:1[ ./-])?\(?[2-9][0-9]{2}\)?[ ./-][2-9][0-9]{2}[ ./-][0-9]{4}(?![0-9]))/u;
const compressedNanpPhonePattern = /(?<![0-9])(?:1[ ./-])?(?:(?:\([2-9][0-9]{2}\)[ ./-]*|[2-9][0-9]{2}[ ./-])[2-9][0-9]{6}|[2-9][0-9]{2}[2-9][0-9]{2}[ ./-][0-9]{4})(?![0-9])/u;
const contiguousPhonePattern = /(?<![0-9/])(?:0[0-9]{8,14}|(?=[0-9]{9,15}(?![0-9]))(?:1|2(?:0|1[1-8]|[2-6][0-9]|7|9[0-9])|[3-7]|8(?:0[08]|[1-6]|7[08]|8[0-368])|9(?:[0-5]|6[0-8]|7[0-79]|8|9[1-8]))[0-9]+|(?:1)?[2-9][0-9]{2}[2-9][0-9]{6})(?![0-9])/u;
export const WEBSITE_TWO_RUN_NATIONAL_PHONE_CONTRACT = Object.freeze({
  firstRunPatternSource: String.raw`^0[1-9][0-9]{0,3}$`,
  minimumSubscriberDigits: 5,
  minimumTotalDigits: 9,
  maximumTotalDigits: 15,
});
const twoRunNationalPhonePrefixPattern = new RegExp(
  WEBSITE_TWO_RUN_NATIONAL_PHONE_CONTRACT.firstRunPatternSource,
  "u",
);

function containsBroadlyFormattedPhone(value: string) {
  let candidate = "";
  const candidateIsPhone = () => {
    const first = candidate.search(/[+0-9]/u);
    const last = Math.max(candidate.lastIndexOf("+"), ...Array.from(candidate.matchAll(/[0-9]/gu), (match) => match.index ?? -1));
    if (first < 0 || last < first) return false;
    const bounded = candidate.slice(first, last + 1);
    const digitRuns = bounded.match(/[0-9]+/gu) ?? [];
    if (bounded.startsWith("+")) {
      let leadingDigitCount = 0;
      for (const run of digitRuns) {
        leadingDigitCount += run.length;
        if (leadingDigitCount >= 7 && leadingDigitCount <= 15) return true;
        if (leadingDigitCount > 15) break;
      }
    }
    for (let start = 0; start + 1 < digitRuns.length; start += 1) {
      const prefix = digitRuns[start] ?? "";
      const subscriber = digitRuns[start + 1] ?? "";
      const totalDigits = prefix.length + subscriber.length;
      if (
        twoRunNationalPhonePrefixPattern.test(prefix)
        && subscriber.length >= WEBSITE_TWO_RUN_NATIONAL_PHONE_CONTRACT.minimumSubscriberDigits
        && totalDigits >= WEBSITE_TWO_RUN_NATIONAL_PHONE_CONTRACT.minimumTotalDigits
        && totalDigits <= WEBSITE_TWO_RUN_NATIONAL_PHONE_CONTRACT.maximumTotalDigits
      ) return true;
    }
    for (let start = 0; start < digitRuns.length; start += 1) {
      if ((digitRuns[start]?.length ?? 0) > 3) continue;
      let digitCount = 0;
      for (let end = start; end < Math.min(digitRuns.length, start + 15); end += 1) {
        digitCount += digitRuns[end]?.length ?? 0;
        if (digitCount > 15) break;
        if (end - start >= 2 && digitCount >= 9) return true;
      }
    }
    return false;
  };
  for (const character of value) {
    if (isAsciiDigit(character) || character === "+" || isWebsitePaymentObfuscatingSeparator(character)) {
      candidate += character;
      continue;
    }
    if (candidateIsPhone()) return true;
    candidate = "";
  }
  return candidateIsPhone();
}

function containsLikelyPhone(variants: string[]) {
  return variants.some((variant) => (
    formattedPhonePattern.test(variant)
    || compressedNanpPhonePattern.test(variant)
    || contiguousPhonePattern.test(variant)
    || containsBroadlyFormattedPhone(variant)
  ));
}

function containsProhibitedNumber(variants: string[], compactPaymentVariants: string[]) {
  if (containsLikelyPhone(variants)) return true;
  return [...new Set([...variants, ...compactPaymentVariants])]
    .some((variant) => containsPaymentNumber(variant));
}

function containsUnsafeDisplayData(value: string) {
  if (encodedUnsafeDisplayDelimiterPattern.test(value)) return true;
  const variants = decodedVariants(value);
  if (!variants) return true;
  if (variants.some((variant) => (
    validPercentEscapeCount(normalizedPrivacyProbe(variant))
      > validPercentEscapeCount(variant)
  ))) return true;
  const privacyVariants = [...new Set(variants.flatMap((variant) => [
    variant,
    normalizedPrivacyProbe(variant),
    normalizedNumericPrivacyProbe(variant),
  ]))];
  const spacedPaymentVariants = variants.map((variant) => normalizedNumericPrivacyProbe(variant, " "));
  if (
    containsRawIp(privacyVariants)
    || containsProhibitedNumber(privacyVariants, spacedPaymentVariants)
  ) return true;
  const genericPrivacyVariants = [...new Set([
    ...privacyVariants,
    ...variants.map((variant) => normalizedPrivacyProbe(variant, " ")),
  ])];
  return genericPrivacyVariants.some((variant) => {
    // Only the address probe rewrites separators; safe display values retain
    // their exact representation. This covers ordinary house/unit punctuation
    // without broadening every privacy classifier or returned value.
    const normalizedAddress = variant.replace(/[-_,.;:/\\]+/gu, " ");
    return /[\u0000-\u001F\u007F-\u009F]/u.test(variant)
      || internationalEmailPattern.test(variant)
      || streetAddressPattern.test(normalizedAddress)
      || postOfficeBoxPattern.test(normalizedAddress)
      || containsAuthorizationCredential(variant)
      || standaloneCredentialPattern.test(variant)
      || containsSensitiveKeyValue(variant)
      || containsUrlUserinfo(variant);
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
    if (
      host.includes("@")
      || host.includes(":")
      || containsRawIp([`https://${host}/`])
    ) return "";
    return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/u.test(host)
      ? host
      : "";
  }
  return normalized;
}
