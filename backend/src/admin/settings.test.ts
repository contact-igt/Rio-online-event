import { describe, expect, it } from "vitest";
import { problems, type SettingsView } from "./settings.ts";

const empty: SettingsView = {
  opensAt: null,
  closesAt: null,
  resultsPublishAt: null,
  guardianConsentVersion: null,
  mediaConsentVersion: null,
  updatedAt: null,
};

describe("Event Settings activation rules", () => {
  it("refuses a scheduled window with an unsupported guardian-consent version", () => {
    const next: SettingsView = { ...empty, opensAt: new Date("2026-11-15T00:00:00.000Z"), closesAt: new Date("2026-11-16T00:00:00.000Z"), guardianConsentVersion: "Test" };
    expect(problems(next, empty, new Date("2026-11-01T00:00:00.000Z"))).toMatchObject({ guardianConsentVersion: "unsupported_consent_version" });
  });

  it("accepts only an exact deployed version: the provisional wording yes, any other label (such as rio_v1) no", () => {
    const window = { opensAt: new Date("2026-11-15T00:00:00.000Z"), closesAt: new Date("2026-11-16T00:00:00.000Z") };
    const at = new Date("2026-11-01T00:00:00.000Z");
    expect(problems({ ...empty, ...window, guardianConsentVersion: "v0-provisional" }, empty, at)).not.toHaveProperty("guardianConsentVersion");
    for (const v of ["rio_v1", " v0-provisional", "anything"]) expect(problems({ ...empty, ...window, guardianConsentVersion: v }, empty, at), v).toMatchObject({ guardianConsentVersion: "unsupported_consent_version" });
  });

  it("refuses results before 14 November 2026 at midnight Asia/Kolkata", () => {
    const next: SettingsView = { ...empty, opensAt: new Date("2026-11-12T00:00:00.000Z"), closesAt: new Date("2026-11-13T00:00:00.000Z"), resultsPublishAt: new Date("2026-11-13T18:29:59.999Z") };
    expect(problems(next, empty, new Date("2026-11-01T00:00:00.000Z"))).toMatchObject({ resultsPublishAt: "results_before_approved_date" });
  });

  it("allows the exact 14 November 2026 midnight Asia/Kolkata boundary", () => {
    const next: SettingsView = { ...empty, opensAt: new Date("2026-11-12T00:00:00.000Z"), closesAt: new Date("2026-11-13T00:00:00.000Z"), resultsPublishAt: new Date("2026-11-13T18:30:00.000Z") };
    expect(problems(next, empty, new Date("2026-11-01T00:00:00.000Z"))).not.toHaveProperty("resultsPublishAt");
  });
});
