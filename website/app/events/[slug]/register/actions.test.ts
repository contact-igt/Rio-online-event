import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  class Redirect extends Error { constructor(public url: string) { super(`redirect:${url}`); } }
  return {
    Redirect,
    settings: { registrationOpen: true, guardianConsentVersion: "v0-provisional", mediaConsentVersion: "v-media", opensAt: null, closesAt: null, serverTime: new Date().toISOString() },
    current: null as null | { view: { status: string; event: { slug: string }; questionSet: { questions: { key: string; type: string; required: boolean }[] } }; csrfToken: string },
    events: [] as { slug: string; questionSet: { version: number; questions: { key: string; type: string; required: boolean }[] } | null }[],
    create: vi.fn(), update: vi.fn(), recover: vi.fn(), cookie: { set: vi.fn(), get: vi.fn() },
  };
});

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new h.Redirect(url); } }));
vi.mock("next/headers", () => ({ cookies: async () => h.cookie }));
vi.mock("@/lib/registration/express", () => ({
  publicSettings: async () => h.settings,
  publicEvents: async () => h.events,
  currentRegistration: async () => h.current,
  createRegistration: h.create,
  updateRegistration: h.update,
  recoverRegistration: h.recover,
}));

type Actions = typeof import("./actions");
let actions: Actions;

const base = { event: "kutti-pesalar", childName: "Asha Kumar", childAge: "9", parentName: "Meena Kumar", mobile: "98765 43210", guardianEmail: "parent@example.com", guardianConsent: "on", mediaConsent: "on" };
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
  h.events = [{ slug: "kutti-pesalar", questionSet: { version: 3, questions: [{ key: "school", type: "short_text", required: true }, { key: "note", type: "instruction", required: true }] } }];
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
      eventSlug: "kutti-pesalar", childName: "Asha Kumar", childAge: 9, guardianName: "Meena Kumar", guardianMobile: "+919876543210", guardianEmail: "parent@example.com",
      guardianConsent: { accepted: true, version: "v0-provisional" },
      mediaConsent: { granted: true, version: "v-media" }, answers: { school: "அரசு பள்ளி" },
    }));
    expect(h.cookie.set).toHaveBeenCalledWith("rio_recovery_notice", expect.stringMatching(/^[A-Z0-9-]+$/), expect.objectContaining({ httpOnly: true }));
  });

  it("sends every rendered question, so an unticked checkbox group clears the saved answer", async () => {
    const fd = form();
    fd.set("questionType_hobbies", "checkboxes");
    fd.set("questionType_note", "instruction");
    fd.set("questionType_age", "number");
    fd.set("answer_age", "");
    fd.append("answer_pick", "a"); fd.set("questionType_pick", "checkboxes"); fd.append("answer_pick", "b");
    await run(() => actions.saveDraft(undefined, fd));
    expect(h.create.mock.calls[0]![0].answers).toEqual({ school: "அரசு பள்ளி", hobbies: [], age: null, pick: ["a", "b"] });
  });

  it("shows the API's field problems under the form fields", async () => {
    h.create.mockResolvedValue({ status: 422, body: null, fields: [{ field: "guardianName", problem: "invalid_name" }, { field: "childAge", problem: "out_of_range" }] });
    const result = await run(() => actions.saveDraft(undefined, form()));
    expect(Object.keys(result.state?.fieldErrors ?? {}).sort()).toEqual(["childAge", "parentName"]);
    expect(result.state?.error?.en).toMatch(/fix the fields/i);
    h.create.mockResolvedValue({ status: 422, body: null, fields: [{ field: "answers.school", problem: "too_long" }] });
    expect((await run(() => actions.saveDraft(undefined, form()))).state?.error?.en).toMatch(/answers/i);
  });

  it("puts a bad mobile number under the mobile field and calls nothing", async () => {
    for (const mobile of ["", "12345", "5876543210"]) {
      const result = await run(() => actions.saveDraft(undefined, form({ mobile })));
      expect(Object.keys(result.state?.fieldErrors ?? {}), mobile).toEqual(["mobile"]);
      expect(result.state?.fieldErrors?.mobile?.en).toMatch(/10-digit/);
      expect(result.state?.values?.childName).toBe("Asha Kumar");
    }
    expect(h.create).not.toHaveBeenCalled();
  });

  it("shows a missing guardian consent next to the consent box, however the API names the field", async () => {
    for (const field of ["guardianConsent", "guardianConsent.accepted"]) {
      h.create.mockResolvedValue({ status: 422, body: null, fields: [{ field, problem: "consent_required" }] });
      const result = await run(() => actions.saveDraft(undefined, form({ guardianConsent: undefined })));
      expect(Object.keys(result.state?.fieldErrors ?? {}), field).toEqual(["guardianConsent"]);
      expect(result.state?.fieldErrors?.guardianConsent?.en).toMatch(/consent is needed/i);
    }
  });

  it("refuses a missing required answer on the server, under its question, and calls nothing", async () => {
    const fd = form();
    fd.set("answer_school", "   ");
    const result = await run(() => actions.saveDraft(undefined, fd));
    expect(Object.keys(result.state?.fieldErrors ?? {})).toEqual(["answer_school"]);
    expect(result.state?.fieldErrors?.answer_school?.en).toMatch(/answer this question/i);
    expect(result.state?.answers).toEqual({ school: "   " });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("does not ask for an instruction, and takes the required questions from the API, not from the posted form", async () => {
    h.events = [{ slug: "kutti-pesalar", questionSet: { version: 3, questions: [{ key: "school", type: "short_text", required: true }, { key: "other", type: "radio", required: true }] } }];
    const fd = form();
    fd.set("questionType_note", "instruction");
    const result = await run(() => actions.saveDraft(undefined, fd));
    expect(Object.keys(result.state?.fieldErrors ?? {})).toEqual(["answer_other"]); // a question the browser did not post is still required
    expect(h.create).not.toHaveBeenCalled();
  });

  it("an existing draft is checked against the question version it was created with, not the one published now", async () => {
    h.current = { view: { status: "draft", event: { slug: "kutti-pesalar" }, questionSet: { questions: [{ key: "school", type: "short_text", required: true }, { key: "old_only", type: "short_text", required: true }] } }, csrfToken: "csrf" };
    const result = await run(() => actions.saveDraft(undefined, form({ draftId: "current" })));
    expect(Object.keys(result.state?.fieldErrors ?? {})).toEqual(["answer_old_only"]);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("never edits a draft that belongs to another competition", async () => {
    h.current = { view: { status: "draft", event: { slug: "malalai-mozhi" }, questionSet: { questions: [] } }, csrfToken: "csrf" };
    const result = await run(() => actions.saveDraft(undefined, form({ draftId: "current" })));
    expect(result.state?.error?.en).toMatch(/not found|no longer|could not/i);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("puts an API problem with one answer under that question", async () => {
    h.create.mockResolvedValue({ status: 422, body: null, fields: [{ field: "answers.school", problem: "too_long" }] });
    const result = await run(() => actions.saveDraft(undefined, form()));
    expect(Object.keys(result.state?.fieldErrors ?? {})).toEqual(["answer_school"]);
    expect(result.state?.answers).toEqual({ school: "அரசு பள்ளி" });
  });

  it("updates only through the recovery cookie session and backend CSRF token", async () => {
    h.current = { view: { status: "draft", event: { slug: "kutti-pesalar" }, questionSet: { questions: [{ key: "school", type: "short_text", required: true }] } }, csrfToken: "csrf-from-current" };
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
