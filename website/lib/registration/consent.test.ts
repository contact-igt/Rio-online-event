import { describe, expect, it } from "vitest";
import { consentActivationState, getConsentCopy } from "./consent";

describe("guardian consent activation", () => {
  it("opens with the provisional wording, which the owner chose on 2026-11-11 and which says it is provisional", () => {
    expect(consentActivationState("v0-provisional")).toBe("ready");
    expect(getConsentCopy("v0-provisional")?.provisional).toBe(true);
  });

  it.each([undefined, null, "", "Test", "rio_v1", "v1", "future-approved-v1"])("keeps %p unavailable: no wording of its own is deployed", (version) => {
    expect(consentActivationState(version)).toBe("unavailable");
  });

  it("never shows the provisional wording under another version's name", () => {
    expect(getConsentCopy("rio_v1")).toBeNull();
  });
});
