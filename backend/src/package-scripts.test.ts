import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A developer's `npm run dev` must never pick up the production settings kept in backend/.env (and so never reach the hosted database), and the
// hosted service must read its settings from the platform only.

const scripts = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> }).scripts;
const envFiles = (command: string): string[] => [...command.matchAll(/--env-file(?:-if-exists)?=([^\s"\\]+)/g)].map((m) => m[1]!);
const development = Object.keys(scripts).filter((name) => name === "dev" || name.endsWith(":dev"));

describe("npm scripts keep development apart from production", () => {
  it("has a development variant of every command a developer needs", () => {
    expect(development.sort()).toEqual(["db:seed:events:dev", "db:status:dev", "dev", "migrate:dev", "staff:create-admin:dev", "staff:reset-password:dev", "staff:seed-super-admin:dev"]);
  });
  it("reads only .env.development.local in every development script, and fails when that file is missing instead of carrying on without it", () => {
    for (const name of development) {
      expect(envFiles(scripts[name]!), name).toEqual([".env.development.local"]);
      expect(scripts[name], name).not.toContain("--env-file-if-exists"); // a missing file must be an error, never a silent switch to other settings
    }
  });
  it("never loads backend/.env (the production settings) from the dev server", () => {
    expect(scripts.dev).not.toMatch(/--env-file(?:-if-exists)?=\.env(?![.\w])/);
  });
  it("starts the hosted service without any env file: Railway's variables are the only source", () => {
    expect(scripts.start).toBe("node dist/server.js");
    expect(envFiles(scripts.start!)).toEqual([]);
  });
});
