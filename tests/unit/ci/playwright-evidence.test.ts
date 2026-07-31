import { describe, expect, it, vi } from "vitest";
import { validatePlaywrightReport } from "../../../scripts/ci/funnel-overview-evidence.mjs";

const requiredWidths = [1440, 1024, 768, 390, 360, 320] as const;
const projectNames = ["chromium", "mobile"] as const;

function passedTest(projectName: (typeof projectNames)[number]) {
  return {
    expectedStatus: "passed",
    projectName,
    status: "expected",
    results: [{
      status: "passed",
      retry: 0,
      errors: [],
    }],
  };
}

function validReport() {
  const specs = requiredWidths.map((width) => ({
    file: "e2e/responsive.spec.ts",
    title: `dashboard has no horizontal overflow at ${width}`,
    tests: projectNames.map(passedTest),
  }));
  return {
    config: {
      forbidOnly: true,
      projects: projectNames.map((name) => ({ name, retries: 0 })),
    },
    errors: [],
    stats: {
      expected: specs.length * projectNames.length,
      unexpected: 0,
      flaky: 0,
      skipped: 0,
    },
    suites: [{
      title: "responsive.spec.ts",
      file: "e2e/responsive.spec.ts",
      specs,
    }],
  };
}

function flattenedTests(report: ReturnType<typeof validReport>) {
  return report.suites.flatMap((suite) => suite.specs.flatMap((spec) => spec.tests));
}

describe("Playwright evidence validation", () => {
  it("accepts ordinary first-attempt passes and derives the actual count", () => {
    const report = validReport();
    const resultWithAbsentErrors = flattenedTests(report)[0]!.results[0]! as {
      errors?: object[];
    };
    delete resultWithAbsentErrors.errors;
    const summary = validatePlaywrightReport(report);

    expect(summary.tests).toEqual({
      files: 1,
      total: 12,
      passed: 12,
      failed: 0,
      flaky: 0,
      skipped: 0,
    });
  });

  it("rejects an expected failed outcome even when aggregate status is expected", () => {
    const report = validReport();
    const test = flattenedTests(report)[0]!;
    test.expectedStatus = "failed";
    test.results[0]!.status = "failed";

    expect(() => validatePlaywrightReport(report)).toThrow();
  });

  it.each(["timedOut", "interrupted"])(
    "rejects an expected %s outcome",
    (status) => {
      const report = validReport();
      const test = flattenedTests(report)[0]!;
      test.expectedStatus = status;
      test.results[0]!.status = status;

      expect(() => validatePlaywrightReport(report)).toThrow();
    },
  );

  it("rejects a tampered concrete result status", () => {
    const report = validReport();
    flattenedTests(report)[0]!.results[0]!.status = "failed";

    expect(() => validatePlaywrightReport(report)).toThrow();
  });

  it("rejects a retried result", () => {
    const report = validReport();
    flattenedTests(report)[0]!.results[0]!.retry = 1;

    expect(() => validatePlaywrightReport(report)).toThrow();
  });

  it("rejects multiple concrete results", () => {
    const report = validReport();
    const test = flattenedTests(report)[0]!;
    test.results.push({
      status: "passed",
      retry: 1,
      errors: [],
    });

    expect(() => validatePlaywrightReport(report)).toThrow();
  });

  it("rejects a skipped expected outcome", () => {
    const report = validReport();
    const test = flattenedTests(report)[0]!;
    test.expectedStatus = "skipped";
    test.status = "skipped";
    test.results[0]!.status = "skipped";
    report.stats.expected -= 1;
    report.stats.skipped = 1;

    expect(() => validatePlaywrightReport(report)).toThrow();
  });

  it.each(["singular", "array"] as const)("rejects a %s result error", (kind) => {
    const report = validReport();
    const result = flattenedTests(report)[0]!.results[0]! as {
      status: string;
      retry: number;
      error?: object;
      errors?: object[];
    };
    if (kind === "singular") result.error = { message: "synthetic" };
    else result.errors = [{ message: "synthetic" }];

    expect(() => validatePlaywrightReport(report)).toThrow();
  });

  it.each(["missing", "false"] as const)(
    "rejects %s focused-test protection",
    (kind) => {
      const report = validReport();
      const config = report.config as { forbidOnly?: boolean; projects: unknown[] };
      if (kind === "missing") delete config.forbidOnly;
      else config.forbidOnly = false;

      expect(() => validatePlaywrightReport(report)).toThrow();
    },
  );

  it.each(["missing", "unapproved"] as const)("rejects a %s project name", (kind) => {
    const report = validReport();
    const test = flattenedTests(report)[0]! as {
      projectName?: string;
    };
    if (kind === "missing") delete test.projectName;
    else test.projectName = "synthetic-browser";

    expect(() => validatePlaywrightReport(report)).toThrow();
  });

  it("rejects retry-enabled project configuration", () => {
    const report = validReport();
    report.config.projects[0]!.retries = 1;

    expect(() => validatePlaywrightReport(report)).toThrow();
  });

  it("rejects a responsive width without an actual Chromium pass", () => {
    const report = validReport();
    const target = report.suites[0]!.specs.find((spec) =>
      spec.title.endsWith("320"))!;
    target.tests = target.tests.filter((test) => test.projectName !== "chromium");
    report.stats.expected -= 1;

    expect(() => validatePlaywrightReport(report)).toThrow();
  });

  it("enables focused-test protection and zero retries in CI configuration", async () => {
    vi.stubEnv("CI", "1");
    vi.resetModules();
    const { default: config } = await import("../../../playwright.config");

    expect(config.forbidOnly).toBe(true);
    expect(config.retries).toBe(0);
    vi.unstubAllEnvs();
  });
});
