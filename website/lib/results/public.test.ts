import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadResults, toResults, toWinners } from "./public";

const winner = (over: Record<string, unknown> = {}) => ({ eventSlug: "kutti-pesalar", place: 1, awardLabel: null, displayName: "Asha", ...over });
const reply = (body: unknown, init: ResponseInit = {}) => (async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init })) as typeof fetch;

describe("toWinners keeps only well-formed rows of known competitions, in order, and nothing else", () => {
  it("orders by competition then rank and passes only the four public fields", () => {
    const rows = toWinners([
      winner({ eventSlug: "kutti-pesalar", place: 2, displayName: "Bala", submissionId: 7, childName: "SECRET", approvedBy: 9 }),
      winner({ eventSlug: "kathai-sollum-kutties", place: 1, displayName: "Chitra", awardLabel: " First prize " }),
      winner({ eventSlug: "kutti-pesalar", place: 1, displayName: "Asha" }),
    ]);
    expect(rows).toEqual([
      { eventSlug: "kathai-sollum-kutties", rank: 1, displayName: "Chitra", awardLabel: "First prize" },
      { eventSlug: "kutti-pesalar", rank: 1, displayName: "Asha", awardLabel: null },
      { eventSlug: "kutti-pesalar", rank: 2, displayName: "Bala", awardLabel: null },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/SECRET|submission|approved|child/i);
  });
  it("drops malformed rows and unknown competitions instead of showing them", () => {
    expect(toWinners([winner({ eventSlug: "unknown-contest" }), winner({ place: 0 }), winner({ place: 11 }), winner({ displayName: "" }), winner({ displayName: "x".repeat(61) }), winner({ awardLabel: "x".repeat(81) }), winner({ place: "1" }), null, 5, "x", {}])).toEqual([]);
    expect(toWinners(null)).toEqual([]);
    expect(toWinners({ rows: [] })).toEqual([]);
  });
});

describe("toResults", () => {
  it("is 'pending' (nothing shown) for a pending answer, whatever else it carries", () => {
    expect(toResults({ state: "pending" })).toEqual({ kind: "pending" });
    expect(toResults({ state: "pending", winners: [winner()] })).toEqual({ kind: "pending" });
  });
  it("shows winners exactly when the API says published", () => {
    expect(toResults({ state: "published", winners: [winner()] })).toEqual({ kind: "published", winners: [{ eventSlug: "kutti-pesalar", rank: 1, displayName: "Asha", awardLabel: null }] });
    expect(toResults({ state: "published", winners: [] })).toEqual({ kind: "published", winners: [] });
  });
  it("treats any other answer as unavailable, never as published", () => {
    for (const bad of [null, {}, { state: "open" }, { state: "published" }, { state: "published", winners: "x" }, "published", []]) expect(toResults(bad), JSON.stringify(bad)).toEqual({ kind: "unavailable" });
  });
});

describe("loadResults", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RIO_BACKEND_API_URL", "https://api.example.org");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it("asks the Express API for /api/v1/results with no caching and no credentials", async () => {
    let seen: { url: string; init: RequestInit | undefined } | null = null;
    const fetcher = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ state: "pending" }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await loadResults(fetcher)).toEqual({ kind: "pending" });
    expect(seen!.url).toBe("https://api.example.org/api/v1/results");
    expect(seen!.init).toMatchObject({ cache: "no-store", redirect: "error" });
    expect(JSON.stringify(seen!.init)).not.toMatch(/cookie|authorization/i);
  });
  it("is 'unavailable' without calling anything when the API address is not configured", async () => {
    vi.stubEnv("RIO_BACKEND_API_URL", "");
    const fetcher = vi.fn();
    expect(await loadResults(fetcher as unknown as typeof fetch)).toEqual({ kind: "unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("is 'unavailable' when the API is down, refuses, redirects or answers with something unreadable", async () => {
    expect(await loadResults((async () => { throw new Error("connect ECONNREFUSED"); }) as typeof fetch)).toEqual({ kind: "unavailable" });
    expect(await loadResults(reply({ state: "published", winners: [] }, { status: 500 }))).toEqual({ kind: "unavailable" });
    expect(await loadResults((async () => new Response("<html>bad gateway</html>", { status: 200 })) as typeof fetch)).toEqual({ kind: "unavailable" });
  });
});

describe("the module's source", () => {
  const source = readFileSync(new URL("./public.ts", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  it("uses only the Express API: no Supabase, no secret, no write", () => {
    expect(source).not.toMatch(/supabase|SUPABASE|createClient|\.rpc\(|\.insert\(|\.update\(|\.delete\(/i);
    expect(source).toContain("/api/v1/results");
    expect(source).toContain('cache: "no-store"');
  });
});
