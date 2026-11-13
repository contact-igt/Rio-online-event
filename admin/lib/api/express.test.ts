import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) }));

import { callApi, parseSetCookie } from "./express";

describe("parseSetCookie", () => {
  it("reads the attributes the API sets", () => {
    expect(parseSetCookie("rio_staff=abc123; Max-Age=28800; Path=/; HttpOnly; SameSite=Strict")).toEqual({ name: "rio_staff", value: "abc123", maxAge: 28800, httpOnly: true, secure: false, sameSite: "strict", path: "/" });
    expect(parseSetCookie("__Host-rio_staff=x; Path=/; Secure; HttpOnly; SameSite=Lax")).toMatchObject({ secure: true, sameSite: "lax" });
  });
  it("understands a clearing cookie", () => {
    expect(parseSetCookie("rio_staff=; Max-Age=0; Path=/")).toMatchObject({ value: "", maxAge: 0 });
    expect(parseSetCookie("rio_staff=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/")!.maxAge).toBeLessThan(0);
  });
  it("refuses a header with no name", () => {
    expect(parseSetCookie("=x")).toBeNull();
    expect(parseSetCookie("")).toBeNull();
  });
});

const RAILWAY = "https://rio-online-event-production.up.railway.app";
const ADMIN_SITE = "https://rio-online-event-vuw2.vercel.app";
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("callApi", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logged: string[];
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RIO_API_ORIGIN", "");
    vi.stubEnv("RIO_BACKEND_API_URL", RAILWAY);
    vi.stubEnv("RIO_ADMIN_ORIGIN", ADMIN_SITE);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    logged = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => void logged.push(String(line)));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("calls the configured API, whichever accepted variable holds it, on /api/v1 plus the route", async () => {
    fetchMock.mockResolvedValue(json(200, { user: { id: 1 } }, { "set-cookie": "__Host-rio_staff=tok; Path=/; Secure; HttpOnly" }));
    const reply = await callApi("/staff/login", { method: "POST", body: { email: "a@b.co", password: "pw" } });
    expect(fetchMock.mock.calls[0]![0]).toBe(`${RAILWAY}/api/v1/staff/login`);
    expect(reply).toMatchObject({ status: 200, setCookies: ["__Host-rio_staff=tok; Path=/; Secure; HttpOnly"] });
    expect(reply.fault).toBeUndefined();
    expect(logged).toEqual([]);
  });

  it("sends this site's Origin on a change, forwards the visitor's address and never the API address to anything else", async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    await callApi("/staff/login", { method: "POST", body: {} });
    const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string>; method: string };
    expect(init.headers).toMatchObject({ origin: ADMIN_SITE, "x-forwarded-for": "203.0.113.9", "content-type": "application/json" });
  });

  it("login gateway: a development login goes to the local API with the local admin Origin, never to Production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RIO_BACKEND_API_URL", "http://localhost:4000");
    vi.stubEnv("RIO_ADMIN_ORIGIN", "http://localhost:3001");
    fetchMock.mockResolvedValue(json(200, { user: { id: 1 } }));
    await callApi("/staff/login", { method: "POST", body: { email: "a@b.co", password: "pw" } });
    expect(fetchMock.mock.calls[0]![0]).toBe("http://127.0.0.1:4000/api/v1/staff/login"); // "localhost" is spelled as its IPv4 address on the wire
    expect((fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }).headers.origin).toBe("http://localhost:3001");
  });

  it("login gateway: APP_ENV routes the real login route to the chosen API, with that environment's admin Origin", async () => {
    vi.stubEnv("RIO_BACKEND_API_URL", "");
    vi.stubEnv("RIO_ADMIN_ORIGIN", "");
    vi.stubEnv("NODE_ENV", "development"); // next dev
    vi.stubEnv("RIO_BACKEND_API_URL_DEVELOPMENT", "http://localhost:4000");
    vi.stubEnv("RIO_BACKEND_API_URL_PRODUCTION", RAILWAY);
    vi.stubEnv("RIO_ADMIN_ORIGIN_DEVELOPMENT", "http://localhost:3001");
    vi.stubEnv("RIO_ADMIN_ORIGIN_PRODUCTION", ADMIN_SITE);
    fetchMock.mockResolvedValue(json(200, { user: { id: 1 } }));
    for (const [appEnv, api, origin] of [["development", "http://127.0.0.1:4000", "http://localhost:3001"], ["production", RAILWAY, ADMIN_SITE]] as const) {
      vi.stubEnv("APP_ENV", appEnv);
      fetchMock.mockClear();
      await callApi("/staff/login", { method: "POST", body: { email: "a@b.co", password: "pw" } });
      expect(fetchMock.mock.calls[0]![0], appEnv).toBe(`${api}/api/v1/staff/login`);
      expect((fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }).headers.origin, appEnv).toBe(origin);
    }
  });

  it("login gateway: development refuses the hosted Production API even when a .env holds it, and makes no request", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const reply = await callApi("/staff/login", { method: "POST", body: { email: "a@b.co", password: "pw" } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reply).toMatchObject({ status: 0, fault: "invalid_config" });
    expect(JSON.parse(logged[0]!)).toMatchObject({ app: "admin", fault: "invalid_config", host: null });
  });

  it("with no API address configured it makes NO request, and reports not_configured instead of trying localhost", async () => {
    vi.stubEnv("RIO_BACKEND_API_URL", "");
    const reply = await callApi("/staff/login", { method: "POST", body: { email: "a@b.co", password: "pw" } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reply).toEqual({ status: 0, body: null, setCookies: [], fault: "not_configured" });
    expect(JSON.parse(logged[0]!)).toMatchObject({ event: "api_call_failed", app: "admin", fault: "not_configured", reason: "RIO_BACKEND_API_URL_PRODUCTION is not set", host: null });
  });

  it("with no admin site address a change makes NO request and never presents localhost as the Origin; a read still works", async () => {
    vi.stubEnv("RIO_ADMIN_ORIGIN", "");
    const change = await callApi("/staff/login", { method: "POST", body: { email: "a@b.co", password: "pw" } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(change).toEqual({ status: 0, body: null, setCookies: [], fault: "not_configured" });
    expect(JSON.parse(logged[0]!)).toMatchObject({ fault: "not_configured", reason: "RIO_ADMIN_ORIGIN_PRODUCTION is not set", host: "rio-online-event-production.up.railway.app" });
    fetchMock.mockResolvedValue(json(200, {}));
    expect(await callApi("/staff/me")).toMatchObject({ status: 200 });
    expect((fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }).headers).not.toHaveProperty("origin");
  });

  it("reports a malformed address as invalid_config and makes no request", async () => {
    vi.stubEnv("RIO_BACKEND_API_URL", `${RAILWAY}/somewhere/else`);
    expect(await callApi("/staff/me")).toMatchObject({ status: 0, fault: "invalid_config" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts the API root pasted with /api/v1 and still calls /api/v1/<route> exactly once", async () => {
    vi.stubEnv("RIO_BACKEND_API_URL", `${RAILWAY}/api/v1`);
    fetchMock.mockResolvedValue(json(200, {}));
    await callApi("/staff/me");
    expect(fetchMock.mock.calls[0]![0]).toBe(`${RAILWAY}/api/v1/staff/me`);
  });

  it.each([
    [Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }), "unreachable", "ECONNREFUSED"],
    [Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }), "unreachable", "ENOTFOUND"],
    [Object.assign(new Error("timeout"), { name: "TimeoutError" }), "timeout", "TimeoutError"],
    [Object.assign(new TypeError("fetch failed"), { cause: { code: "DEPTH_ZERO_SELF_SIGNED_CERT" } }), "tls", "DEPTH_ZERO_SELF_SIGNED_CERT"],
  ])("a network failure says why (%#), and the log names the system code but nothing typed", async (error, fault, cause) => {
    fetchMock.mockRejectedValue(error);
    const reply = await callApi("/staff/login", { method: "POST", body: { email: "a@b.co", password: "hunter2-hunter2" } });
    expect(reply).toEqual({ status: 0, body: null, setCookies: [], fault });
    const line = JSON.parse(logged[0]!);
    expect(line).toMatchObject({ event: "api_call_failed", method: "POST", path: "/staff/login", host: "rio-online-event-production.up.railway.app", status: 0, fault, cause });
    expect(logged.join("")).not.toMatch(/hunter2|a@b\.co/);
  });

  it("keeps the API's own error code, so a refused origin is told apart from an outage", async () => {
    fetchMock.mockResolvedValue(json(403, { error: { code: "origin_not_allowed", message: "x", requestId: "r" } }));
    const reply = await callApi("/staff/login", { method: "POST", body: {} });
    expect(reply).toMatchObject({ status: 403, apiCode: "origin_not_allowed" });
    expect(JSON.parse(logged[0]!)).toMatchObject({ status: 403, apiCode: "origin_not_allowed", path: "/staff/login" });
  });

  it("flags an answer that is not JSON (a proxy's HTML page) as bad_response", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Application not found</html>", { status: 404, headers: { "content-type": "text/html" } }));
    expect(await callApi("/staff/login", { method: "POST", body: {} })).toMatchObject({ status: 404, body: null, fault: "bad_response" });
    expect(JSON.parse(logged[0]!)).toMatchObject({ status: 404, fault: "bad_response" });
  });

  it("stays quiet for answers an ordinary user causes: wrong password, rate limit, a field problem", async () => {
    for (const status of [401, 429, 400, 422]) {
      fetchMock.mockResolvedValueOnce(json(status, { error: { code: "x_y" } }));
      await callApi("/staff/login", { method: "POST", body: {} });
    }
    expect(logged).toEqual([]);
  });

  it("logs a missing route (the API is running without a database) and a server error", async () => {
    fetchMock.mockResolvedValueOnce(json(404, { error: { code: "not_found" } }));
    fetchMock.mockResolvedValueOnce(json(500, { error: { code: "internal" } }));
    await callApi("/staff/login", { method: "POST", body: {} });
    await callApi("/staff/me");
    expect(logged.map((l) => JSON.parse(l).status)).toEqual([404, 500]);
  });

  it("never logs the cookie or the CSRF token it was given", async () => {
    fetchMock.mockResolvedValue(json(500, {}));
    await callApi("/admin/settings", { method: "PATCH", body: { guardianConsentVersion: "v1" }, cookie: "rio_staff=very-secret-session", csrf: "very-secret-csrf" });
    expect(logged.join("")).not.toMatch(/very-secret/);
  });
});
