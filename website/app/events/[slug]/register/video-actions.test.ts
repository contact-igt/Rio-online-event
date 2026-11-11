import { beforeEach, describe, expect, it, vi } from "vitest";
import { codeFrom } from "@/lib/upload/api-codes";

// The upload server actions: they forward to the Express API with the entry's CSRF token, refuse obvious junk before calling it, and turn
// the API's answers into codes the screen explains. The API's own rules are covered in backend/src/registration/video.test.ts.

const h = vi.hoisted(() => ({
  current: { csrfToken: "csrf-1" } as { csrfToken: string } | null,
  start: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("@/lib/registration/express", () => ({
  currentRegistration: async () => (h.current ? { view: {}, csrfToken: h.current.csrfToken } : null),
  startVideoUpload: h.start,
  completeVideoUpload: h.complete,
}));

type Actions = typeof import("./video-actions");
let actions: Actions;
const MB = 1024 * 1024;
const ID = "11111111-2222-4333-8444-555555555555";
const grant = { uploadId: ID, url: "https://acct.r2.cloudflarestorage.com/b/pending/x?X-Amz-Signature=s", contentType: "video/mp4", expiresAt: "2026-11-11T10:10:00.000Z" };

beforeEach(async () => {
  h.current = { csrfToken: "csrf-1" };
  h.start.mockReset();
  h.complete.mockReset();
  actions = await import("./video-actions");
});

describe("requestVideoUpload", () => {
  it("asks the API with the entry's CSRF token and returns the 10-minute URL", async () => {
    h.start.mockResolvedValue({ status: 201, body: { upload: grant } });
    expect(await actions.requestVideoUpload({ type: "video/mp4", bytes: 20 * MB })).toEqual({ ok: true, ...grant });
    expect(h.start).toHaveBeenCalledWith({ type: "video/mp4", bytes: 20 * MB }, "csrf-1");
  });

  it.each([
    ["over 50 MB", { type: "video/mp4", bytes: 50 * MB + 1 }, "tooBig"],
    ["not a video", { type: "image/png", bytes: 20 * MB }, "type"],
    ["too small", { type: "video/mp4", bytes: 10 }, "tooSmall"],
    ["not a number", { type: "video/mp4", bytes: Number.NaN }, "tooSmall"],
  ])("refuses %s without calling the API", async (_label, input, code) => {
    expect(await actions.requestVideoUpload(input)).toEqual({ ok: false, code });
    expect(h.start).not.toHaveBeenCalled();
  });

  it("says the entry was not found when no recovery cookie opens one", async () => {
    h.current = null;
    expect(await actions.requestVideoUpload({ type: "video/mp4", bytes: 20 * MB })).toEqual({ ok: false, code: "notFound" });
    expect(h.start).not.toHaveBeenCalled();
  });

  it("explains that the one video is already attached", async () => {
    h.start.mockResolvedValue({ status: 409, body: null, code: "video_already_uploaded" });
    expect(await actions.requestVideoUpload({ type: "video/mp4", bytes: 20 * MB })).toEqual({ ok: false, code: "already" });
  });

  it("never lets an exception's text reach the browser", async () => {
    h.start.mockRejectedValue(new Error("SECRET-DETAIL https://acct.r2.cloudflarestorage.com"));
    const r = await actions.requestVideoUpload({ type: "video/mp4", bytes: 20 * MB });
    expect(r).toEqual({ ok: false, code: "unavailable" });
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });
});

describe("confirmVideoUpload", () => {
  it("reports the upload done with the CSRF token", async () => {
    h.complete.mockResolvedValue({ status: 200, body: { registration: {} } });
    expect(await actions.confirmVideoUpload({ uploadId: ID })).toEqual({ ok: true });
    expect(h.complete).toHaveBeenCalledWith(ID, "csrf-1");
  });

  it("refuses an id that is not a uuid without calling the API (no path tricks)", async () => {
    for (const bad of ["", "../../admin", `${ID}/../x`, "not-a-uuid"]) expect(await actions.confirmVideoUpload({ uploadId: bad }), bad).toEqual({ ok: false, code: "invalid" });
    expect(h.complete).not.toHaveBeenCalled();
  });
});

describe("codeFrom: the API's answer as a message code", () => {
  it.each([
    [{ status: 422, fields: [{ field: "bytes", problem: "too_big" }] }, "tooBig"],
    [{ status: 422, fields: [{ field: "bytes", problem: "too_small" }] }, "tooSmall"],
    [{ status: 422, fields: [{ field: "type", problem: "unsupported_type" }] }, "type"],
    [{ status: 422, fields: [{ field: "video", problem: "mismatch" }] }, "mismatch"],
    [{ status: 422, fields: [{ field: "video", problem: "too_big" }] }, "tooBig"],
    [{ status: 409, code: "video_already_uploaded" }, "already"],
    [{ status: 403, code: "registration_closed" }, "closed"],
    [{ status: 409, code: "not_editable" }, "locked"],
    [{ status: 409, code: "upload_not_current" }, "notCurrent"],
    [{ status: 404, code: "upload_not_found" }, "notCurrent"],
    [{ status: 409, code: "upload_expired" }, "expired"],
    [{ status: 409, code: "upload_missing" }, "missing"],
    [{ status: 401, code: "no_registration" }, "notFound"],
    [{ status: 429, code: "rate_limited" }, "tooMany"],
    [{ status: 503, code: "uploads_unavailable" }, "unavailable"],
    [{ status: 403, code: "csrf_invalid" }, "unavailable"],
  ])("%j -> %s", (reply, code) => {
    expect(codeFrom(reply)).toBe(code);
  });
});
