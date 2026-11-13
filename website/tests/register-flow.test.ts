import { writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The one-sitting registration page (owner, 2026-11-12): the form before saving; after saving a short summary with "Edit details" and the
// video step straight after it; the form again only on request; after submitting the summary only. The form and the next-steps panel are
// stand-ins here (they have their own tests); this checks what is shown, and in which order.

const question = (key: string, type: string, promptEn: string, options: { code: string; ta: string; en: string }[] | null = null) => ({
  key, type, position: 1, promptTa: `${promptEn} (த)`, promptEn, helpTa: null, helpEn: null, required: true, options, maxLength: null, minNumber: null, maxNumber: null,
});
const questions = [question("school", "short_text", "School Name"), question("pin", "number", "Postal PIN Code"), question("note", "instruction", "Read this")];
const h = vi.hoisted(() => ({ view: null as unknown, status: "draft", video: false }));
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
  return { RegistrationForm: () => el("div", { "data-testid": "form" }, "FORM") };
});
vi.mock("@/components/registration/next-steps", async () => {
  const { createElement: el } = await import("react");
  return { NextSteps: ({ submit }: { submit?: unknown }) => el("section", { id: "next-steps" }, "NEXT-STEPS", submit as never) };
});
vi.mock("@/components/registration/submit-entry", async () => {
  const { createElement: el } = await import("react");
  return { SubmitEntry: () => el("div", null, "SUBMIT-BUTTON") };
});
vi.mock("@/lib/registration/express", () => ({
  publicEvents: async () => [{ slug: "kutti-pesalar", nameTa: "குட்டிப் பேச்சாளர்", nameEn: "Little Speaker", minAge: 8, maxAge: 12, questionSet: { version: 1, questions } }],
  publicSettings: async () => ({ registrationOpen: true, opensAt: null, closesAt: null, guardianConsentVersion: "v0-provisional", mediaConsentVersion: null, videoUploads: true, serverTime: "" }),
  currentRegistration: async () => (h.view ? { view: h.view, csrfToken: "t" } : null),
}));

const render = async (query: Record<string, string> = {}) => {
  const { default: Page } = await import("@/app/events/[slug]/register/page");
  return renderToStaticMarkup(createElement("div", null, await Page({ params: Promise.resolve({ slug: "kutti-pesalar" }), searchParams: Promise.resolve(query) })));
};

beforeEach(() => {
  h.status = "draft";
  h.video = false;
  h.view = null;
});

describe("registration page, one sitting", () => {
  it("before saving: only the form", async () => {
    const html = await render();
    expect(html).toContain("FORM");
    expect(html).not.toContain("NEXT-STEPS");
    expect(html).not.toContain("Your details");
  });

  it("after saving: a short summary with Edit details, then the video step right after it, and no form", async () => {
    h.view = view();
    const html = await render({ saved: "1" });
    expect(html).not.toContain("FORM");
    expect(html).toContain("Details saved. Now upload the video.");
    const summary = html.indexOf("Your details");
    const next = html.indexOf("NEXT-STEPS");
    expect(summary).toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(summary); // the video step follows the summary directly
    expect(html).toContain("Asha, 9");
    expect(html).toContain("Sunshine School");
    expect(html).toContain("600001");
    expect(html).not.toContain("Read this"); // an instruction is not an answer
    expect(html).toContain('href="/events/kutti-pesalar/register?edit=1#details"');
    if (process.env.RIO_WRITE_PREVIEW) writeFileSync(`${process.env.RIO_WRITE_PREVIEW}/register-saved.html`, html);
  });

  it("Edit details brings the form back (with a way out), the summary steps aside, and the video step stays below", async () => {
    h.view = view();
    const html = await render({ edit: "1" });
    expect(html).toContain("FORM");
    expect(html).not.toContain("Your details");
    expect(html).toContain("Back without changes");
    expect(html.indexOf("FORM")).toBeLessThan(html.indexOf("NEXT-STEPS"));
  });

  it("with the video uploaded: saving again just says saved, and Submit is offered", async () => {
    h.video = true;
    h.view = view();
    const html = await render({ saved: "1" });
    expect(html).toContain("Details saved.");
    expect(html).not.toContain("Now upload the video");
    expect(html).toContain("SUBMIT-BUTTON");
  });

  it("after submitting: the summary only, read only, and no form even if asked", async () => {
    h.status = "finalized";
    h.video = true;
    h.view = view();
    const html = await render({ edit: "1" });
    expect(html).not.toContain("FORM");
    expect(html).toContain("Your details");
    expect(html).not.toContain("?edit=1");
    expect(html).toContain("Details cannot be changed after the entry is submitted.");
    expect(html).toContain("Entry submitted");
  });
});
