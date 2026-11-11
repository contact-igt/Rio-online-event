import { describe, expect, it } from "vitest";
import { consentActivationState } from "./consent";

describe("guardian consent activation", () => {
  it.each([undefined, null, "Test", "v0-provisional", "future-approved-v1"])("keeps %p unavailable until it is explicitly approved", (version) => {
    expect(consentActivationState(version)).toBe("unavailable");
  });
});
