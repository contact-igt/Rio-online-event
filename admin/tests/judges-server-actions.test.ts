import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const actions = readFileSync(join(process.cwd(), "app", "admin", "judges", "actions.ts"), "utf8");

describe("judge deletion server actions", () => {
  it("declares restore and purge as async exports", () => {
    expect(actions).toMatch(/export async function restoreJudge\(input: \{ judgeId: string \}\)/);
    expect(actions).toMatch(/export async function purgeJudge\(input: \{ judgeId: string \}\)/);
  });
});
