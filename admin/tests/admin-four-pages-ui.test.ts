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
  const detail = read("app/admin/scoring/[slug]/page.tsx");

  // Scoring now reads the API's ranking (merged from dev, 2026-11-13): the placeholder is gone, the page shell stays the approved one.
  it("uses the approved page shell with a bilingual title", () => {
    expect(page).toContain('className="eyebrow"');
    expect(page).toContain("Scoring management");
    expect(page).toContain("மதிப்பீடுகள்");
    expect(detail).toContain('className="eyebrow mt-2"');
  });

  it("reads real scoring data behind the administrator check and never edits scores", () => {
    expect(page).toContain('requireStaff("admin")');
    expect(page).toContain("loadScoringOverview()");
    expect(detail).toContain("loadRanking(slug)");
    expect(page + detail).not.toMatch(/saveScore|PUT|unlock/);
  });
});

describe("Results page refinement", () => {
  const page = read("app/admin/results/page.tsx");
  const detail = read("app/admin/results/[slug]/page.tsx");

  it("uses the approved page shell with a bilingual title", () => {
    expect(page).toContain('className="eyebrow"');
    expect(page).toContain("Results management");
    expect(page).toContain("முடிவுகள்");
  });

  it("chooses winners by hand and never publishes: publication stays the Event Settings time", () => {
    expect(page).toContain('requireStaff("admin")');
    expect(page).toContain("loadResultsOverview()");
    expect(detail).toContain("approveWinnerAction");
    expect(detail).toContain('name="confirm"');
    expect(page + detail).not.toMatch(/publishResults|results_publish_at/);
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
