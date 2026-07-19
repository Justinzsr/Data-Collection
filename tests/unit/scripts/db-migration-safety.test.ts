import { describe, expect, it } from "vitest";
import {
  assertSafeDatabaseMigrationTransport,
  DatabaseMigrationTransportError,
} from "../../../scripts/db-migration-safety";

describe("database migration transport safety", () => {
  it("allows local PostgreSQL and a certificate-verified remote connection", () => {
    expect(() =>
      assertSafeDatabaseMigrationTransport({
        databaseUrl: "postgresql://local:local@localhost:5432/local",
        sslMode: "disable",
      }),
    ).not.toThrow();
    expect(() =>
      assertSafeDatabaseMigrationTransport({
        databaseUrl: "postgresql://operator:secret@session.example.invalid:5432/postgres",
      }),
    ).not.toThrow();
  });

  it.each([
    "postgresql://operator:secret@pooler.example.invalid:6543/postgres",
    "postgresql://operator:secret@pooler.example.invalid:5432/postgres?pgbouncer=true",
  ])("rejects transaction-pooler transport without echoing its URL", (databaseUrl) => {
    expect(() => assertSafeDatabaseMigrationTransport({ databaseUrl })).toThrow(
      DatabaseMigrationTransportError,
    );
    try {
      assertSafeDatabaseMigrationTransport({ databaseUrl });
    } catch (error) {
      expect(String(error)).not.toContain(databaseUrl);
      expect(String(error)).not.toContain("secret");
    }
  });

  it.each([
    { sslMode: "disable" },
    { sslMode: "no-verify" },
    { sslNoVerify: "true" },
  ])("rejects unverified TLS for a remote migration", (settings) => {
    expect(() =>
      assertSafeDatabaseMigrationTransport({
        databaseUrl: "postgresql://operator:secret@database.example.invalid:5432/postgres",
        ...settings,
      }),
    ).toThrow("certificate-verified TLS");
  });

  it("requires an explicit CA for Supabase migrations without changing runtime defaults", () => {
    const databaseUrl = "postgresql://operator:secret@pooler.supabase.com:5432/postgres";
    expect(() => assertSafeDatabaseMigrationTransport({ databaseUrl })).toThrow(
      "DATABASE_SSL_CA",
    );
    expect(() =>
      assertSafeDatabaseMigrationTransport({
        databaseUrl,
        sslCa: "approved-ca-certificate",
      }),
    ).not.toThrow();
  });
});
