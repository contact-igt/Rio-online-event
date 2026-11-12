import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Assign Judges page refinement", () => {
  const page = read("app/admin/assign-judges/page.tsx");

  it("uses the approved bilingual page hierarchy and supported summary metrics", () => {
    expect(page).toContain('className="eyebrow"');
    expect(page).toContain("Assign Judges");
    expect(page).toContain("Judge assignment");
    expect(page).toContain("Total competitions");
    expect(page).toContain("Active judges");
    expect(page).toContain("activeJudges.length");
  });

  it("does not mistake a failed judge load for an empty judge list", () => {
    expect(page).toContain("judges.ok");
    expect(page).toContain("Could not load active judges");
    expect(page).toContain("AssignJudgeForm");
  });
});

describe("Scoring page refinement", () => {
  const page = read("app/admin/scoring/page.tsx");
  const readiness = read("components/admin/api-not-ready.tsx");

  it("uses the approved page shell and a page-specific bilingual readiness workspace", () => {
    expect(page).toContain("ApiNotReady");
    expect(page).toContain('eyebrow="Scoring management"');
    expect(page).toContain('title="Scoring"');
    expect(page).toContain('titleTa="மதிப்பீடுகள்"');
    expect(page).toContain('messageEn="Scoring management is not available yet."');
    expect(readiness).toContain("eyebrow");
    expect(readiness).toContain("messageEn");
  });

  it("keeps the existing auth and competition read without inventing scoring controls", () => {
    expect(page).toContain('requireStaff("admin")');
    expect(page).toContain("loadCompetitions()");
    expect(page).not.toContain("loadScores");
    expect(page).not.toContain("Publish");
    expect(page).not.toContain("<table");
  });
});

describe("Results page refinement", () => {
  const page = read("app/admin/results/page.tsx");

  it("uses the approved page shell and a page-specific bilingual readiness workspace", () => {
    expect(page).toContain("ApiNotReady");
    expect(page).toContain('eyebrow="Results management"');
    expect(page).toContain('title="Results"');
    expect(page).toContain('titleTa="முடிவுகள்"');
    expect(page).toContain('messageEn="Results management is not available yet."');
  });

  it("keeps the existing auth and competition read without adding result publication behavior", () => {
    expect(page).toContain('requireStaff("admin")');
    expect(page).toContain("loadCompetitions()");
    expect(page).not.toContain("loadSettings");
    expect(page).not.toContain("publishResults");
    expect(page).not.toContain("<table");
  });
});

describe("Event Settings page refinement", () => {
  const page = read("app/admin/settings/page.tsx");
  const form = read("components/admin/settings-form.tsx");

  it("uses the approved page hierarchy and grouped bilingual settings sections", () => {
    expect(page).toContain('className="eyebrow"');
    expect(page).toContain("Event configuration");
    expect(page).toContain("Event settings");
    expect(form).toContain("Registration settings");
    expect(form).toContain("Consent settings");
    expect(form).toContain("Results settings");
    expect(form).toContain("sm:grid-cols-2");
  });

  it("keeps all existing fields and one existing save action", () => {
    expect(form).toContain("saveSettingsAction");
    for (const field of ["opensAt", "closesAt", "guardianConsentVersion", "resultsPublishAt"]) expect(form).toContain(field);
    expect(form).toContain("SubmitButton");
    expect([...form.matchAll(/<SubmitButton\b/g)]).toHaveLength(1);
  });
});
