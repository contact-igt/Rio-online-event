import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const roster = readFileSync(join(process.cwd(), "components", "admin", "judge-roster.tsx"), "utf8");

describe("admin judge roster interactions", () => {
  it("provides a card-based filter popover with apply and clear controls", () => {
    expect(roster).toContain('aria-haspopup="menu"');
    expect(roster).toContain("Apply filters");
    expect(roster).toContain("Clear all");
    expect(roster).toContain("activeFilterCount");
  });

  it("keeps search, filtering, and six-row pagination client-side", () => {
    expect(roster).toContain("const PAGE_SIZE = 6");
    expect(roster).toContain("judge.name");
    expect(roster).toContain("judge.mustChangePassword");
    expect(roster).toContain("setPage(1)");
  });

  it("opens row actions in the same accessible menu pattern", () => {
    expect(roster).toContain("Actions for ${judge.name}");
    expect(roster).toContain("DeactivateJudgeDialog");
    expect(roster).toContain("ResetJudgeDialog");
    expect(roster).toContain("role=\"menu\"");
  });
});
