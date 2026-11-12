import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(join(process.cwd(), "app", "admin", "questions", "page.tsx"), "utf8");
const competitions = readFileSync(join(process.cwd(), "components", "admin", "competition-links.tsx"), "utf8");

describe("Questions page layout", () => {
  it("uses the approved compact page header and shared content container", () => {
    expect(page).toContain("Question management");
    expect(page).toContain("max-w-[1200px]");
    expect(page).toContain("text-[clamp(1.75rem,4vw,2rem)]");
    expect(page).toContain("Manage the shared question versions");
  });

  it("keeps versions, selected details and assignments as aligned cards", () => {
    expect(page).toContain("Versions");
    expect(page).toContain("Published versions are read-only. Only draft versions can be edited.");
    expect(page).toContain("grid-cols-[2.75rem_minmax(0,1fr)_auto]");
    expect(page).toContain("Used By");
    expect(competitions).toContain("sm:grid-cols-2");
    expect(competitions).toContain("min-h-[170px]");
  });

  it("gives the Versions card a clear desktop hierarchy and mobile stack", () => {
    expect(page).toContain("Available versions");
    expect(page).toContain("lg:grid-cols-[minmax(0,1fr)_18rem]");
    expect(page).toContain("lg:items-start");
    expect(page).toContain("From v");
    expect(page).toContain("Blank");
  });

  it("keeps the version controls visually balanced inside the card", () => {
    expect(page).toContain("Create draft");
    expect(page).toContain("sm:grid-cols-2");
    expect(page).toContain("min-h-14");
  });
});
