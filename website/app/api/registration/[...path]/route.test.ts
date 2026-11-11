import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, PATCH } from "./route";

const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
const SITE = "https://rio-online-event-gia5.vercel.app";

describe("public registration gateway", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RIO_API_ORIGIN", "");
    vi.stubEnv("RIO_BACKEND_API_URL", "https://api.example.org");
    vi.stubEnv("RIO_PUBLIC_ORIGIN", SITE);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("forwards only the registration cookie and trusted origin", async () => {
    const fetchMock = vi.fn(async (...args: [string, RequestInit]) => { void args; return new Response(JSON.stringify({ events: [] }), { status: 200, headers: { "Set-Cookie": "rio_reg=next-secret; HttpOnly; Path=/" } }); });
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("http://localhost:3000/api/registration/events", { headers: { cookie: "rio_reg=abc; rio_staff=must-not-forward" } });
    const response = await GET(request, context(["events"]));
    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example.org/api/v1/events");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("cookie")).toBe("rio_reg=abc");
    expect(new Headers(init.headers).get("origin")).toBe(SITE);
    expect(response.headers.get("set-cookie")).toContain("rio_reg=next-secret");
  });

  it("rejects admin paths, traversal, and an untrusted origin", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET(new NextRequest("http://localhost:3000/api/registration/admin"), context(["admin"]))).status).toBe(404);
    expect((await GET(new NextRequest("http://localhost:3000/api/registration/.."), context([".."]))).status).toBe(404);
    expect((await GET(new NextRequest("http://localhost:3000/api/registration/events", { headers: { origin: "https://evil.example" } }), context(["events"]))).status).toBe(403);
    expect((await GET(new NextRequest("http://localhost:3000/api/registration/events", { headers: { origin: "http://localhost:3000" } }), context(["events"]))).status).toBe(403); // not this site's address in this environment
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards CSRF only for a write and never follows redirects", async () => {
    const fetchMock = vi.fn(async (_input: string, init: RequestInit) => {
      expect(init.redirect).toBe("error");
      expect(new Headers(init.headers).get("x-csrf-token")).toBe("csrf-test");
      return new Response(JSON.stringify({ error: { code: "registration_closed" } }), { status: 403 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await PATCH(new NextRequest(`${SITE}/api/registration/current`, { method: "PATCH", headers: { origin: SITE, "x-csrf-token": "csrf-test" }, body: "{}" }), context(["registrations", "current"]));
    expect(response.status).toBe(403);
  });

  it("with no API address configured it answers 503 and calls nothing, instead of trying localhost", async () => {
    vi.stubEnv("RIO_BACKEND_API_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new NextRequest("http://localhost:3000/api/registration/events"), context(["events"]));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "unavailable" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with no site address a change answers 503 and calls nothing (no localhost Origin is invented); a plain read still works without an Origin", async () => {
    vi.stubEnv("RIO_PUBLIC_ORIGIN", "");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ events: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const write = await PATCH(new NextRequest(`${SITE}/api/registration/current`, { method: "PATCH", headers: { "x-csrf-token": "c" }, body: "{}" }), context(["registrations", "current"]));
    expect(write.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await GET(new NextRequest(`${SITE}/api/registration/events`), context(["events"]))).status).toBe(200);
    expect(new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).has("origin")).toBe(false);
    expect((await GET(new NextRequest(`${SITE}/api/registration/events`, { headers: { origin: SITE } }), context(["events"]))).status).toBe(503); // a browser Origin cannot be judged without the site address
  });

  it("development refuses the hosted Production API: the gateway answers 503 and calls nothing", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RIO_BACKEND_API_URL", "https://rio-online-event-production.up.railway.app");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET(new NextRequest("http://localhost:3000/api/registration/events"), context(["events"]))).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
