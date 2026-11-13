import { writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The registration page, one page and one button (owner, 2026-11-13): the form with the video and the consent box until the entry is
// submitted (a draft left unfinished opens the same form, filled in), then the summary only. The form is a stand-in here (it has its own
// tests); this checks what is shown and what the form is told about the video.

const question = (key: string, type: string, promptEn: string, options: { code: string; ta: string; en: string }[] | null = null) => ({
  key, type, position: 1, promptTa: `${promptEn} (த)`, promptEn, helpTa: null, helpEn: null, required: true, options, maxLength: null, minNumber: null, maxNumber: null,
});
const questions = [question("school", "short_text", "School Name"), question("pin", "number", "Postal PIN Code"), question("note", "instruction", "Read this")];
const h = vi.hoisted(() => ({ view: null as unknown, status: "draft", video: false, uploads: true }));
const view = () => ({
  reference: "RIOFLOW001", status: h.status, editable: h.status === "draft",
  event: { slug: "kutti-pesalar", nameTa: "குட்டிப் பேச்சாளர்", nameEn: "Little Speaker", minAge: 8, maxAge: 12 },
  child: { name: "Asha", age: 9 }, guardian: { name: "Priya", mobile: "+919876543210", email: "priya@example.org" },
  consent: { guardian: { version: "v0-provisional", at: "2026-11-12T10:00:00.000Z" }, media: { granted: null, version: null, at: null } },
  questionSet: { version: 1, questions }, answers: { school: "Sunshine School", pin: 600001 }, missingRequired: [],
  video: { uploaded: h.video, bytes: h.video ? 7_000_000 : null, contentType: h.video ? "video/mp4" : null, uploadedAt: null },
  createdAt: null, updatedAt: null, codeExpiresAt: "2026-12-12T00:00:00.000Z",
});

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => el("a", { href, ...rest }, children as never) };
});
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); }, useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/components/registration/registration-form", async () => {
  const { createElement: el } = await import("react");
  return {
    RegistrationForm: ({ finish, draft }: { finish?: unknown; draft?: { childName: string } | null }) =>
      el("div", { "data-testid": "form" }, `FORM finish=${JSON.stringify(finish)} draft=${draft?.childName ?? "none"}`),
  };
});
vi.mock("@/lib/registration/express", () => ({
  publicEvents: async () => [{ slug: "kutti-pesalar", nameTa: "குட்டிப் பேச்சாளர்", nameEn: "Little Speaker", minAge: 8, maxAge: 12, questionSet: { version: 1, questions } }],
  publicSettings: async () => ({ registrationOpen: true, opensAt: null, closesAt: null, guardianConsentVersion: "v0-provisional", mediaConsentVersion: null, videoUploads: h.uploads, serverTime: "" }),
  currentRegistration: async () => (h.view ? { view: h.view, csrfToken: "t" } : null),
}));

const render = async () => {
  const { default: Page } = await import("@/app/events/[slug]/register/page");
  return renderToStaticMarkup(createElement("div", null, await Page({ params: Promise.resolve({ slug: "kutti-pesalar" }) })));
};

beforeEach(() => {
  h.status = "draft";
  h.video = false;
  h.view = null;
  h.uploads = true;
});

describe("registration page, one page and one button", () => {
  it("a new entry: the form, with the video step inside it and uploads open", async () => {
    const html = await render();
    expect(html).toContain('FORM finish={&quot;hasVideo&quot;:false,&quot;uploadsOpen&quot;:true} draft=none');
    expect(html).not.toContain("Your details");
    expect(html).not.toContain("Entry submitted");
  });

  it("an unfinished draft opens the same form, filled in, not a summary with separate steps", async () => {
    h.view = view();
    const html = await render();
    expect(html).toContain("draft=Asha");
    expect(html).toContain("&quot;hasVideo&quot;:false");
    expect(html).not.toContain("Your details");
    if (process.env.RIO_WRITE_PREVIEW) writeFileSync(`${process.env.RIO_WRITE_PREVIEW}/register-draft.html`, html);
  });

  it("a draft whose video is already uploaded tells the form, so Submit does not ask for it again", async () => {
    h.video = true;
    h.view = view();
    const html = await render();
    expect(html).toContain("&quot;hasVideo&quot;:true");
  });

  it("tells the form when uploads are switched off", async () => {
    h.uploads = false;
    const html = await render();
    expect(html).toContain("&quot;uploadsOpen&quot;:false");
  });

  it("after submitting: the success panel only, with the video confirmed, no details list and no form", async () => {
    h.status = "finalized";
    h.video = true;
    h.view = view();
    const html = await render();
    expect(html).not.toContain("FORM");
    expect(html).not.toContain("Your details"); // owner, 2026-11-13: no details list under the success panel
    expect(html).not.toContain("Sunshine School");
    expect(html).not.toContain("+919876543210");
    expect(html).toContain("Uploaded successfully"); // the video is confirmed in the panel
    expect(html).not.toContain("?edit=1");
    expect(html).toContain("You are registered successfully!"); // the success page
    expect(html).toContain("RIOFLOW001"); // the reference, shown large
    expect(html).toContain("Please keep this reference number.");
    expect(html).not.toMatch(/email will be sent/i); // no e-mail is promised: none is sent yet
    if (process.env.RIO_WRITE_PREVIEW) writeFileSync(`${process.env.RIO_WRITE_PREVIEW}/register-done.html`, html);
  });
});
