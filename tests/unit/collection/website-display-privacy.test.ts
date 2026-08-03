import { describe, expect, it } from "vitest";
import { sanitizeWebsiteDisplayDimension } from "@/collection/tracking/website-display-privacy";

const syntheticPan13 = ["700", "000", "000", "000", "3"].join("");
const syntheticPan16 = ["7000", "0000", "0000", "0005"].join("");
const syntheticPan19 = ["700", "0000", "0000", "0000", "000", "3"].join("");
const dottedPan16 = syntheticPan16.match(/.{1,4}/gu)!.join(".");
const invalidDottedPan16 = ["7000", "0000", "0000", "0100"].join(".");
const slashPan16 = syntheticPan16.match(/.{1,4}/gu)!.join("/");
const uninterruptedTwentyDigitIdentifier = `${syntheticPan19}5`;

describe("Website display privacy", () => {
  it.each([
    {
      label: "malformed escape before an encoded email delimiter",
      value: "private-person%ZZ%40example.invalid",
    },
    {
      label: "malformed escape combined with double encoding",
      value: "private-person%25ZZ%2540example.invalid",
    },
    {
      label: "malformed escape after an encoded email delimiter",
      value: "private-person%40example.invalid%ZZ",
    },
    {
      label: "incomplete UTF-8 combined with an encoded canary",
      value: "private-person%E0%A4%A%40example.invalid",
    },
    {
      label: "invalid UTF-8 combined with an encoded canary",
      value: "private-person%C3%28%40example.invalid",
    },
    {
      label: "encoding deeper than the three-pass inspection bound",
      value: "private-person%25252540example.invalid",
    },
    {
      label: "an unsafe delimiter decoded on the third bounded pass",
      value: "private-person%252540example.invalid",
    },
    {
      label: "malformed encoding reached on the third pass",
      value: "campaign%2525ZZ",
    },
    {
      label: "a benign malformed literal percent",
      value: "spring%ZZsale",
    },
    {
      label: "malformed credential-like delimiters",
      value: "credential%ZZ%3Asynthetic",
    },
  ])("rejects $label without throwing", ({ value }) => {
    expect(() => sanitizeWebsiteDisplayDimension(value, "utm", 256)).not.toThrow();
    expect(sanitizeWebsiteDisplayDimension(value, "utm", 256)).toBe("");
  });

  it.each([
    { label: "the reported dotted candidate", value: dottedPan16 },
    { label: "a dotted candidate embedded between words", value: `launch-${dottedPan16}-archive` },
    { label: "mixed ASCII separators", value: "7000,0000_0000/0005" },
    { label: "additional punctuation separators", value: "7000;0000!0000=0005" },
    { label: "Unicode whitespace and dash separators", value: "7000\u00a00000\u20140000\u20090005" },
    { label: "a contiguous candidate", value: syntheticPan16 },
    { label: "the 13-digit boundary", value: syntheticPan13 },
    { label: "the 19-digit boundary", value: syntheticPan19 },
    { label: "once-encoded separators", value: encodeURIComponent(slashPan16) },
    { label: "twice-encoded separators", value: encodeURIComponent(encodeURIComponent(slashPan16)) },
    {
      label: "three-times-encoded separators",
      value: encodeURIComponent(encodeURIComponent(encodeURIComponent(slashPan16))),
    },
    {
      label: "an invalid candidate before a later valid candidate",
      value: `first-${invalidDottedPan16}-then-${dottedPan16}`,
    },
    { label: "multiple candidates", value: `${dottedPan16}|${syntheticPan13}` },
    {
      label: "a long identifier followed by a separate valid candidate",
      value: `${uninterruptedTwentyDigitIdentifier}-${dottedPan16}`,
    },
    { label: "a valid candidate with short surrounding runs", value: `9-${dottedPan16}-8` },
    { label: "malformed encoding combined with a candidate", value: `%ZZ-${dottedPan16}` },
  ])("rejects $label without throwing", ({ value }) => {
    expect(() => sanitizeWebsiteDisplayDimension(value, "utm", 256)).not.toThrow();
    expect(sanitizeWebsiteDisplayDimension(value, "utm", 256)).toBe("");
  });

  it.each([
    { label: "a fully safe UTM", value: "spring-sale_2026" },
    { label: "a bounded encoded non-PII value", value: "spring%20sale" },
    { label: "a safe value decoded on exactly three passes", value: "spring%252520sale" },
    { label: "the Unknown sentinel", value: "Unknown" },
    { label: "the dotted shape with an invalid check digit", value: invalidDottedPan16 },
    { label: "an ordinary dotted build value", value: "release.2026.08.02.build.14" },
    { label: "a 12-digit lookalike", value: "7000.0000.0003" },
    { label: "an uninterrupted 20-digit identifier", value: uninterruptedTwentyDigitIdentifier },
    {
      label: "a long identifier followed only by a short numeric fragment",
      value: `${uninterruptedTwentyDigitIdentifier}-12`,
    },
    { label: "numeric fragments separated by letters", value: "700000A000000B005" },
  ])("preserves $label without changing its representation", ({ value }) => {
    expect(() => sanitizeWebsiteDisplayDimension(value, "utm", 256)).not.toThrow();
    expect(sanitizeWebsiteDisplayDimension(value, "utm", 256)).toBe(value);
  });
});
