import { writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminNav } from "@/components/admin/admin-nav";

// The Assign Judges page lists every competition with its own form AND the judges already on it, so giving a competition two or three judges
// is plainly possible (each Assign adds one judge to every submitted entry; the ranking averages their final marks).

const h = vi.hoisted(() => ({ judges: [{ id: 7, name: "Anu", judgeCode: "JDG-AB12C", active: true }, { id: 9, name: "Ravi", judgeCode: "JDG-RV9QQ", active: true }, { id: 8, name: "Old", judgeCode: "JDG-ZZ99Z", active: false }] }));
vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => el("a", { href, ...rest }, children as never) };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/registrations", useRouter: () => ({ refresh: () => undefined }), notFound: () => { throw new Error("notFound"); } }));
vi.mock("@/lib/staff/auth", () => ({ requireStaff: async () => ({ role: "admin" }), staffSession: async () => null }));
vi.mock("@/app/admin/actions", () => ({ assignJudge: async () => ({ ok: true, added: 1 }) }));
vi.mock("@/lib/admin/api", () => ({
  loadJudgesList: async () => ({ ok: true, data: h.judges }),
  loadCompetitions: async () => ({ ok: true, data: [
    { slug: "kathai-sollum-kutties", nameTa: "கதை சொல்லும் குட்டீஸ்", nameEn: "Little Storytellers", published: null, draft: null },
    { slug: "kutti-pesalar", nameTa: "குட்டிப் பேச்சாளர்", nameEn: "Little Speaker", published: null, draft: null },
  ] }),
  loadScoringOverview: async () => ({ ok: true, data: { competitions: [
    { slug: "kathai-sollum-kutties", nameTa: "", nameEn: "", submitted: 3, ranked: 0, waiting: 0, notAssigned: 1, ties: 0, heldForReview: 0 },
    { slug: "kutti-pesalar", nameTa: "", nameEn: "", submitted: 0, ranked: 0, waiting: 0, notAssigned: 0, ties: 0, heldForReview: 0 },
  ] } }),
  loadRanking: async (slug: string) => ({ ok: true, data: { entries: slug === "kathai-sollum-kutties"
    ? [{ judges: [{ judgeName: "Anu", judgeCode: "JDG-AB12C" }, { judgeName: "Ravi", judgeCode: "JDG-RV9QQ" }] }, { judges: [{ judgeName: "Anu", judgeCode: "JDG-AB12C" }] }, { judges: [] }]
    : [] } }),
}));

describe("Assign Judges", () => {
  it("the sidebar opens /admin/assign-judges from any page", () => {
    const html = renderToStaticMarkup(createElement(AdminNav));
    const href = /<a [^>]*href="([^"]*)"[^>]*>(?:(?!<\/a>).)*?Assign Judges/s.exec(html)?.[1];
    expect(href).toBe("/admin/assign-judges");
  });

  it("shows each competition's counts and every judge already on it, once each, and offers only active judges", async () => {
    const { default: Page } = await import("@/app/admin/assign-judges/page");
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("3 submitted · 1 without a judge");
    expect(html).toContain("Anu (JDG-AB12C), Ravi (JDG-RV9QQ)"); // two judges on one competition, each listed once
    expect(html).toContain("none yet / இன்னும் இல்லை");
    expect(html).toContain("two or three judges");
    expect(html).toContain('id="judge-kathai-sollum-kutties"');
    expect(html).toContain('id="judge-kutti-pesalar"');
    expect(html).not.toContain("Old (JDG-ZZ99Z)");
  });

  it("offers a checkbox per active judge, ticks the judges already on a competition, and names the count on the button", async () => {
    const { default: Page } = await import("@/app/admin/assign-judges/page");
    const html = renderToStaticMarkup(await Page());
    const [story, speaker] = html.split('id="judge-kutti-pesalar"');
    expect(story.match(/type="checkbox"/g)).toHaveLength(2); // Anu and Ravi; the inactive judge is not offered
    expect(story.match(/type="checkbox"[^>]*checked=""/g)).toHaveLength(2); // both already judge this competition
    expect(story).toContain("Assign 2 judges");
    expect(speaker.match(/type="checkbox"/g)).toHaveLength(2);
    expect(speaker).not.toMatch(/type="checkbox"[^>]*checked=""/); // nobody on this one yet
    expect(speaker).not.toContain("Assigned / ஒதுக்கப்பட்டவர்");
    expect(html).toContain("Unticking does not remove a judge.");
    expect(html).not.toContain("<select");
    if (process.env.RIO_WRITE_PREVIEW) writeFileSync(`${process.env.RIO_WRITE_PREVIEW}/assign.html`, html);
  });

  it("/admin/assign shows the same page", async () => {
    const a = await import("@/app/admin/assign/page");
    const b = await import("@/app/admin/assign-judges/page");
    expect(a.default).toBe(b.default);
  });
});
