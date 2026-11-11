import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePasswordChange, passwordErrorCode, WEAK_REASONS, weakReasons } from "./password-setup";

describe("weakReasons: the API's reason for refusing a password reaches the form", () => {
  it("keeps every known reason, in order, and drops anything else", () => {
    expect(weakReasons(["contains the e-mail name", "same as the current password"])).toEqual(["contains the e-mail name", "same as the current password"]);
    expect(weakReasons(["<script>", 3, "shorter than 12 characters", "toString"])).toEqual(["shorter than 12 characters"]);
    expect(weakReasons(undefined)).toEqual([]);
    expect(weakReasons("contains the e-mail name")).toEqual([]);
  });
  it("has a sentence for every reason the backend can give, so none is shown as a generic 'too short' message again", () => {
    const backend = (file: string) => readFileSync(join(process.cwd(), "..", "backend", "src", "auth", file), "utf8");
    const labels = [...backend("password.ts").matchAll(/out\.push\("([^"]+)"\)/g), ...backend("staff.ts").matchAll(/problems\.push\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThanOrEqual(7);
    expect(Object.keys(WEAK_REASONS).sort()).toEqual([...new Set(labels)].sort());
  });
});

describe("parsePasswordChange", () => {
  it("returns the two passwords the API wants", () => {
    expect(parsePasswordChange({ current: "old-pass", password: "new-password-123", confirm: "new-password-123" })).toEqual({ currentPassword: "old-pass", newPassword: "new-password-123" });
  });
  it("refuses a missing field and a mismatch", () => {
    expect(parsePasswordChange({ current: "", password: "x", confirm: "x" })).toBe("invalid");
    expect(parsePasswordChange({ current: "a", password: null, confirm: "x" })).toBe("invalid");
    expect(parsePasswordChange({ current: "a", password: "one-long-password", confirm: "other-long-password" })).toBe("mismatch");
  });
});

describe("passwordErrorCode", () => {
  it.each([
    [422, "weak_password", "weak"],
    [403, "current_password_incorrect", "current"],
    [429, undefined, "tooMany"],
    [400, "invalid_request", "invalid"],
    [403, "csrf_invalid", "unavailable"],
    [0, undefined, "unavailable"],
  ])("maps %i %s to %s", (status, code, expected) => {
    expect(passwordErrorCode(status, code)).toBe(expected);
  });
});
