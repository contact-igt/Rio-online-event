import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  reply: { status: 200, body: null as unknown, setCookies: [] as string[] },
  session: null as null | { csrfToken: string },
  calls: [] as { path: string; init: Record<string, unknown> }[],
  relayed: [] as string[][],
  cookie: "rio_staff=tok" as string | null,
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("redirect"), { to });
  },
}));
vi.mock("@/lib/api/express", () => ({
  callApi: async (path: string, init: Record<string, unknown>) => {
    h.calls.push({ path, init });
    return h.reply;
  },
  relayCookies: async (c: string[]) => void h.relayed.push(c),
  sessionCookieHeader: async () => h.cookie,
}));
vi.mock("@/lib/staff/auth", () => ({ currentStaff: async () => h.session }));

import { setPasswordAction } from "./actions";

const form = (v: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, x] of Object.entries(v)) fd.append(k, x);
  return fd;
};
const good = { current: "old-temp-password", password: "a-long-new-password", confirm: "a-long-new-password" };
const redirectTo = async (p: Promise<unknown>) => p.then((r) => r, (e: { to?: string }) => e.to ?? null);

beforeEach(() => {
  h.reply = { status: 200, body: { user: { role: "admin" }, csrfToken: "c2" }, setCookies: ["rio_staff=rotated"] };
  h.session = { csrfToken: "c" };
  h.calls = [];
  h.relayed = [];
  h.cookie = "rio_staff=tok";
});

describe("setPasswordAction", () => {
  it("sends both passwords with the CSRF token, relays the rotated session cookie and goes to /admin", async () => {
    expect(await redirectTo(setPasswordAction(undefined, form(good)))).toBe("/admin");
    expect(h.calls[0]).toMatchObject({ path: "/staff/password", init: { method: "POST", csrf: "c", body: { currentPassword: good.current, newPassword: good.password } } });
    expect(h.relayed).toEqual([["rio_staff=rotated"]]);
  });
  it("needs a signed-in session", async () => {
    h.session = null;
    expect(await redirectTo(setPasswordAction(undefined, form(good)))).toBe("/staff/login");
    expect(h.calls).toEqual([]);
  });
  it("checks the repeat locally, without calling the API", async () => {
    expect(await setPasswordAction(undefined, form({ ...good, confirm: "different-password" }))).toEqual({ error: "mismatch" });
    expect(h.calls).toEqual([]);
  });
  it("a refused new password reports the API's actual reasons, not only a generic message, and relays nothing", async () => {
    h.reply = { status: 422, body: { error: { code: "weak_password", problems: ["contains the e-mail name", "same as the current password"] } }, setCookies: ["rio_staff=x"] };
    expect(await setPasswordAction(undefined, form(good))).toEqual({ error: "weak", reasons: ["contains the e-mail name", "same as the current password"] });
    expect(h.relayed).toEqual([]);
  });
  it("an expired session on save goes back to sign-in instead of showing a password error", async () => {
    h.reply = { status: 401, body: { error: { code: "unauthenticated" } }, setCookies: [] };
    expect(await redirectTo(setPasswordAction(undefined, form(good)))).toBe("/staff/login");
    expect(h.relayed).toEqual([]);
  });
  it("an unreachable API is a connection problem, not a password problem", async () => {
    h.reply = { status: 0, body: null, setCookies: [] };
    expect(await setPasswordAction(undefined, form(good))).toEqual({ error: "unavailable" });
  });
  it.each([
    [403, "current_password_incorrect", "current"],
    [429, "rate_limited", "tooMany"],
    [500, undefined, "unavailable"],
  ])("answers %i with %s as %s and relays nothing", async (status, code, error) => {
    h.reply = { status, body: { error: { code } }, setCookies: ["rio_staff=x"] };
    expect(await setPasswordAction(undefined, form(good))).toEqual({ error });
    expect(h.relayed).toEqual([]);
  });
});
