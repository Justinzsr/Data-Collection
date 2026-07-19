import { describe, expect, it } from "vitest";
import { parseDatabaseMigrationArgs } from "../../../scripts/db-migrate-args";

describe("database migration CLI arguments", () => {
  it("allows an unbounded migration run when no arguments are provided", () => {
    expect(parseDatabaseMigrationArgs([])).toEqual({ target: null });
  });

  it("accepts a separated target filename", () => {
    expect(parseDatabaseMigrationArgs(["--to", "0009_website_event_contract_v1.sql"])).toEqual({
      target: "0009_website_event_contract_v1.sql",
    });
  });

  it("accepts pnpm's leading argument delimiter", () => {
    expect(parseDatabaseMigrationArgs(["--", "--to", "0009_website_event_contract_v1.sql"])).toEqual({
      target: "0009_website_event_contract_v1.sql",
    });
  });

  it("accepts an equals-form target filename", () => {
    expect(parseDatabaseMigrationArgs(["--to=0010_rebuild_authoritative_website_metrics.sql"])).toEqual({
      target: "0010_rebuild_authoritative_website_metrics.sql",
    });
  });

  it.each([
    { args: ["--to"], error: "requires a migration filename" },
    { args: ["--to="], error: "requires a migration filename" },
    { args: ["--to", "--other"], error: "requires a migration filename" },
    { args: ["--to=0009_website_event_contract_v1.sql", "--"], error: "Unknown migration argument" },
    { args: ["--ot", "0009_website_event_contract_v1.sql"], error: "Unknown migration argument" },
    { args: ["0009_website_event_contract_v1.sql"], error: "Unknown migration argument" },
    {
      args: ["--to=0009_website_event_contract_v1.sql", "--to", "0010_rebuild_authoritative_website_metrics.sql"],
      error: "may only be provided once",
    },
  ])("rejects unsafe arguments: $args", ({ args, error }) => {
    expect(() => parseDatabaseMigrationArgs(args)).toThrow(error);
  });
});
