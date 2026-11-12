import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminNav } from "@/components/admin/admin-nav";

// The Assign Judges page lists every competition with its own form, and the sidebar opens it from anywhere (it used to send the
// administrator to the dashboard unless a competition page was already open).

const h = vi.hoisted(() => ({ judges: [{ id: 7, name: "Anu", judgeCode: "JDG-AB12C", active: true }, { id: 8, name: "Old", judgeCode: "JDG-ZZ99Z", active: false }] }));
vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => el("a", { href, ...rest }, children as never) };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/registrations", useRouter: () => ({ refresh: () => undefined }), notFound: () => { throw new Error("notFound"); } }));
vi.mock("@/lib/staff/auth", () => ({ requireStaff: async () => ({ role: "admin" }), staffSession: async () => null }));
vi.mock("@/app/admin/actions", () => ({ assignJudge: async () => ({ ok: true, added: 1 }) }));
vi.mock("@/lib/admin/api", () => ({
  loadJudgesList: async () => ({ ok: true, data: h.judges }),
  loadScoringOverview: async () => ({ ok: true, data: { competitions: [
    { slug: "kathai-sollum-kutties", nameTa: "கதை சொல்லும் குட்டீஸ்", nameEn: "Little Storytellers", submitted: 3, ranked: 0, waiting: 0, notAssigned: 2, ties: 0, heldForReview: 0 },
    { slug: "kutti-pesalar", nameTa: "குட்டிப் பேச்சாளர்", nameEn: "Little Speaker", submitted: 0, ranked: 0, waiting: 0, notAssigned: 0, ties: 0, heldForReview: 0 },
  ] } }),
  loadRanking: async (slug: string) => ({ ok: true, data: { entries: slug === "kathai-sollum-kutties" ? [{ judges: [{ judgeName: "Anu", judgeCode: "JDG-AB12C" }] }, { judges: [] }] : [] } }),
}));

describe("Assign Judges", () => {
  it("the sidebar opens /admin/assign from any page", () => {
    const html = renderToStaticMarkup(createElement(AdminNav));
    const href = /<a [^>]*href="([^"]*)"[^>]*>(?:(?!<\/a>).)*?Assign Judges/s.exec(html)?.[1];
    expect(href).toBe("/admin/assign");
  });

  it("lists every competition with its counts, the judges already on it, and a form only where there is something to assign", async () => {
    const { default: Page } = await import("@/app/admin/assign/page");
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("3 submitted · 2 without a judge");
    expect(html).toContain("Judges on it: Anu");
    expect(html).toContain('id="judge-kathai-sollum-kutties"'); // one select per competition, each with its own id
    expect(html).not.toContain('id="judge-kutti-pesalar"');
    expect(html).toContain("No submitted entries yet");
    expect(html).toContain("Anu (JDG-AB12C)");
    expect(html).not.toContain("Old (JDG-ZZ99Z)"); // inactive judges are not offered
    if (process.env.RIO_WRITE_PREVIEW) (await import("node:fs")).writeFileSync(`${process.env.RIO_WRITE_PREVIEW}/assign.html`, html);
  });
});
