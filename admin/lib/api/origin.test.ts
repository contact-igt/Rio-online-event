import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyFetchError, logApiFault, resolveApiOrigin, resolveSiteOrigin } from "./origin";

const RAILWAY = "https://rio-online-event-production.up.railway.app";
const LOCAL = "http://localhost:4000";

describe("resolveApiOrigin: which API, with no quiet guess in either direction", () => {
  it("one .env holds both: next dev takes the _DEVELOPMENT address, a production build takes the _PRODUCTION one, with nothing switched by hand", () => {
    const dotEnv = { RIO_BACKEND_API_URL_DEVELOPMENT: LOCAL, RIO_BACKEND_API_URL_PRODUCTION: RAILWAY };
    expect(resolveApiOrigin({ ...dotEnv, NODE_ENV: "development" })).toEqual({ ok: true, origin: LOCAL, host: "localhost:4000", source: "RIO_BACKEND_API_URL_DEVELOPMENT" });
    expect(resolveApiOrigin({ ...dotEnv, NODE_ENV: "production", VERCEL: "1" })).toEqual({ ok: true, origin: RAILWAY, host: "rio-online-event-production.up.railway.app", source: "RIO_BACKEND_API_URL_PRODUCTION" });
    expect(resolveApiOrigin({ ...dotEnv, NODE_ENV: "test" })).toMatchObject({ ok: false, fault: "not_configured" }); // a test never inherits either address
  });
  it("uses only the address of its own mode: a missing _PRODUCTION value is never filled from _DEVELOPMENT, nor the reverse", () => {
    expect(resolveApiOrigin({ NODE_ENV: "production", VERCEL: "1", RIO_BACKEND_API_URL_DEVELOPMENT: LOCAL })).toEqual({ ok: false, fault: "not_configured", reason: "RIO_BACKEND_API_URL_PRODUCTION is not set" });
    expect(resolveApiOrigin({ NODE_ENV: "development", RIO_BACKEND_API_URL_PRODUCTION: RAILWAY })).toEqual({ ok: false, fault: "not_configured", reason: "RIO_BACKEND_API_URL_DEVELOPMENT is not set" });
  });
  it("the plain RIO_BACKEND_API_URL (a hosting dashboard, a test) wins over the mode's value; the retired RIO_API_ORIGIN is not read", () => {
    expect(resolveApiOrigin({ NODE_ENV: "production", VERCEL: "1", RIO_BACKEND_API_URL: RAILWAY, RIO_BACKEND_API_URL_PRODUCTION: "https://other.example.org" })).toMatchObject({ ok: true, origin: RAILWAY, source: "RIO_BACKEND_API_URL" });
    expect(resolveApiOrigin({ NODE_ENV: "production", RIO_API_ORIGIN: RAILWAY })).toMatchObject({ ok: false, fault: "not_configured" });
  });
  it("copes with what a hand-written .env or a dashboard produces: quotes, spaces, a trailing slash, the pasted /api/v1", () => {
    for (const raw of [`"${RAILWAY}"`, `'${RAILWAY}'`, `  ${RAILWAY}  `, `${RAILWAY}/`, ` " ${RAILWAY}/ " `, `${RAILWAY}/api/v1`, `"${RAILWAY}/api/v1/"`, `${RAILWAY}/api`]) {
      expect(resolveApiOrigin({ NODE_ENV: "production", RIO_BACKEND_API_URL: raw }), raw).toMatchObject({ ok: true, origin: RAILWAY });
    }
  });
  it("missing configuration is an error everywhere, and there is no default for any environment", () => {
    expect(resolveApiOrigin({ NODE_ENV: "production" })).toEqual({ ok: false, fault: "not_configured", reason: "RIO_BACKEND_API_URL_PRODUCTION is not set" });
    expect(resolveApiOrigin({ NODE_ENV: "development" })).toEqual({ ok: false, fault: "not_configured", reason: "RIO_BACKEND_API_URL_DEVELOPMENT is not set" });
    for (const NODE_ENV of ["test", undefined]) expect(resolveApiOrigin({ NODE_ENV }), String(NODE_ENV)).toEqual({ ok: false, fault: "not_configured", reason: "RIO_BACKEND_API_URL is not set" });
    expect(resolveApiOrigin({ NODE_ENV: "production", RIO_BACKEND_API_URL: "   " })).toMatchObject({ ok: false, fault: "not_configured" });
    expect(resolveApiOrigin({ NODE_ENV: "production", RIO_BACKEND_API_URL_PRODUCTION: '""' })).toMatchObject({ ok: false, fault: "not_configured" });
  });
  it("development never reaches a hosted API, Production included, so a stray value in .env cannot point a developer at it", () => {
    for (const raw of [RAILWAY, `${RAILWAY}/api/v1`, "https://api.example.org", "http://192.168.1.20:4000"]) {
      const result = resolveApiOrigin({ NODE_ENV: "development", RIO_BACKEND_API_URL_DEVELOPMENT: raw });
      expect(result, raw).toMatchObject({ ok: false, fault: "invalid_config" });
      expect(result.ok ? "" : result.reason).toContain("development may only use the API on this machine");
    }
  });
});

describe("APP_ENV picks the environment, whatever NODE_ENV is", () => {
  const dotEnv = { RIO_BACKEND_API_URL_DEVELOPMENT: LOCAL, RIO_BACKEND_API_URL_PRODUCTION: RAILWAY, RIO_ADMIN_ORIGIN_DEVELOPMENT: "http://localhost:3001", RIO_ADMIN_ORIGIN_PRODUCTION: "https://rio-online-event-vuw2.vercel.app" };
  it("development selects the local API and the local admin address, under next dev or a production build", () => {
    for (const NODE_ENV of ["development", "production"]) {
      expect(resolveApiOrigin({ ...dotEnv, NODE_ENV, APP_ENV: "development" }), NODE_ENV).toEqual({ ok: true, origin: LOCAL, host: "localhost:4000", source: "RIO_BACKEND_API_URL_DEVELOPMENT" });
      expect(resolveSiteOrigin("RIO_ADMIN_ORIGIN", { ...dotEnv, NODE_ENV, APP_ENV: "development" })).toEqual({ ok: true, origin: "http://localhost:3001" });
    }
  });
  it("production selects the Railway API and the hosted admin address, including under next dev", () => {
    for (const NODE_ENV of ["development", "production"]) {
      expect(resolveApiOrigin({ ...dotEnv, NODE_ENV, APP_ENV: "production" }), NODE_ENV).toEqual({ ok: true, origin: RAILWAY, host: "rio-online-event-production.up.railway.app", source: "RIO_BACKEND_API_URL_PRODUCTION" });
      expect(resolveSiteOrigin("RIO_ADMIN_ORIGIN", { ...dotEnv, NODE_ENV, APP_ENV: "production" })).toEqual({ ok: true, origin: "https://rio-online-event-vuw2.vercel.app" });
    }
  });
  it("never fills one environment from the other", () => {
    expect(resolveApiOrigin({ NODE_ENV: "development", APP_ENV: "production", RIO_BACKEND_API_URL_DEVELOPMENT: LOCAL })).toEqual({ ok: false, fault: "not_configured", reason: "RIO_BACKEND_API_URL_PRODUCTION is not set" });
    expect(resolveApiOrigin({ NODE_ENV: "production", APP_ENV: "development", RIO_BACKEND_API_URL_PRODUCTION: RAILWAY })).toEqual({ ok: false, fault: "not_configured", reason: "RIO_BACKEND_API_URL_DEVELOPMENT is not set" });
    expect(resolveApiOrigin({ NODE_ENV: "development", APP_ENV: "development", RIO_BACKEND_API_URL_DEVELOPMENT: RAILWAY })).toMatchObject({ ok: false, fault: "invalid_config" });
    expect(resolveApiOrigin({ NODE_ENV: "development", APP_ENV: "production", RIO_BACKEND_API_URL_PRODUCTION: "http://api.example.org" })).toMatchObject({ ok: false, fault: "invalid_config" });
  });
  it("refuses an unknown APP_ENV and an old plain variable next to APP_ENV, instead of guessing", () => {
    for (const APP_ENV of ["staging", "prod", "test"]) expect(resolveApiOrigin({ ...dotEnv, APP_ENV }), APP_ENV).toEqual({ ok: false, fault: "invalid_config", reason: "APP_ENV must be development or production" });
    expect(resolveApiOrigin({ ...dotEnv, APP_ENV: "production", RIO_BACKEND_API_URL: LOCAL })).toEqual({ ok: false, fault: "invalid_config", reason: "RIO_BACKEND_API_URL must not be set when APP_ENV is set; use RIO_BACKEND_API_URL_PRODUCTION" });
    expect(resolveSiteOrigin("RIO_ADMIN_ORIGIN", { ...dotEnv, APP_ENV: "development", RIO_ADMIN_ORIGIN: "https://x.example.org" })).toMatchObject({ ok: false, fault: "invalid_config" });
  });
  it("production never falls back to this machine on Vercel, and never speaks plain http to a hosted API", () => {
    expect(resolveApiOrigin({ NODE_ENV: "production", VERCEL: "1", RIO_BACKEND_API_URL: "http://127.0.0.1:4000" })).toMatchObject({ ok: false, fault: "invalid_config" });
    expect(resolveApiOrigin({ NODE_ENV: "production", VERCEL: "1", RIO_BACKEND_API_URL: "https://localhost:4000" })).toMatchObject({ ok: false });
    expect(resolveApiOrigin({ NODE_ENV: "production", RIO_BACKEND_API_URL: "http://api.example.org" })).toMatchObject({ ok: false, fault: "invalid_config" });
    expect(resolveApiOrigin({ NODE_ENV: "production", RIO_BACKEND_API_URL: "http://127.0.0.1:4000" })).toMatchObject({ ok: true }); // `next start` on a laptop, chosen explicitly
  });
  it.each([
    ["not a url", "is not a valid URL"],
    ["ftp://example.org", "must start with https:// or http://"],
    ["https://user:pw@example.org", "must not contain a user name or password"],
    [`${RAILWAY}/api/v2`, "without a path"],
    [`${RAILWAY}/api/v1/staff`, "without a path"],
    [`${RAILWAY}/?x=1`, "without a path"],
  ])("refuses %s", (raw, reason) => {
    const result = resolveApiOrigin({ NODE_ENV: "production", RIO_BACKEND_API_URL: raw });
    expect(result).toMatchObject({ ok: false, fault: "invalid_config" });
    expect(result.ok ? "" : result.reason).toContain(reason);
    expect(JSON.stringify(result)).not.toContain("pw@"); // the reason never repeats the value
  });
});

describe("resolveSiteOrigin: this site's own address, which has no default either", () => {
  it("takes the _DEVELOPMENT address under next dev and the _PRODUCTION one in a production build, for each site", () => {
    const admin = { RIO_ADMIN_ORIGIN_DEVELOPMENT: "http://localhost:3001", RIO_ADMIN_ORIGIN_PRODUCTION: "https://rio-online-event-vuw2.vercel.app/" };
    expect(resolveSiteOrigin("RIO_ADMIN_ORIGIN", { ...admin, NODE_ENV: "development" })).toEqual({ ok: true, origin: "http://localhost:3001" });
    expect(resolveSiteOrigin("RIO_ADMIN_ORIGIN", { ...admin, NODE_ENV: "production", VERCEL: "1" })).toEqual({ ok: true, origin: "https://rio-online-event-vuw2.vercel.app" });
    const website = { RIO_PUBLIC_ORIGIN_DEVELOPMENT: "http://localhost:3000", RIO_PUBLIC_ORIGIN_PRODUCTION: '"https://rio-online-event-gia5.vercel.app"' };
    expect(resolveSiteOrigin("RIO_PUBLIC_ORIGIN", { ...website, NODE_ENV: "development" })).toEqual({ ok: true, origin: "http://localhost:3000" });
    expect(resolveSiteOrigin("RIO_PUBLIC_ORIGIN", { ...website, NODE_ENV: "production", VERCEL: "1" })).toEqual({ ok: true, origin: "https://rio-online-event-gia5.vercel.app" });
    expect(resolveSiteOrigin("RIO_ADMIN_ORIGIN", { NODE_ENV: "production", VERCEL: "1", RIO_ADMIN_ORIGIN: "https://admin.example.org" })).toEqual({ ok: true, origin: "https://admin.example.org" }); // the plain name wins
  });
  it("is an error when unset, so production can never present localhost to the API, and never borrows the other mode's address", () => {
    expect(resolveSiteOrigin("RIO_ADMIN_ORIGIN", { NODE_ENV: "production", VERCEL: "1", RIO_ADMIN_ORIGIN_DEVELOPMENT: "http://localhost:3001" })).toEqual({ ok: false, fault: "not_configured", reason: "RIO_ADMIN_ORIGIN_PRODUCTION is not set" });
    expect(resolveSiteOrigin("RIO_ADMIN_ORIGIN", { NODE_ENV: "development" })).toEqual({ ok: false, fault: "not_configured", reason: "RIO_ADMIN_ORIGIN_DEVELOPMENT is not set" });
    for (const NODE_ENV of ["test", undefined]) expect(resolveSiteOrigin("RIO_ADMIN_ORIGIN", { NODE_ENV }), String(NODE_ENV)).toEqual({ ok: false, fault: "not_configured", reason: "RIO_ADMIN_ORIGIN is not set" });
  });
  it("refuses localhost on Vercel, plain http for a hosted address in production, and anything that is not a bare origin", () => {
    expect(resolveSiteOrigin("RIO_ADMIN_ORIGIN", { NODE_ENV: "production", VERCEL: "1", RIO_ADMIN_ORIGIN_PRODUCTION: "http://localhost:3001" })).toMatchObject({ ok: false, fault: "invalid_config" });
    expect(resolveSiteOrigin("RIO_ADMIN_ORIGIN", { NODE_ENV: "production", RIO_ADMIN_ORIGIN_PRODUCTION: "http://admin.example.org" })).toMatchObject({ ok: false, fault: "invalid_config" });
    for (const raw of ["not a url", "https://admin.example.org/staff", "https://admin.example.org/?a=1", "https://u:p@admin.example.org"]) {
      expect(resolveSiteOrigin("RIO_ADMIN_ORIGIN", { NODE_ENV: "production", RIO_ADMIN_ORIGIN_PRODUCTION: raw }), raw).toMatchObject({ ok: false, fault: "invalid_config" });
    }
  });
});

describe("classifyFetchError", () => {
  it.each([
    [Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }), "unreachable", "ECONNREFUSED"],
    [Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }), "unreachable", "ENOTFOUND"],
    [Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }), "timeout", "UND_ERR_CONNECT_TIMEOUT"],
    [Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), "timeout", "TimeoutError"],
    [Object.assign(new TypeError("fetch failed"), { cause: { code: "DEPTH_ZERO_SELF_SIGNED_CERT" } }), "tls", "DEPTH_ZERO_SELF_SIGNED_CERT"],
    [Object.assign(new TypeError("fetch failed"), { cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" } }), "tls", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"],
    ["weird", "unreachable", "error"],
    [null, "unreachable", "error"],
  ])("%#: %s", (error, fault, cause) => {
    expect(classifyFetchError(error)).toEqual({ fault, cause });
  });
});

describe("what reaches the server log", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is one JSON line of fixed fields: host, route without its query string, status, fault, codes; nothing else", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logApiFault("admin", { method: "POST", path: "/staff/login?email=a@b.co", host: "api.example.org", status: 403, apiCode: "origin_not_allowed", ...({ password: "hunter2", cookie: "rio_staff=abc", body: "secret" } as object) });
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]![0]);
    expect(JSON.parse(line)).toEqual({ level: "error", event: "api_call_failed", app: "admin", method: "POST", path: "/staff/login", host: "api.example.org", status: 403, apiCode: "origin_not_allowed" });
    expect(line).not.toMatch(/hunter2|rio_staff|secret|a@b\.co/);
  });
});
