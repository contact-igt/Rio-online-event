import { describe, expect, it } from "vitest";
import { fieldMessages, fieldsOf, isoToIstInput, istInputToIso, istMinuteNow, type ApiSettings } from "./settings";

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

describe("event-settings validation messages", () => {
  it("explains when owner-approved consent wording is not deployed and when results are too early", () => {
    expect(fieldMessages.unsupported_consent_version?.en).toMatch(/owner-approved consent wording/);
    expect(fieldMessages.unsupported_consent_version?.ta).toBeTruthy();
    expect(fieldMessages.results_before_approved_date?.en).toContain("14 November 2026");
    expect(fieldMessages.results_before_approved_date?.ta).toBeTruthy();
  });
});

describe("opening-time picker minimum", () => {
  it("is the current IST minute, so today (now or later) stays selectable", () => {
    expect(istMinuteNow(new Date("2026-11-11T09:00:45.500Z"))).toBe("2026-11-11T14:30");
  });
  it("follows the IST date across IST midnight, not the UTC date", () => {
    expect(istMinuteNow(new Date("2026-11-10T18:30:30.000Z"))).toBe("2026-11-11T00:00");
  });
  it("has a bilingual message for a past opening time and none for the removed open-now guard", () => {
    expect(fieldMessages.opens_in_past?.en).toMatch(/past/);
    expect(fieldMessages.opens_in_past?.ta).toBeTruthy();
    expect(fieldMessages).not.toHaveProperty("registration_not_openable_yet");
  });
});
