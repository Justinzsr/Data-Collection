import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  captureChromiumVersion,
  normalizeVitestFailureEnvelope,
  validatePlaywrightReport,
} from "../../../scripts/ci/funnel-overview-evidence.mjs";

const requiredWidths = [1440, 1024, 768, 390, 360, 320] as const;
const projectNames = ["chromium", "mobile"] as const;
const chromiumVersion = ["141", "0", "7390", "37"].join(".");
const evidenceScript = path.resolve("scripts/ci/funnel-overview-evidence.mjs");
const migrationFilenames = [
  "0001_initial.sql",
  "0002_reporting_layer.sql",
  "0003_data_spaces.sql",
  "0004_tiktok_data_integrity.sql",
  "0005_foreign_key_indexes.sql",
  "0006_shopify_official_connector.sql",
  "0007_repair_time_zone_rollups.sql",
  "0008_meta_ads_attribution.sql",
  "0009_website_event_contract_v1.sql",
  "0010_rebuild_authoritative_website_metrics.sql",
  "0011_shopify_commerce_bridge_facts.sql",
] as const;
const postgresTestPath = path.resolve(
  "tests/unit/storage/website-funnel-postgres-integration.test.ts",
);
const commercePostgresTestPath = path.resolve(
  "tests/unit/storage/commerce-orders-postgres-integration.test.ts",
);
const scaleTestTitle = "keeps the fixed privacy aggregate within its timeout";

function failedVitestReport(input: {
  title?: string;
  duration?: number;
  failureMessages?: string[];
  fileName?: string;
  fileMessage?: string;
  includeAssertion?: boolean;
} = {}) {
  const includeAssertion = input.includeAssertion ?? true;
  return {
    success: false,
    numTotalTests: 1,
    numPassedTests: 0,
    numFailedTests: includeAssertion ? 1 : 0,
    numPendingTests: includeAssertion ? 0 : 1,
    numTodoTests: 0,
    testResults: [{
      name: input.fileName ?? postgresTestPath,
      status: "failed",
      message: input.fileMessage ?? "",
      assertionResults: includeAssertion
        ? [{
            title: input.title ?? scaleTestTitle,
            status: "failed",
            duration: input.duration ?? 20,
            failureMessages: input.failureMessages ?? ["Error: synthetic failure"],
          }]
        : [{
            title: input.title ?? scaleTestTitle,
            status: "skipped",
            duration: 0,
            failureMessages: [],
          }],
    }],
  };
}

function browserFixture(overrides: {
  browserName?: string;
  browserVersion?: unknown;
  launchError?: Error;
  browserTypeError?: Error;
  nameError?: Error;
  versionError?: Error;
  closeError?: Error;
} = {}) {
  const close = vi.fn(async () => {
    if (overrides.closeError) throw overrides.closeError;
  });
  const newContext = vi.fn(() => {
    throw new Error("Browser contexts are forbidden in evidence capture.");
  });
  const browser = {
    browserType: vi.fn(() => {
      if (overrides.browserTypeError) throw overrides.browserTypeError;
      return {
        name: vi.fn(() => {
          if (overrides.nameError) throw overrides.nameError;
          return overrides.browserName ?? "chromium";
        }),
      };
    }),
    version: vi.fn(() => {
      if (overrides.versionError) throw overrides.versionError;
      return Object.hasOwn(overrides, "browserVersion")
        ? overrides.browserVersion
        : chromiumVersion;
    }),
    close,
    newContext,
  };
  const launch = vi.fn(async () => {
    if (overrides.launchError) throw overrides.launchError;
    return browser;
  });
  return { launcher: { launch }, launch, browser, close, newContext };
}

function evidenceFragments(playwrightChromium: unknown) {
  const identity = {
    pr_head_sha: "a".repeat(40),
    run_id: "123456789",
    run_attempt: 1,
  };
  const runtime = { node: "v22.22.0", pnpm: "10.33.2" };
  return {
    identity,
    quality: {
      schema_version: "1.0",
      job: "quality",
      ...identity,
      runtime,
      tests: { files: 10, total: 100, passed: 99, failed: 0, skipped: 1, todo: 0 },
    },
    postgresql: {
      schema_version: "1.0",
      job: "postgresql-17",
      ...identity,
      runtime,
      tests: { files: 1, total: 3, passed: 3, failed: 0, skipped: 0, todo: 0 },
      postgres: {
        server_version: "17.6",
        server_version_num: 170006,
        migrations: {
          count: migrationFilenames.length,
          first: migrationFilenames[0],
          last: migrationFilenames.at(-1),
          filenames: migrationFilenames,
        },
      },
    },
    playwright: {
      schema_version: "1.0",
      job: "playwright",
      ...identity,
      runtime: {
        ...runtime,
        playwright: "1.59.1",
        chromium: playwrightChromium,
      },
      tests: { files: 5, total: 108, passed: 108, failed: 0, flaky: 0, skipped: 0 },
      projects: projectNames,
      viewport_widths: requiredWidths,
    },
  };
}

function runAssembly(
  playwrightChromium: unknown,
  mutate?: (fragments: ReturnType<typeof evidenceFragments>) => void,
) {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "funnel-evidence-test-"));
  const fragments = evidenceFragments(playwrightChromium);
  mutate?.(fragments);
  const qualityPath = path.join(temporaryDirectory, "quality.json");
  const postgresqlPath = path.join(temporaryDirectory, "postgresql.json");
  const playwrightPath = path.join(temporaryDirectory, "playwright.json");
  const outputPath = path.join(temporaryDirectory, "output");
  writeFileSync(qualityPath, JSON.stringify(fragments.quality));
  writeFileSync(postgresqlPath, JSON.stringify(fragments.postgresql));
  writeFileSync(playwrightPath, JSON.stringify(fragments.playwright));
  const result = spawnSync(process.execPath, [
    evidenceScript,
    "assemble",
    qualityPath,
    postgresqlPath,
    playwrightPath,
    outputPath,
  ], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: {
      ...process.env,
      CI_PR_HEAD_SHA: fragments.identity.pr_head_sha,
      GITHUB_RUN_ID: fragments.identity.run_id,
      GITHUB_RUN_ATTEMPT: String(fragments.identity.run_attempt),
    },
  });
  return { temporaryDirectory, outputPath, result };
}

describe("Vitest failure evidence", () => {
  it("recognizes the dedicated commerce PostgreSQL suite without exposing diagnostics", () => {
    const report = failedVitestReport({
      fileName: commercePostgresTestPath,
      title: "enforces commerce fact truth constraints in PostgreSQL",
      failureMessages: ["AssertionError: synthetic commerce mismatch"],
    });
    expect(normalizeVitestFailureEnvelope("postgresql", report)).toEqual({
      stage: "postgresql",
      test_file: "commerce-orders-postgres-integration.test.ts",
      test_title: "enforces commerce fact truth constraints in PostgreSQL",
      failure_count: 1,
      category: "assertion",
    });
  });

  it.each([
    {
      label: "ordinary test timeout",
      report: failedVitestReport({
        duration: 5_001,
        failureMessages: ["Error: Test timed out in 5000ms."],
      }),
      category: "test_timeout",
    },
    {
      label: "Vitest JSON timeout sentinel",
      report: failedVitestReport({
        duration: 5_025,
        failureMessages: ["Error: STACK_TRACE_ERROR\n    at synthetic-internal-frame"],
      }),
      category: "test_timeout",
    },
    {
      label: "database statement timeout",
      report: failedVitestReport({
        failureMessages: [
          "database error: canceling statement due to statement timeout; raw SQL omitted",
        ],
      }),
      category: "database_statement_timeout",
    },
    {
      label: "assertion failure",
      report: failedVitestReport({
        failureMessages: [
          "AssertionError: expected synthetic result to equal another synthetic result",
        ],
      }),
      category: "assertion",
    },
    {
      label: "setup or hook failure",
      report: failedVitestReport({
        includeAssertion: false,
        fileMessage: "synthetic beforeAll failure",
      }),
      category: "setup_or_hook",
    },
  ])("classifies a $label without returning raw diagnostics", ({ report, category }) => {
    const envelope = normalizeVitestFailureEnvelope("postgresql", report);

    expect(envelope).toEqual({
      stage: "postgresql",
      test_file: "website-funnel-postgres-integration.test.ts",
      test_title: category === "setup_or_hook" ? null : scaleTestTitle,
      failure_count: 1,
      category,
    });
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain("synthetic");
    expect(serialized).not.toContain("statement due");
    expect(serialized).not.toContain("STACK_TRACE_ERROR");
  });

  it("treats an unrecognized failed assertion as unknown", () => {
    const report = failedVitestReport({
      failureMessages: ["Error: synthetic runtime failure"],
    });

    expect(normalizeVitestFailureEnvelope("postgresql", report)).toEqual({
      stage: "postgresql",
      test_file: "website-funnel-postgres-integration.test.ts",
      test_title: scaleTestTitle,
      failure_count: 1,
      category: "unknown",
    });
  });

  it("does not treat a sub-timeout stack sentinel as a test timeout", () => {
    const report = failedVitestReport({
      duration: 4_999,
      failureMessages: ["Error: STACK_TRACE_ERROR\n    at synthetic-internal-frame"],
    });

    expect(normalizeVitestFailureEnvelope("postgresql", report)).toEqual({
      stage: "postgresql",
      test_file: "website-funnel-postgres-integration.test.ts",
      test_title: scaleTestTitle,
      failure_count: 1,
      category: "unknown",
    });
  });

  it("requires the timeout stack sentinel to be the first line", () => {
    const report = failedVitestReport({
      duration: 5_025,
      failureMessages: [
        "Error: synthetic runtime failure\nError: STACK_TRACE_ERROR",
      ],
    });

    expect(normalizeVitestFailureEnvelope("postgresql", report)).toEqual({
      stage: "postgresql",
      test_file: "website-funnel-postgres-integration.test.ts",
      test_title: scaleTestTitle,
      failure_count: 1,
      category: "unknown",
    });
  });

  it("fails closed to unknown for mixed failure categories", () => {
    const report = failedVitestReport({
      failureMessages: ["AssertionError: synthetic mismatch"],
    });
    report.numTotalTests = 2;
    report.numPendingTests = 1;
    report.testResults.push({
      name: postgresTestPath,
      status: "failed",
      message: "synthetic setup failure",
      assertionResults: [{
        title: scaleTestTitle,
        status: "skipped",
        duration: 0,
        failureMessages: [],
      }],
    });

    expect(normalizeVitestFailureEnvelope("postgresql", report)).toEqual({
      stage: "postgresql",
      test_file: null,
      test_title: null,
      failure_count: 2,
      category: "unknown",
    });
  });

  it("counts the actual beforeAll report shape as one setup or hook failure", () => {
    const report = failedVitestReport({
      includeAssertion: false,
      fileMessage: "synthetic beforeAll failure",
    });

    expect(report).toMatchObject({
      numTotalTests: 1,
      numFailedTests: 0,
      numPendingTests: 1,
      testResults: [{ status: "failed" }],
    });
    expect(normalizeVitestFailureEnvelope("postgresql", report)).toEqual({
      stage: "postgresql",
      test_file: "website-funnel-postgres-integration.test.ts",
      test_title: null,
      failure_count: 1,
      category: "setup_or_hook",
    });
  });

  it("withholds unvalidated file and title values", () => {
    const rawPathSentinel = "private-path-sentinel.test.ts";
    const rawTitleSentinel = "private-title-sentinel";
    const rawMessageSentinel = "private-message-sentinel";
    const report = failedVitestReport({
      fileName: path.join(tmpdir(), rawPathSentinel),
      title: rawTitleSentinel,
      failureMessages: [rawMessageSentinel],
    });
    const serialized = JSON.stringify(
      normalizeVitestFailureEnvelope("postgresql", report),
    );

    expect(JSON.parse(serialized)).toEqual({
      stage: "postgresql",
      test_file: null,
      test_title: null,
      failure_count: 1,
      category: "unknown",
    });
    for (const sentinel of [rawPathSentinel, rawTitleSentinel, rawMessageSentinel]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it("rejects report count and failure-message shape mismatches generically", () => {
    const countMismatch = failedVitestReport();
    countMismatch.numFailedTests = 0;
    countMismatch.numPendingTests = 1;
    const rawCountSentinel = "private-count-sentinel";
    countMismatch.testResults[0]!.assertionResults[0]!.failureMessages = [
      rawCountSentinel,
    ];
    const countError = (() => {
      try {
        normalizeVitestFailureEnvelope("postgresql", countMismatch);
      } catch (error) {
        return error;
      }
      return null;
    })();
    expect(countError).toBeInstanceOf(Error);
    expect(String(countError)).toContain("totals do not reconcile");
    expect(String(countError)).not.toContain(rawCountSentinel);

    const messageMismatch = failedVitestReport();
    const rawShapeSentinel = "private-shape-sentinel";
    messageMismatch.testResults[0]!.assertionResults[0]!.failureMessages = [
      rawShapeSentinel,
      ...Array.from({ length: 100 }, () => "synthetic"),
    ];
    const shapeError = (() => {
      try {
        normalizeVitestFailureEnvelope("postgresql", messageMismatch);
      } catch (error) {
        return error;
      }
      return null;
    })();
    expect(shapeError).toBeInstanceOf(Error);
    expect(String(shapeError)).toContain("invalid or unbounded shape");
    expect(String(shapeError)).not.toContain(rawShapeSentinel);
  });

  it("prints only the sanitized envelope and creates no summary on CLI failure", () => {
    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "vitest-failure-envelope-"));
    const rawReportPath = path.join(temporaryDirectory, "raw.json");
    const metadataPath = path.join(temporaryDirectory, "metadata.json");
    const summaryPath = path.join(temporaryDirectory, "summary.json");
    const rawSentinels = [
      ["private-person", "example.invalid"].join("@"),
      ["https:", "//private.invalid/referrer?fixture=raw"].join(""),
      ["postgresql:", "//private.invalid/fixture"].join(""),
      ["DATABASE", "_URL=private-value"].join(""),
      ["Authorization", ": Bearer private-token-value"].join(""),
      "select private_value from private_fixture",
      JSON.stringify({ anonymous_id: "private-browser-identifier" }),
      "00000000-0000-4000-8000-000000000000",
    ];
    const rawReport = failedVitestReport({
      duration: 5_025,
      fileMessage: rawSentinels[5],
      failureMessages: [
        `Error: STACK_TRACE_ERROR\n${rawSentinels.join("\n")}`,
      ],
    });
    Object.assign(rawReport.testResults[0]!.assertionResults[0]!, {
      fullName: rawSentinels[0],
      ancestorTitles: [rawSentinels[1]],
      location: { line: 1, column: 1, source: rawSentinels[2] },
      meta: { fixture: rawSentinels[6] },
      tags: [rawSentinels[3]],
    });
    writeFileSync(rawReportPath, JSON.stringify(rawReport));

    try {
      const result = spawnSync(process.execPath, [
        evidenceScript,
        "summarize-vitest",
        "postgresql",
        rawReportPath,
        metadataPath,
        summaryPath,
      ], {
        cwd: path.resolve("."),
        encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toEqual({
        stage: "postgresql",
        test_file: "website-funnel-postgres-integration.test.ts",
        test_title: scaleTestTitle,
        failure_count: 1,
        category: "test_timeout",
      });
      const processOutput = `${result.stdout}${result.stderr}`;
      for (const sentinel of rawSentinels) expect(processOutput).not.toContain(sentinel);
      for (const transientPath of [
        temporaryDirectory,
        rawReportPath,
        metadataPath,
        summaryPath,
      ]) {
        expect(processOutput).not.toContain(transientPath);
      }
      expect(() => readFileSync(summaryPath)).toThrow();
      expect(() => readFileSync(metadataPath)).toThrow();
      expect(() => readFileSync(path.join(temporaryDirectory, "artifact.json"))).toThrow();
      expect(readdirSync(temporaryDirectory)).toEqual(["raw.json"]);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

describe("Chromium binary evidence", () => {
  it("captures the actual canonical version and closes the browser exactly once", async () => {
    const fixture = browserFixture();

    await expect(captureChromiumVersion(fixture.launcher)).resolves.toBe(chromiumVersion);
    expect(fixture.launch).toHaveBeenCalledOnce();
    expect(fixture.launch).toHaveBeenCalledWith({ headless: true, timeout: 30_000 });
    expect(fixture.browser.browserType).toHaveBeenCalledOnce();
    expect(fixture.browser.version).toHaveBeenCalledOnce();
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(fixture.newContext).not.toHaveBeenCalled();
  });

  it("rejects a non-Chromium browser and still closes it", async () => {
    const fixture = browserFixture({ browserName: "firefox" });

    await expect(captureChromiumVersion(fixture.launcher)).rejects.toThrow(
      "Unable to capture Chromium binary version",
    );
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it.each([
    { label: "missing", value: undefined },
    { label: "empty", value: "" },
    { label: "non-string", value: 141 },
    { label: "three-part", value: "141.0.7390" },
    { label: "five-part", value: "141.0.7390.37.1" },
    { label: "labeled", value: "Chromium 141.0.7390.37" },
    { label: "path-like", value: "/cache/141.0.7390.37" },
    { label: "URL-like", value: "https://browser.invalid/141.0.7390.37" },
    { label: "newline-containing", value: "141.0.7390.37\n" },
    { label: "suffixed", value: "141.0.7390.37-beta" },
    { label: "leading-zero", value: "141.00.7390.37" },
    { label: "zero-major", value: "0.0.7390.37" },
    { label: "overlong", value: "141.12345678901.7390.37" },
  ])("rejects a $label version and still closes the browser", async ({ value }) => {
    const fixture = browserFixture({ browserVersion: value });

    await expect(captureChromiumVersion(fixture.launcher)).rejects.toThrow(
      "Unable to capture Chromium binary version",
    );
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it.each([
    { label: "launch", overrides: { launchError: new Error("raw-launch-sentinel") }, closes: 0 },
    {
      label: "browser type",
      overrides: { browserTypeError: new Error("raw-browser-type-sentinel") },
      closes: 1,
    },
    { label: "type name", overrides: { nameError: new Error("raw-name-sentinel") }, closes: 1 },
    { label: "version", overrides: { versionError: new Error("raw-version-sentinel") }, closes: 1 },
  ])("sanitizes a $label failure", async ({ overrides, closes }) => {
    const fixture = browserFixture(overrides);
    const error = await captureChromiumVersion(fixture.launcher).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("Unable to capture Chromium binary version");
    expect(String(error)).not.toContain("raw-");
    expect(fixture.close).toHaveBeenCalledTimes(closes);
  });

  it("rejects a close failure without exposing its cause", async () => {
    const fixture = browserFixture({ closeError: new Error("raw-close-sentinel") });
    const error = await captureChromiumVersion(fixture.launcher).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("Unable to close Chromium");
    expect(String(error)).not.toContain("raw-close-sentinel");
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it("assembles only the normalized Chromium version into both evidence files", () => {
    const assembly = runAssembly(chromiumVersion);
    try {
      expect(assembly.result.status).toBe(0);
      const playwright = JSON.parse(readFileSync(
        path.join(assembly.outputPath, "playwright-summary.json"),
        "utf8",
      ));
      const manifest = JSON.parse(readFileSync(
        path.join(assembly.outputPath, "manifest.json"),
        "utf8",
      ));
      expect(playwright.runtime).toEqual({
        node: "v22.22.0",
        pnpm: "10.33.2",
        playwright: "1.59.1",
        chromium: chromiumVersion,
      });
      expect(manifest.toolchain.chromium).toBe(chromiumVersion);
      expect(manifest.toolchain.chromium).toBe(playwright.runtime.chromium);
      const serialized = `${JSON.stringify(playwright)}${JSON.stringify(manifest)}`;
      for (const forbiddenKey of [
        "executablePath",
        "userDataDir",
        "processId",
        "userAgent",
        "environment",
      ]) {
        expect(serialized).not.toContain(forbiddenKey);
      }
    } finally {
      rmSync(assembly.temporaryDirectory, { recursive: true, force: true });
    }
  });

  it.each([
    { label: "missing", value: undefined },
    { label: "polluted", value: "141.0.7390.37\npath" },
    { label: "wrong-shape", value: { version: chromiumVersion } },
  ])("prevents assembly with a $label Chromium version", ({ value }) => {
    const assembly = runAssembly(value);
    try {
      expect(assembly.result.status).not.toBe(0);
      expect(() => readFileSync(path.join(assembly.outputPath, "manifest.json"))).toThrow();
      expect(`${assembly.result.stdout}${assembly.result.stderr}`).not.toContain(String(value));
    } finally {
      rmSync(assembly.temporaryDirectory, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: "zero Playwright tests",
      mutate: (fragments: ReturnType<typeof evidenceFragments>) => {
        fragments.playwright.tests.total = 0;
        fragments.playwright.tests.passed = 0;
      },
    },
    {
      label: "contradictory quality totals",
      mutate: (fragments: ReturnType<typeof evidenceFragments>) => {
        fragments.quality.tests.passed = 100;
      },
    },
    {
      label: "more Playwright files than tests",
      mutate: (fragments: ReturnType<typeof evidenceFragments>) => {
        fragments.playwright.tests.files = 109;
      },
    },
    {
      label: "unexpected browser path metadata",
      mutate: (fragments: ReturnType<typeof evidenceFragments>) => {
        Object.assign(fragments.playwright.runtime, {
          executablePath: "/synthetic/browser/path",
        });
      },
    },
  ])("rejects $label during final assembly", ({ mutate }) => {
    const assembly = runAssembly(chromiumVersion, mutate);
    try {
      expect(assembly.result.status).not.toBe(0);
      expect(() => readFileSync(path.join(assembly.outputPath, "manifest.json"))).toThrow();
    } finally {
      rmSync(assembly.temporaryDirectory, { recursive: true, force: true });
    }
  });
});

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
