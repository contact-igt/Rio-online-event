import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, PATCH } from "./route";

const context = (path: string[]) => ({ params: Promise.resolve({ path }) });

describe("public registration gateway", () => {
  it("forwards only the registration cookie and trusted origin", async () => {
    const fetchMock = vi.fn(async (...args: [string, RequestInit]) => { void args; return new Response(JSON.stringify({ events: [] }), { status: 200, headers: { "Set-Cookie": "rio_reg=next-secret; HttpOnly; Path=/" } }); });
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("http://localhost:3000/api/registration/events", { headers: { cookie: "rio_reg=abc; rio_staff=must-not-forward" } });
    const response = await GET(request, context(["events"]));
    expect(response.status).toBe(200);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("cookie")).toBe("rio_reg=abc");
    expect(new Headers(init.headers).get("origin")).toBe("http://localhost:3000");
    expect(response.headers.get("set-cookie")).toContain("rio_reg=next-secret");
  });

  it("rejects admin paths, traversal, and an untrusted origin", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET(new NextRequest("http://localhost:3000/api/registration/admin"), context(["admin"]))).status).toBe(404);
    expect((await GET(new NextRequest("http://localhost:3000/api/registration/.."), context([".."]))).status).toBe(404);
    expect((await GET(new NextRequest("http://localhost:3000/api/registration/events", { headers: { origin: "https://evil.example" } }), context(["events"]))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards CSRF only for a write and never follows redirects", async () => {
    const fetchMock = vi.fn(async (_input: string, init: RequestInit) => {
      expect(init.redirect).toBe("error");
      expect(new Headers(init.headers).get("x-csrf-token")).toBe("csrf-test");
      return new Response(JSON.stringify({ error: { code: "registration_closed" } }), { status: 403 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await PATCH(new NextRequest("http://localhost:3000/api/registration/current", { method: "PATCH", headers: { origin: "http://localhost:3000", "x-csrf-token": "csrf-test" }, body: "{}" }), context(["registrations", "current"]));
    expect(response.status).toBe(403);
  });
});
