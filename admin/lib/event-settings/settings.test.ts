import { describe, expect, it } from "vitest";
import { fieldsOf, isoToIstInput, istInputToIso, type ApiSettings } from "./settings";

describe("IST conversion", () => {
  it("turns a typed IST time into an ISO instant with the +05:30 offset", () => {
    expect(istInputToIso("2026-12-01T09:00")).toBe("2026-12-01T09:00:00+05:30");
    expect(Date.parse(istInputToIso("2026-12-01T09:00") as string)).toBe(Date.parse("2026-12-01T03:30:00Z"));
  });
  it("treats an empty field as clear and rejects malformed or impossible values", () => {
    expect(istInputToIso("")).toBeNull();
    expect(istInputToIso("  ")).toBeNull();
    for (const bad of ["tomorrow", "2026-12-01", "2026-12-01 09:00", "2026-02-31T09:00", "2026-13-01T09:00", "2026-12-01T25:00"]) expect(istInputToIso(bad)).toBe("invalid");
  });
  it("shows a UTC instant as IST, across midnight too", () => {
    expect(isoToIstInput("2026-12-01T03:30:00.000Z")).toBe("2026-12-01T09:00");
    expect(isoToIstInput("2026-12-01T20:00:00.000Z")).toBe("2026-12-02T01:30");
    expect(isoToIstInput(null)).toBe("");
    expect(isoToIstInput("not a date")).toBe("");
  });
  it("round-trips", () => {
    const iso = istInputToIso("2027-03-05T18:45") as string;
    expect(isoToIstInput(new Date(iso).toISOString())).toBe("2027-03-05T18:45");
  });
  it("fills the form from the API settings, empty when unset", () => {
    const s: ApiSettings = { timezone: "Asia/Kolkata", registrationOpen: false, opensAt: null, closesAt: "2026-12-20T12:30:00.000Z", resultsPublishAt: null, resultsPublished: false, guardianConsentVersion: null, mediaConsentVersion: null, updatedAt: null };
    expect(fieldsOf(s)).toEqual({ opensAt: "", closesAt: "2026-12-20T18:00", resultsPublishAt: "", guardianConsentVersion: "" });
  });
});
