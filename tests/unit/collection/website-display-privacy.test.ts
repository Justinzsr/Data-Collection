import { describe, expect, it } from "vitest";
import { sanitizeWebsiteDisplayDimension } from "@/collection/tracking/website-display-privacy";

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
    { label: "a fully safe UTM", value: "spring-sale_2026" },
    { label: "a bounded encoded non-PII value", value: "spring%20sale" },
    { label: "a safe value decoded on exactly three passes", value: "spring%252520sale" },
    { label: "the Unknown sentinel", value: "Unknown" },
  ])("preserves $label without changing its representation", ({ value }) => {
    expect(() => sanitizeWebsiteDisplayDimension(value, "utm", 256)).not.toThrow();
    expect(sanitizeWebsiteDisplayDimension(value, "utm", 256)).toBe(value);
  });
});
