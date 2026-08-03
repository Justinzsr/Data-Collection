import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  captureChromiumVersion,
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
] as const;

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
