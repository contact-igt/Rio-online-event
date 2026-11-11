import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  class Redirect extends Error { constructor(public url: string) { super(`redirect:${url}`); } }
  return {
    Redirect,
    settings: { registrationOpen: true, guardianConsentVersion: "v0-provisional", mediaConsentVersion: "v-media", opensAt: null, closesAt: null, serverTime: new Date().toISOString() },
    current: null as null | { view: { status: string }; csrfToken: string },
    create: vi.fn(), update: vi.fn(), recover: vi.fn(), cookie: { set: vi.fn(), get: vi.fn() },
  };
});

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new h.Redirect(url); } }));
vi.mock("next/headers", () => ({ cookies: async () => h.cookie }));
vi.mock("@/lib/registration/express", () => ({
  publicSettings: async () => h.settings,
  currentRegistration: async () => h.current,
  createRegistration: h.create,
  updateRegistration: h.update,
  recoverRegistration: h.recover,
}));

type Actions = typeof import("./actions");
let actions: Actions;

const base = { event: "kutti-pesalar", childName: "Asha Kumar", childAge: "9", guardianName: "Meena Kumar", guardianMobile: "98765 43210", guardianEmail: "parent@example.com", guardianConsent: "on", mediaConsent: "on" };
const form = (over: Record<string, string | undefined> = {}) => {
  const fd = new FormData();
  for (const [key, value] of Object.entries({ ...base, ...over })) if (value !== undefined) fd.set(key, value);
  fd.set("answer_school", "அரசு பள்ளி");
  fd.set("questionType_school", "short_text");
  return fd;
};
async function run<T>(fn: () => Promise<T>): Promise<{ state?: T; redirect?: string }> {
  try { return { state: await fn() }; } catch (error) { if (error instanceof h.Redirect) return { redirect: error.url }; throw error; }
}

beforeEach(async () => {
  vi.resetModules();
  h.settings.registrationOpen = true;
  h.current = null;
  h.create.mockReset().mockResolvedValue({ status: 201, body: { recoveryCode: "ABCD-EFGH-IJKM-NPQR-STVW-XYZ0", registration: {} } });
  h.update.mockReset().mockResolvedValue({ status: 200, body: { registration: {}, csrfToken: "next" } });
  h.recover.mockReset().mockResolvedValue({ status: 200, body: { registration: {}, csrfToken: "next" } });
  h.cookie.set.mockClear();
  actions = await import("./actions");
});

describe("M6A public registration action", () => {
  it("refuses a closed registration without calling create", async () => {
    h.settings.registrationOpen = false;
    const result = await run(() => actions.saveDraft(undefined, form()));
    expect(result.state?.error?.en).toMatch(/not open/i);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("creates a draft with backend consent, optional email, and typed answers", async () => {
    const result = await run(() => actions.saveDraft(undefined, form()));
    expect(result.redirect).toBe("/events/kutti-pesalar/register?saved=1");
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      eventSlug: "kutti-pesalar", guardianEmail: "parent@example.com",
      guardianConsent: { accepted: true, version: "v0-provisional" },
      mediaConsent: { granted: true, version: "v-media" }, answers: { school: "அரசு பள்ளி" },
    }));
    expect(h.cookie.set).toHaveBeenCalledWith("rio_recovery_notice", expect.stringMatching(/^[A-Z0-9-]+$/), expect.objectContaining({ httpOnly: true }));
  });

  it("updates only through the recovery cookie session and backend CSRF token", async () => {
    h.current = { view: { status: "draft" }, csrfToken: "csrf-from-current" };
    const result = await run(() => actions.saveDraft(undefined, form({ draftId: "current" })));
    expect(result.redirect).toBe("/events/kutti-pesalar/register?saved=1");
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ childName: "Asha Kumar" }), "csrf-from-current");
  });

  it("recovers by code without putting it in the redirect URL", async () => {
    const fd = new FormData(); fd.set("event", "kutti-pesalar"); fd.set("recoveryCode", "ABCD-EFGH-IJKM-NPQR-STVW-XYZ0");
    const result = await run(() => actions.recoverDraft(undefined, fd));
    expect(result.redirect).toBe("/events/kutti-pesalar/register");
    expect(h.recover).toHaveBeenCalledWith("ABCD-EFGH-IJKM-NPQR-STVW-XYZ0");
  });
});
