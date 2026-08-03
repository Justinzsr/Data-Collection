import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_RAW_REPORT_BYTES = 64 * 1024 * 1024;
const MAX_SUMMARY_BYTES = 256 * 1024;
const EXPECTED_NODE_VERSION = "v22.22.0";
const EXPECTED_PNPM_VERSION = "10.33.2";
const CHROMIUM_LAUNCH_TIMEOUT_MS = 30_000;
const REQUIRED_VIEWPORT_WIDTHS = [1440, 1024, 768, 390, 360, 320];
const REQUIRED_PLAYWRIGHT_PROJECTS = ["chromium", "mobile"];
const POSTGRES_INTEGRATION_TEST_SUFFIX =
  "/tests/unit/storage/website-funnel-postgres-integration.test.ts";
const EXPECTED_MIGRATIONS = [
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
];
const ARTIFACT_REPORT_FILENAMES = [
  "quality-summary.json",
  "postgresql-summary.json",
  "playwright-summary.json",
  "manifest.json",
];

class EvidenceError extends Error {}

function fail(message) {
  throw new EvidenceError(message);
}

function requiredString(value, field, pattern, maximumLength = 200) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximumLength
    || !pattern.test(value)
  ) {
    fail(`Invalid ${field} in sanitized CI evidence.`);
  }
  return value;
}

function requiredInteger(value, field, maximum = 1_000_000) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    fail(`Invalid ${field} count in CI report.`);
  }
  return value;
}

function requireExact(value, expected, field) {
  if (value !== expected) fail(`Unexpected ${field} in CI report.`);
  return value;
}

function readJson(filePath, maximumBytes, label) {
  let size;
  let raw;
  try {
    const details = statSync(filePath);
    if (!details.isFile()) fail(`${label} is not a regular file.`);
    size = details.size;
    if (size <= 0 || size > maximumBytes) {
      fail(`${label} is empty or exceeds its bounded size.`);
    }
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error instanceof EvidenceError) throw error;
    fail(`Unable to read ${label} without exposing its path or contents.`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    fail(`${label} is not valid JSON.`);
  }
}

function writeJson(filePath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  assertArtifactSafe(serialized);
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, serialized, { encoding: "utf8", mode: 0o600 });
  chmodSync(filePath, 0o600);
}

function safeToolVersion(command, args, field) {
  let output;
  try {
    output = execFileSync(command, args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
    }).trim();
  } catch {
    fail(`Unable to determine ${field} without exposing command output.`);
  }
  return requiredString(output, field, /^[A-Za-z0-9 ._()+-]+$/, 120);
}

function currentRunIdentity() {
  const prHeadSha = requiredString(
    process.env.CI_PR_HEAD_SHA,
    "PR head SHA",
    /^[0-9a-f]{40}$/,
    40,
  );
  const runId = requiredString(
    process.env.GITHUB_RUN_ID,
    "GitHub run ID",
    /^[0-9]{1,24}$/,
    24,
  );
  const runAttempt = requiredInteger(
    Number(process.env.GITHUB_RUN_ATTEMPT),
    "GitHub run attempt",
    10_000,
  );
  if (runAttempt < 1) fail("GitHub run attempt must be positive.");
  return {
    pr_head_sha: prHeadSha,
    run_id: runId,
    run_attempt: runAttempt,
  };
}

function currentRuntime({ includePlaywright = false } = {}) {
  requireExact(process.version, EXPECTED_NODE_VERSION, "Node version");
  const pnpm = safeToolVersion("pnpm", ["--version"], "pnpm version");
  requireExact(pnpm, EXPECTED_PNPM_VERSION, "pnpm version");

  const runtime = {
    node: process.version,
    pnpm,
  };

  if (includePlaywright) {
    const packageJson = readJson(
      path.join(repoRoot, "node_modules/@playwright/test/package.json"),
      MAX_SUMMARY_BYTES,
      "installed Playwright package metadata",
    );
    const packageVersion = requiredString(
      packageJson.version,
      "Playwright package version",
      /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/,
      80,
    );
    const commandVersion = safeToolVersion(
      "pnpm",
      ["exec", "playwright", "--version"],
      "Playwright command version",
    );
    requireExact(commandVersion, `Version ${packageVersion}`, "Playwright command version");
    runtime.playwright = packageVersion;
  }

  return runtime;
}

function canonicalChromiumVersion(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 48
    || !/^(?:0|[1-9][0-9]{0,9})(?:\.(?:0|[1-9][0-9]{0,9})){3}$/.test(value)
    || value.startsWith("0.")
  ) {
    fail("Invalid Chromium binary version in sanitized CI evidence.");
  }
  return value;
}

export async function captureChromiumVersion(injectedLauncher) {
  let launcher = injectedLauncher;
  let browser;
  let version;
  let captureFailed = false;

  try {
    if (launcher === undefined) {
      const playwright = await import("@playwright/test");
      launcher = playwright.chromium;
    }
    if (!launcher || typeof launcher.launch !== "function") {
      fail("Chromium launcher is unavailable for sanitized CI evidence.");
    }
    browser = await launcher.launch({
      headless: true,
      timeout: CHROMIUM_LAUNCH_TIMEOUT_MS,
    });
    if (
      !browser
      || typeof browser.browserType !== "function"
      || typeof browser.version !== "function"
      || typeof browser.close !== "function"
    ) {
      fail("Launched Chromium metadata is unavailable for sanitized CI evidence.");
    }
    const browserType = browser.browserType();
    if (!browserType || typeof browserType.name !== "function" || browserType.name() !== "chromium") {
      fail("Unexpected browser type in sanitized CI evidence.");
    }
    version = canonicalChromiumVersion(browser.version());
  } catch {
    captureFailed = true;
  }

  if (browser && typeof browser.close === "function") {
    try {
      await browser.close();
    } catch {
      fail("Unable to close Chromium after sanitized CI evidence capture.");
    }
  }
  if (captureFailed) {
    fail("Unable to capture Chromium binary version for sanitized CI evidence.");
  }
  return version;
}

function vitestCounts(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    fail("Vitest report has an invalid top-level shape.");
  }
  const total = requiredInteger(report.numTotalTests, "total Vitest tests", 100_000);
  const passed = requiredInteger(report.numPassedTests, "passed Vitest tests", 100_000);
  const failed = requiredInteger(report.numFailedTests, "failed Vitest tests", 100_000);
  const skipped = requiredInteger(report.numPendingTests, "skipped Vitest tests", 100_000);
  const todo = requiredInteger(report.numTodoTests, "todo Vitest tests", 100_000);
  if (passed + failed + skipped !== total || todo > skipped) {
    fail("Vitest totals do not reconcile.");
  }
  if (!Array.isArray(report.testResults) || report.testResults.length > 10_000) {
    fail("Vitest file results are missing or unbounded.");
  }
  return {
    files: report.testResults.length,
    total,
    passed,
    failed,
    skipped,
    todo,
  };
}

function assertOnlyExpectedQualitySkips(report, expectedSkipped) {
  let observedSkipped = 0;
  for (const fileResult of report.testResults) {
    const normalizedName = typeof fileResult?.name === "string"
      ? fileResult.name.replaceAll("\\", "/")
      : "";
    const assertions = Array.isArray(fileResult?.assertionResults)
      ? fileResult.assertionResults
      : [];
    for (const assertion of assertions) {
      if (!["pending", "skipped", "todo", "disabled"].includes(assertion?.status)) continue;
      observedSkipped += 1;
      if (!normalizedName.endsWith(POSTGRES_INTEGRATION_TEST_SUFFIX)) {
        fail("Quality tests contain a skip outside the dedicated PostgreSQL integration suite.");
      }
    }
  }
  if (observedSkipped !== expectedSkipped) {
    fail("Vitest skipped-test totals do not reconcile with file results.");
  }
}

function summarizeVitest(kind, rawReportPath, metadataPath, outputPath) {
  if (!["quality", "postgresql"].includes(kind)) {
    fail("Unknown Vitest evidence kind.");
  }
  const report = readJson(rawReportPath, MAX_RAW_REPORT_BYTES, "raw Vitest report");
  const tests = vitestCounts(report);
  if (
    report.success !== true
    || tests.total === 0
    || tests.passed === 0
    || tests.failed !== 0
  ) {
    fail("Vitest did not complete successfully.");
  }

  const common = {
    schema_version: "1.0",
    ...currentRunIdentity(),
    runtime: currentRuntime(),
    tests,
  };

  if (kind === "quality") {
    if (tests.todo !== 0) fail("Quality tests contain todo cases.");
    assertOnlyExpectedQualitySkips(report, tests.skipped);
    writeJson(outputPath, {
      ...common,
      job: "quality",
    });
    console.log(
      `Sanitized quality evidence: ${tests.passed} passed, ${tests.failed} failed, ${tests.skipped} skipped.`,
    );
    return;
  }

  if (tests.skipped !== 0 || tests.todo !== 0) {
    fail("Dedicated PostgreSQL tests must not skip or defer any case.");
  }
  if (!metadataPath) fail("PostgreSQL metadata is required.");
  const postgres = normalizePostgresMetadata(
    readJson(metadataPath, MAX_SUMMARY_BYTES, "PostgreSQL metadata"),
  );
  writeJson(outputPath, {
    ...common,
    job: "postgresql-17",
    postgres,
  });
  console.log(
    `Sanitized PostgreSQL evidence: ${tests.passed} passed, ${tests.failed} failed, ${tests.skipped} skipped.`,
  );
}

function collectPlaywrightSpecs(suites, destination = []) {
  if (!Array.isArray(suites)) fail("Playwright suites are missing.");
  for (const suite of suites) {
    if (Array.isArray(suite?.specs)) destination.push(...suite.specs);
    if (Array.isArray(suite?.suites)) collectPlaywrightSpecs(suite.suites, destination);
  }
  return destination;
}

function isActualPlaywrightPass(test) {
  const results = Array.isArray(test?.results) ? test.results : [];
  const result = results[0];
  return test?.expectedStatus === "passed"
    && test?.status === "expected"
    && results.length === 1
    && result?.status === "passed"
    && result?.retry === 0
    && (result?.error === undefined || result?.error === null)
    && (
      result?.errors === undefined
      || (Array.isArray(result.errors) && result.errors.length === 0)
    );
}

export function validatePlaywrightReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    fail("Playwright report has an invalid top-level shape.");
  }
  if (
    !report.config
    || typeof report.config !== "object"
    || Array.isArray(report.config)
    || report.config.forbidOnly !== true
  ) {
    fail("Playwright focused-test protection is not enabled.");
  }
  if (!Array.isArray(report.config.projects)) {
    fail("Playwright project configuration is missing.");
  }
  const configuredProjects = report.config.projects.map((project) => project?.name);
  if (
    configuredProjects.length !== REQUIRED_PLAYWRIGHT_PROJECTS.length
    || !REQUIRED_PLAYWRIGHT_PROJECTS.every(
      (name) => configuredProjects.includes(name),
    )
    || report.config.projects.some((project) => project?.retries !== 0)
  ) {
    fail("Playwright project configuration is not approved.");
  }
  const stats = report.stats;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
    fail("Playwright statistics are missing.");
  }
  const expectedOutcomes = requiredInteger(
    stats.expected,
    "expected-outcome Playwright tests",
    100_000,
  );
  const failed = requiredInteger(stats.unexpected, "failed Playwright tests", 100_000);
  const flaky = requiredInteger(stats.flaky, "flaky Playwright tests", 100_000);
  const skipped = requiredInteger(stats.skipped, "skipped Playwright tests", 100_000);
  const aggregateTotal = expectedOutcomes + failed + flaky + skipped;
  if (aggregateTotal === 0 || failed !== 0 || flaky !== 0 || skipped !== 0) {
    fail("Playwright did not complete with a clean, non-skipped result.");
  }
  if (!Array.isArray(report.errors) || report.errors.length !== 0) {
    fail("Playwright reported top-level errors.");
  }

  const specs = collectPlaywrightSpecs(report.suites);
  if (specs.length === 0 || specs.length > 20_000) {
    fail("Playwright spec results are empty or unbounded.");
  }
  const tests = specs.flatMap((spec) => Array.isArray(spec?.tests) ? spec.tests : []);
  if (tests.length !== aggregateTotal) {
    fail("Playwright test totals do not reconcile with spec results.");
  }
  if (tests.some((test) =>
    typeof test?.projectName !== "string"
    || !REQUIRED_PLAYWRIGHT_PROJECTS.includes(test.projectName))) {
    fail("Playwright contains an unapproved project result.");
  }
  const actualPasses = tests.filter(isActualPlaywrightPass);
  if (
    actualPasses.length !== tests.length
    || expectedOutcomes !== actualPasses.length
  ) {
    fail("Playwright contains a result that is not an actual first-attempt pass.");
  }
  const passed = actualPasses.length;
  const total = passed;
  const actualProjects = [...new Set(actualPasses.map((test) => test.projectName))]
    .toSorted();
  if (
    actualProjects.length !== REQUIRED_PLAYWRIGHT_PROJECTS.length
    || !REQUIRED_PLAYWRIGHT_PROJECTS.every((name) => actualProjects.includes(name))
  ) {
    fail("Playwright did not execute every required browser project.");
  }

  for (const width of REQUIRED_VIEWPORT_WIDTHS) {
    const expectedTitle = `dashboard has no horizontal overflow at ${width}`;
    const completed = specs.some((spec) => {
      const normalizedFile = typeof spec?.file === "string"
        ? spec.file.replaceAll("\\", "/")
        : "";
      return (
        normalizedFile === "responsive.spec.ts"
        || normalizedFile === "e2e/responsive.spec.ts"
        || normalizedFile.endsWith("/e2e/responsive.spec.ts")
      )
        && spec.title === expectedTitle
        && Array.isArray(spec.tests)
        && spec.tests.some(
          (test) => test?.projectName === "chromium" && isActualPlaywrightPass(test),
        );
    });
    if (!completed) fail("A required responsive viewport did not execute successfully.");
  }

  const files = new Set(
    specs
      .map((spec) => typeof spec?.file === "string" ? spec.file.replaceAll("\\", "/") : "")
      .filter(Boolean),
  );
  return {
    tests: {
      files: files.size,
      total,
      passed,
      failed,
      flaky,
      skipped,
    },
    projects: REQUIRED_PLAYWRIGHT_PROJECTS,
    viewport_widths: REQUIRED_VIEWPORT_WIDTHS,
  };
}

async function summarizePlaywright(rawReportPath, outputPath) {
  const report = readJson(rawReportPath, MAX_RAW_REPORT_BYTES, "raw Playwright report");
  const summary = validatePlaywrightReport(report);
  const runtime = {
    ...currentRuntime({ includePlaywright: true }),
    chromium: await captureChromiumVersion(),
  };
  writeJson(outputPath, {
    schema_version: "1.0",
    job: "playwright",
    ...currentRunIdentity(),
    runtime,
    ...summary,
  });
  console.log(
    `Sanitized Playwright evidence: ${summary.tests.passed} passed, ${summary.tests.failed} failed, ${summary.tests.flaky} flaky, ${summary.tests.skipped} skipped.`,
  );
}

function assertLocalPostgresUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) fail("Local PostgreSQL CI URL is missing.");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail("Local PostgreSQL CI URL is invalid.");
  }
  if (
    parsed.protocol !== "postgresql:"
    || parsed.hostname !== "127.0.0.1"
    || parsed.port !== "5432"
    || parsed.pathname !== "/moonarq_funnel_ci"
    || parsed.username !== "postgres"
    || parsed.password
    || parsed.search
    || parsed.hash
    || process.env.DATABASE_SSL_MODE !== "disable"
  ) {
    fail("PostgreSQL CI is not restricted to the expected disposable loopback database.");
  }
}

async function prepareLocalPostgresRoles() {
  assertLocalPostgresUrl();
  let client;
  try {
    const pgModule = await import("pg");
    const Client = pgModule.Client ?? pgModule.default?.Client;
    if (typeof Client !== "function") fail("PostgreSQL client package is unavailable.");
    client = new Client({
      connectionString: process.env.DATABASE_URL,
      application_name: "moonarq_funnel_ci_role_setup",
    });
    await client.connect();
    await client.query(`
      do $ci_role_setup$
      begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then
          create role anon nologin;
        end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then
          create role authenticated nologin;
        end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then
          create role service_role nologin;
        end if;
      end
      $ci_role_setup$;
    `);
    const roles = await client.query(`
      select
        rolname,
        rolcanlogin,
        rolsuper,
        rolcreatedb,
        rolcreaterole,
        rolreplication,
        rolbypassrls
      from pg_roles
      where rolname in ('anon', 'authenticated', 'service_role')
      order by rolname
    `);
    const expectedRoles = ["anon", "authenticated", "service_role"];
    if (
      roles.rows.length !== expectedRoles.length
      || !expectedRoles.every((role, index) => roles.rows[index]?.rolname === role)
      || roles.rows.some((role) =>
        role.rolcanlogin
        || role.rolsuper
        || role.rolcreatedb
        || role.rolcreaterole
        || role.rolreplication
        || role.rolbypassrls)
    ) {
      fail("Disposable PostgreSQL roles do not match the local Supabase-compatible fixture.");
    }
  } catch (error) {
    if (error instanceof EvidenceError) throw error;
    fail("Unable to prepare the disposable PostgreSQL role fixture.");
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        fail("Unable to close the disposable PostgreSQL role-setup connection.");
      }
    }
  }
  console.log("Prepared the local Supabase-compatible PostgreSQL role fixture.");
}

function assertExactMigrationList(actual, label) {
  if (
    !Array.isArray(actual)
    || actual.length !== EXPECTED_MIGRATIONS.length
    || !EXPECTED_MIGRATIONS.every((filename, index) => actual[index] === filename)
  ) {
    fail(`${label} is not exactly migrations 0001 through 0010.`);
  }
}

async function verifyPostgres(outputPath) {
  assertLocalPostgresUrl();
  const repositoryMigrations = readdirSync(
    path.join(repoRoot, "src/storage/db/migrations"),
  )
    .filter((filename) => filename.endsWith(".sql"))
    .toSorted();
  assertExactMigrationList(repositoryMigrations, "Repository migration set");

  let client;
  try {
    const pgModule = await import("pg");
    const Client = pgModule.Client ?? pgModule.default?.Client;
    if (typeof Client !== "function") fail("PostgreSQL client package is unavailable.");
    client = new Client({
      connectionString: process.env.DATABASE_URL,
      application_name: "moonarq_funnel_ci_validation",
    });
    await client.connect();
    const versionResult = await client.query(
      "select current_setting('server_version') as version, current_setting('server_version_num') as version_num",
    );
    const migrationsResult = await client.query(
      "select filename from public.schema_migrations order by filename",
    );
    const version = requiredString(
      versionResult.rows[0]?.version,
      "PostgreSQL server version",
      /^[A-Za-z0-9 ._()+-]+$/,
      120,
    );
    const versionNumber = requiredInteger(
      Number(versionResult.rows[0]?.version_num),
      "PostgreSQL server version number",
      99_999_999,
    );
    if (versionNumber < 170_000 || versionNumber >= 180_000) {
      fail("The disposable database is not PostgreSQL 17.");
    }
    const appliedMigrations = migrationsResult.rows.map((row) => row.filename);
    assertExactMigrationList(appliedMigrations, "Applied migration set");
    writeJson(outputPath, {
      server_version: version,
      server_version_num: versionNumber,
      migrations: {
        count: appliedMigrations.length,
        first: appliedMigrations[0],
        last: appliedMigrations.at(-1),
        filenames: appliedMigrations,
      },
    });
    console.log("Disposable PostgreSQL 17 has exactly migrations 0001 through 0010.");
  } catch (error) {
    if (error instanceof EvidenceError) throw error;
    fail("Disposable PostgreSQL verification failed without exposing connection details.");
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        // The runner is disposable; never print connection or socket details during cleanup.
      }
    }
  }
}

function normalizeRunIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Evidence run identity is invalid.");
  }
  return {
    pr_head_sha: requiredString(
      value.pr_head_sha,
      "evidence PR head SHA",
      /^[0-9a-f]{40}$/,
      40,
    ),
    run_id: requiredString(value.run_id, "evidence run ID", /^[0-9]{1,24}$/, 24),
    run_attempt: requiredInteger(value.run_attempt, "evidence run attempt", 10_000),
  };
}

function normalizeRuntime(value, { playwright = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Evidence runtime metadata is invalid.");
  }
  const expectedKeys = playwright
    ? ["chromium", "node", "playwright", "pnpm"]
    : ["node", "pnpm"];
  const actualKeys = Object.keys(value).toSorted();
  if (
    actualKeys.length !== expectedKeys.length
    || !expectedKeys.every((key, index) => actualKeys[index] === key)
  ) {
    fail("Evidence runtime metadata contains an unexpected field.");
  }
  const runtime = {
    node: requireExact(value.node, EXPECTED_NODE_VERSION, "evidence Node version"),
    pnpm: requireExact(value.pnpm, EXPECTED_PNPM_VERSION, "evidence pnpm version"),
  };
  if (playwright) {
    runtime.playwright = requiredString(
      value.playwright,
      "evidence Playwright version",
      /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/,
      80,
    );
    runtime.chromium = canonicalChromiumVersion(value.chromium);
  }
  return runtime;
}

function normalizeTestCounts(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Evidence test counts are invalid.");
  }
  return Object.fromEntries(
    fields.map((field) => [field, requiredInteger(value[field], `evidence ${field}`, 100_000)]),
  );
}

function normalizePostgresMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("PostgreSQL evidence metadata is invalid.");
  }
  const version = requiredString(
    value.server_version,
    "evidence PostgreSQL version",
    /^[A-Za-z0-9 ._()+-]+$/,
    120,
  );
  const versionNumber = requiredInteger(
    value.server_version_num,
    "evidence PostgreSQL version number",
    99_999_999,
  );
  if (versionNumber < 170_000 || versionNumber >= 180_000) {
    fail("Evidence does not describe PostgreSQL 17.");
  }
  const migrations = value.migrations;
  if (!migrations || typeof migrations !== "object" || Array.isArray(migrations)) {
    fail("PostgreSQL migration evidence is invalid.");
  }
  assertExactMigrationList(migrations.filenames, "Evidence migration set");
  requireExact(migrations.count, EXPECTED_MIGRATIONS.length, "evidence migration count");
  requireExact(migrations.first, EXPECTED_MIGRATIONS[0], "evidence first migration");
  requireExact(
    migrations.last,
    EXPECTED_MIGRATIONS.at(-1),
    "evidence last migration",
  );
  return {
    server_version: version,
    server_version_num: versionNumber,
    migrations: {
      count: EXPECTED_MIGRATIONS.length,
      first: EXPECTED_MIGRATIONS[0],
      last: EXPECTED_MIGRATIONS.at(-1),
      filenames: EXPECTED_MIGRATIONS,
    },
  };
}

function normalizeQualitySummary(value) {
  requireExact(value?.schema_version, "1.0", "quality evidence schema");
  requireExact(value?.job, "quality", "quality evidence job");
  const tests = normalizeTestCounts(
    value.tests,
    ["files", "total", "passed", "failed", "skipped", "todo"],
  );
  if (
    tests.files === 0
    || tests.files > tests.total
    || tests.total === 0
    || tests.passed === 0
    || tests.passed + tests.failed + tests.skipped !== tests.total
    || tests.failed !== 0
    || tests.todo !== 0
  ) {
    fail("Quality evidence test counts do not reconcile.");
  }
  return {
    schema_version: "1.0",
    job: "quality",
    ...normalizeRunIdentity(value),
    runtime: normalizeRuntime(value.runtime),
    tests,
  };
}

function normalizePostgresSummary(value) {
  requireExact(value?.schema_version, "1.0", "PostgreSQL evidence schema");
  requireExact(value?.job, "postgresql-17", "PostgreSQL evidence job");
  const tests = normalizeTestCounts(
    value.tests,
    ["files", "total", "passed", "failed", "skipped", "todo"],
  );
  if (
    tests.files === 0
    || tests.files > tests.total
    || tests.total === 0
    || tests.passed !== tests.total
    || tests.failed !== 0
    || tests.skipped !== 0
    || tests.todo !== 0
  ) {
    fail("PostgreSQL evidence test counts do not reconcile.");
  }
  return {
    schema_version: "1.0",
    job: "postgresql-17",
    ...normalizeRunIdentity(value),
    runtime: normalizeRuntime(value.runtime),
    tests,
    postgres: normalizePostgresMetadata(value.postgres),
  };
}

function normalizePlaywrightSummary(value) {
  requireExact(value?.schema_version, "1.0", "Playwright evidence schema");
  requireExact(value?.job, "playwright", "Playwright evidence job");
  if (
    !Array.isArray(value.projects)
    || value.projects.length !== REQUIRED_PLAYWRIGHT_PROJECTS.length
    || !REQUIRED_PLAYWRIGHT_PROJECTS.every((name, index) => value.projects[index] === name)
  ) {
    fail("Playwright project evidence is invalid.");
  }
  if (
    !Array.isArray(value.viewport_widths)
    || value.viewport_widths.length !== REQUIRED_VIEWPORT_WIDTHS.length
    || !REQUIRED_VIEWPORT_WIDTHS.every(
      (width, index) => value.viewport_widths[index] === width,
    )
  ) {
    fail("Playwright viewport evidence is invalid.");
  }
  const tests = normalizeTestCounts(
    value.tests,
    ["files", "total", "passed", "failed", "flaky", "skipped"],
  );
  if (
    tests.files === 0
    || tests.files > tests.total
    || tests.total === 0
    || tests.passed !== tests.total
    || tests.failed !== 0
    || tests.flaky !== 0
    || tests.skipped !== 0
  ) {
    fail("Playwright evidence test counts do not reconcile.");
  }
  return {
    schema_version: "1.0",
    job: "playwright",
    ...normalizeRunIdentity(value),
    runtime: normalizeRuntime(value.runtime, { playwright: true }),
    tests,
    projects: REQUIRED_PLAYWRIGHT_PROJECTS,
    viewport_widths: REQUIRED_VIEWPORT_WIDTHS,
  };
}

function assertArtifactSafe(serialized) {
  const forbiddenPatterns = [
    /postgres(?:ql)?:\/\//i,
    /https?:\/\//i,
    /\b(?:DATABASE_URL|APP_ENCRYPTION_KEY|SUPABASE_SERVICE_ROLE_KEY)\b/i,
    /\b(?:token|secret|password|cookie|credential|payload)\b/i,
    /\.invalid\b/i,
    /%40|%2540/i,
    /@/,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  ];
  if (forbiddenPatterns.some((pattern) => pattern.test(serialized))) {
    fail("Sanitized evidence contains a forbidden sensitive-data marker.");
  }
}

function ensureSameRun(...summaries) {
  const first = summaries[0];
  for (const summary of summaries.slice(1)) {
    if (
      summary.pr_head_sha !== first.pr_head_sha
      || summary.run_id !== first.run_id
      || summary.run_attempt !== first.run_attempt
    ) {
      fail("Evidence fragments do not describe the same exact PR-head run.");
    }
  }
  const expected = currentRunIdentity();
  if (
    first.pr_head_sha !== expected.pr_head_sha
    || first.run_id !== expected.run_id
    || first.run_attempt !== expected.run_attempt
  ) {
    fail("Evidence fragments do not match the current exact PR-head run.");
  }
}

function assembleEvidence(qualityPath, postgresPath, playwrightPath, outputDirectory) {
  const quality = normalizeQualitySummary(
    readJson(qualityPath, MAX_SUMMARY_BYTES, "quality evidence fragment"),
  );
  const postgres = normalizePostgresSummary(
    readJson(postgresPath, MAX_SUMMARY_BYTES, "PostgreSQL evidence fragment"),
  );
  const playwright = normalizePlaywrightSummary(
    readJson(playwrightPath, MAX_SUMMARY_BYTES, "Playwright evidence fragment"),
  );
  ensureSameRun(quality, postgres, playwright);

  if (
    quality.tests.failed !== 0
    || postgres.tests.failed !== 0
    || postgres.tests.skipped !== 0
    || postgres.tests.todo !== 0
    || playwright.tests.failed !== 0
    || playwright.tests.flaky !== 0
    || playwright.tests.skipped !== 0
  ) {
    fail("Only fully successful test evidence may be assembled.");
  }

  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  if (readdirSync(outputDirectory).length !== 0) {
    fail("Final evidence output directory must start empty.");
  }
  chmodSync(outputDirectory, 0o700);

  const normalizedReports = {
    "quality-summary.json": quality,
    "postgresql-summary.json": postgres,
    "playwright-summary.json": playwright,
  };
  for (const [filename, report] of Object.entries(normalizedReports)) {
    writeJson(path.join(outputDirectory, filename), report);
  }

  const manifest = {
    schema_version: "1.0",
    artifact: "moonarq-funnel-overview-pr-validation",
    pr_head_sha: quality.pr_head_sha,
    run_id: quality.run_id,
    run_attempt: quality.run_attempt,
    reports: ARTIFACT_REPORT_FILENAMES.slice(0, 3),
    toolchain: {
      node: quality.runtime.node,
      pnpm: quality.runtime.pnpm,
      postgresql: postgres.postgres.server_version,
      playwright: playwright.runtime.playwright,
      chromium: playwright.runtime.chromium,
    },
    migration_range: {
      count: postgres.postgres.migrations.count,
      first: postgres.postgres.migrations.first,
      last: postgres.postgres.migrations.last,
    },
    counts: {
      unit: quality.tests,
      postgresql: postgres.tests,
      e2e: playwright.tests,
    },
    viewport_widths: playwright.viewport_widths,
    checksum_file: "SHA256SUMS",
  };
  writeJson(path.join(outputDirectory, "manifest.json"), manifest);

  const checksumLines = ARTIFACT_REPORT_FILENAMES.map((filename) => {
    const contents = readFileSync(path.join(outputDirectory, filename));
    const checksum = createHash("sha256").update(contents).digest("hex");
    return `${checksum}  ${filename}`;
  });
  const checksumFile = `${checksumLines.join("\n")}\n`;
  assertArtifactSafe(checksumFile);
  writeFileSync(path.join(outputDirectory, "SHA256SUMS"), checksumFile, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(path.join(outputDirectory, "SHA256SUMS"), 0o600);

  const actualFiles = readdirSync(outputDirectory).toSorted();
  const expectedFiles = [...ARTIFACT_REPORT_FILENAMES, "SHA256SUMS"].toSorted();
  if (
    actualFiles.length !== expectedFiles.length
    || !expectedFiles.every((filename, index) => actualFiles[index] === filename)
  ) {
    fail("Final evidence contains an unexpected file.");
  }
  console.log("Assembled bounded sanitized evidence for the exact PR-head run.");
}

function printUsage() {
  console.log(`Usage:
  node scripts/ci/funnel-overview-evidence.mjs assert-local-postgres
  node scripts/ci/funnel-overview-evidence.mjs prepare-local-postgres
  node scripts/ci/funnel-overview-evidence.mjs verify-postgres <metadata-output>
  node scripts/ci/funnel-overview-evidence.mjs summarize-vitest quality <raw-report> <summary-output>
  node scripts/ci/funnel-overview-evidence.mjs summarize-vitest postgresql <raw-report> <metadata> <summary-output>
  node scripts/ci/funnel-overview-evidence.mjs summarize-playwright <raw-report> <summary-output>
  node scripts/ci/funnel-overview-evidence.mjs assemble <quality> <postgresql> <playwright> <output-directory>`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "help") {
    printUsage();
    return;
  }
  if (command === "assert-local-postgres" && args.length === 0) {
    assertLocalPostgresUrl();
    console.log("PostgreSQL CI target is the expected disposable loopback database.");
    return;
  }
  if (command === "prepare-local-postgres" && args.length === 0) {
    await prepareLocalPostgresRoles();
    return;
  }
  if (command === "verify-postgres" && args.length === 1) {
    await verifyPostgres(args[0]);
    return;
  }
  if (command === "summarize-vitest" && args[0] === "quality" && args.length === 3) {
    summarizeVitest("quality", args[1], null, args[2]);
    return;
  }
  if (
    command === "summarize-vitest"
    && args[0] === "postgresql"
    && args.length === 4
  ) {
    summarizeVitest("postgresql", args[1], args[2], args[3]);
    return;
  }
  if (command === "summarize-playwright" && args.length === 2) {
    await summarizePlaywright(args[0], args[1]);
    return;
  }
  if (command === "assemble" && args.length === 4) {
    assembleEvidence(args[0], args[1], args[2], args[3]);
    return;
  }
  fail("Invalid CI evidence command or argument count.");
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    if (error instanceof EvidenceError) {
      console.error(error.message);
    } else {
      console.error(
        "CI evidence processing failed without exposing report contents or environment values.",
      );
    }
    process.exitCode = 1;
  });
}
