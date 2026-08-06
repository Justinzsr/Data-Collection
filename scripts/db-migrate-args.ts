export interface DatabaseMigrationCliOptions {
  target: string | null;
}

export function parseDatabaseMigrationArgs(args: readonly string[]): DatabaseMigrationCliOptions {
  let target: string | null = null;
  const migrationArgs = args[0] === "--" ? args.slice(1) : args;

  for (let index = 0; index < migrationArgs.length; index += 1) {
    const argument = migrationArgs[index];
    if (argument === "--to") {
      if (target !== null) throw new Error("The --to option may only be provided once.");
      const value = migrationArgs[index + 1]?.trim() ?? "";
      if (!value || value.startsWith("--")) {
        throw new Error("The --to option requires a migration filename.");
      }
      target = value;
      index += 1;
      continue;
    }

    if (argument.startsWith("--to=")) {
      if (target !== null) throw new Error("The --to option may only be provided once.");
      const value = argument.slice("--to=".length).trim();
      if (!value) throw new Error("The --to option requires a migration filename.");
      target = value;
      continue;
    }

    throw new Error(`Unknown migration argument: ${argument || "(empty)"}`);
  }

  return { target };
}
