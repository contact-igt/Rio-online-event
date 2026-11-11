import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The consolidated interface intentionally removes the previous overlapping setup and production aliases.
describe("database command scripts", () => {
  it("exposes migrate, read-only status and guarded drop as the database entrypoints", () => {
    const scripts = JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf8")).scripts as Record<string, string>;
    expect(scripts.migrate).toBe("node --env-file-if-exists=.env src/db/cli.ts migrate");
    expect(scripts["db:status"]).toBe("node --env-file-if-exists=.env src/db/cli.ts status");
    expect(scripts["db:drop"]).toBe("node --env-file-if-exists=.env src/db/cli.ts drop");
    expect(scripts["db:verify"]).toBe("node --env-file-if-exists=.env src/db/cli.ts verify");
    for (const alias of ["db:setup", "db:setup:production", "db:migrate", "db:status:production", "db:ready", "db:ready:production", "db:reset:test"]) expect(scripts[alias]).toBeUndefined();
  });

  it("keeps database changes out of server start, dev startup, build and tests", () => {
    const scripts = JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf8")).scripts as Record<string, string>;
    for (const name of ["dev", "start", "build", "test"]) expect(scripts[name]).not.toMatch(/src\/db\/cli|migrate/);
  });
});
