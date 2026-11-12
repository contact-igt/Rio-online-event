import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const judgesPage = readFileSync(join(process.cwd(), "app", "admin", "judges", "page.tsx"), "utf8");
const judgeForm = readFileSync(join(process.cwd(), "components", "admin", "provision-judge-form.tsx"), "utf8");
const judgeRoster = readFileSync(join(process.cwd(), "components", "admin", "judge-roster.tsx"), "utf8");

describe("admin judges layout", () => {
  it("uses the approved compact page hierarchy and card spacing", () => {
    expect(judgesPage).toContain("text-[clamp(1.75rem,4vw,2rem)]");
    expect(judgesPage).toContain("text-lg font-semibold leading-snug");
    expect(judgesPage).toContain("card mt-6 p-4 sm:p-5");
  });

  it("keeps judge fields touch-friendly and roster rows responsive", () => {
    expect(judgeForm).toContain("field mt-1 h-11 min-h-11");
    expect(judgeForm).toContain("sm:flex-row sm:items-center sm:justify-between");
    expect(judgeForm).toContain("sm:shrink-0");
    expect(judgeRoster).toContain("lg:table-row");
    expect(judgeRoster).toContain("lg:hidden");
    expect(judgeRoster).toContain("overflow-wrap:anywhere");
  });
});
