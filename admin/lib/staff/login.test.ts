import { describe, expect, it } from "vitest";
import { loginErrorCode, parseLogin } from "./login";

describe("parseLogin", () => {
  it("normalises the email and keeps the password exactly as typed", () => {
    expect(parseLogin({ email: "  Admin@Rio.Local ", password: " p w " })).toEqual({ email: "admin@rio.local", password: " p w " });
  });
  it.each([[{ email: "", password: "x" }], [{ email: "not-an-email", password: "x" }], [{ email: "a@b.co", password: "" }], [{ email: "a@b.co", password: "x".repeat(257) }], [{ email: null, password: "x" }], [{ email: "a@b.co", password: 5 }]])("refuses %j before anything is sent", (raw) => {
    expect(parseLogin(raw)).toBeNull();
  });
});

describe("loginErrorCode", () => {
  it.each([
    [401, undefined, undefined, "credentials"],
    [429, undefined, undefined, "tooMany"],
    [400, undefined, undefined, "invalid"],
    [422, undefined, undefined, "invalid"],
    [403, undefined, "origin_not_allowed", "refused"],
    [403, undefined, "csrf_invalid", "unavailable"],
    [403, undefined, undefined, "unavailable"],
    [404, undefined, "not_found", "unavailable"],
    [500, undefined, undefined, "unavailable"],
    [200, "bad_response", undefined, "unavailable"],
    [0, "unreachable", undefined, "unavailable"],
    [0, "timeout", undefined, "unavailable"],
    [0, "tls", undefined, "unavailable"],
    [0, "not_configured", undefined, "notConfigured"],
    [0, "invalid_config", undefined, "notConfigured"],
  ])("status %i, fault %s, API code %s gives %s", (status, fault, apiCode, code) => {
    expect(loginErrorCode({ status, fault, apiCode })).toBe(code);
  });
});
