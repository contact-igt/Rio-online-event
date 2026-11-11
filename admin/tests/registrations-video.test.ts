import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The administrator can see whether a parent uploaded the video: a label on every row of the registrations list and a "Video" line on the
// entry page. The real pages are rendered with the API answer stubbed; an older API that sends no video field shows nothing rather than "No video".

const row = (code: string, hasVideo: boolean | undefined) => ({
  entryCode: code, status: "finalized", competitionSlug: "kathai-sollum-kutties", competitionNameTa: "கதை", competitionNameEn: "Little Storytellers", questionSetVersion: 1,
  childName: "Child", childAge: 6, guardianName: "Parent", answered: 3, openDuplicateFlag: false, createdAt: "2026-11-11T16:33:00.000Z", updatedAt: "2026-11-11T16:45:00.000Z",
  ...(hasVideo === undefined ? {} : { hasVideo }),
});
const detail = (video?: { uploaded: boolean; bytes: number | null; contentType: string | null; uploadedAt: string | null }) => ({
  entryCode: "VMSGKYNSKC", status: "finalized", competition: { slug: "kathai-sollum-kutties", nameTa: "கதை", nameEn: "Little Storytellers" }, questionSetVersion: 1,
  child: { name: "Child", age: 6 }, guardian: { name: "Parent", mobile: "+919876543210", email: null },
  consent: { guardian: { version: "v0-provisional", at: "2026-11-11T16:33:00.000Z" }, media: { granted: null, version: null, at: null } },
  answers: [], duplicates: [], createdAt: "2026-11-11T16:33:00.000Z", updatedAt: "2026-11-11T16:45:00.000Z", ...(video ? { video } : {}),
});

const h = vi.hoisted(() => ({ list: [] as unknown[], detail: null as unknown }));
vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => el("a", { href, ...rest }, children as never) };
});
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));
vi.mock("@/lib/staff/auth", () => ({ requireStaff: async () => ({ role: "admin" }) }));
vi.mock("@/lib/admin/api", () => ({
  loadCompetitions: async () => ({ ok: true, data: [] }),
  loadRegistrations: async () => ({ ok: true, data: { registrations: h.list, total: h.list.length, page: 1, pageSize: 25 } }),
  loadRegistration: async () => ({ ok: true, data: h.detail }),
}));

const listHtml = async () => {
  const { default: Page } = await import("@/app/admin/registrations/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
};
const detailHtml = async () => {
  const { default: Page } = await import("@/app/admin/registrations/[id]/page");
  return renderToStaticMarkup(createElement("div", null, await Page({ params: Promise.resolve({ id: "VMSGKYNSKC" }) })));
};

describe("video status for administrators", () => {
  it("labels each registration in the list, in English and Tamil, in words (not colour alone)", async () => {
    h.list = [row("AAAAAA1", true), row("BBBBBB2", false), row("CCCCCC3", undefined)];
    const html = await listHtml();
    expect(html.match(/Video uploaded \/ வீடியோ உள்ளது/g)).toHaveLength(1);
    expect(html.match(/No video yet \/ வீடியோ இல்லை/g)).toHaveLength(1);
  });

  it("shows size, type and time on the entry page, or says it is not uploaded yet; never a storage key", async () => {
    h.detail = detail({ uploaded: true, bytes: 7_235_174, contentType: "video/mp4", uploadedAt: "2026-11-11T16:45:00.000Z" });
    const uploaded = await detailHtml();
    expect(uploaded).toMatch(/Uploaded · 6\.9 MB · MP4 · /);
    expect(uploaded).not.toMatch(/videos\/|pending\/|r2\.cloudflarestorage/);
    h.detail = detail({ uploaded: false, bytes: null, contentType: null, uploadedAt: null });
    expect(await detailHtml()).toContain("Not uploaded yet");
    h.detail = detail();
    expect(await detailHtml()).not.toMatch(/Not uploaded yet|Uploaded ·/);
  });
});
