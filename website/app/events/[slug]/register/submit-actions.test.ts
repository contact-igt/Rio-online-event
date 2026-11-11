import { beforeEach, describe, expect, it, vi } from "vitest";
import { submitCodeFrom } from "@/lib/submit/api-codes";

// The submit server action: it forwards to the Express API with the entry's CSRF token and turns the answer into a message code. The API's
// own rules (window, consent, answers, video length, duplicate hold) are covered in backend/src/registration/video.test.ts.

const h = vi.hoisted(() => ({
  current: { csrfToken: "csrf-1", view: { status: "draft" } } as { csrfToken: string; view: { status: string } } | null,
  submit: vi.fn(),
}));

vi.mock("@/lib/registration/express", () => ({
  currentRegistration: async () => h.current,
  submitRegistration: h.submit,
}));

type Actions = typeof import("./submit-actions");
let actions: Actions;

beforeEach(async () => {
  h.current = { csrfToken: "csrf-1", view: { status: "draft" } };
  h.submit.mockReset();
  actions = await import("./submit-actions");
});

describe("submitEntry", () => {
  it("submits with the entry's CSRF token", async () => {
    h.submit.mockResolvedValue({ status: 200, body: { registration: { status: "finalized" } } });
    expect(await actions.submitEntry()).toEqual({ ok: true, already: false });
    expect(h.submit).toHaveBeenCalledWith("csrf-1");
  });

  it("a second press on a submitted entry is reported as already submitted, whether finalized or held (the parent is not told which)", async () => {
    for (const status of ["finalized", "held"]) {
      h.current = { csrfToken: "csrf-1", view: { status } };
      h.submit.mockResolvedValue({ status: 200, body: { registration: { status } } });
      expect(await actions.submitEntry()).toEqual({ ok: true, already: true });
    }
  });

  it("says the entry was not found when no registration cookie opens one, without calling the API", async () => {
    h.current = null;
    expect(await actions.submitEntry()).toEqual({ ok: false, code: "notFound" });
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("never lets an exception's text reach the browser", async () => {
    h.submit.mockRejectedValue(new Error("SECRET-DETAIL https://acct.r2.cloudflarestorage.com"));
    const r = await actions.submitEntry();
    expect(r).toEqual({ ok: false, code: "unavailable" });
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });
});

describe("submitCodeFrom: the API's answer as a message code", () => {
  it.each([
    [{ status: 422, fields: [{ field: "video", problem: "too_short" }] }, "videoDuration"],
    [{ status: 422, fields: [{ field: "video", problem: "too_long" }] }, "videoDuration"],
    [{ status: 422, fields: [{ field: "video", problem: "not_video" }] }, "videoInvalid"],
    [{ status: 422, fields: [{ field: "guardianConsent", problem: "required" }] }, "consent"],
    [{ status: 422, fields: [{ field: "answers.school", problem: "required" }] }, "answers"],
    [{ status: 422, fields: [{ field: "confirm", problem: "confirm_required" }] }, "invalid"],
    [{ status: 409, code: "video_required" }, "noVideo"],
    [{ status: 403, code: "registration_closed" }, "closed"],
    [{ status: 409, code: "not_editable" }, "locked"],
    [{ status: 401, code: "no_registration" }, "notFound"],
    [{ status: 429, code: "rate_limited" }, "tooMany"],
    [{ status: 503, code: "submission_unavailable" }, "unavailable"],
  ])("%j -> %s", (reply, code) => {
    expect(submitCodeFrom(reply)).toBe(code);
  });
});
