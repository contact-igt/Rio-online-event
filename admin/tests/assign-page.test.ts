import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminNav } from "@/components/admin/admin-nav";

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
  loadCompetitions: async () => ({ ok: true, data: [
    { slug: "kathai-sollum-kutties", nameTa: "கதை சொல்லும் குட்டீஸ்", nameEn: "Little Storytellers", published: null, draft: null },
    { slug: "kutti-pesalar", nameTa: "குட்டிப் பேசாளர்", nameEn: "Little Speaker", published: null, draft: null },
  ] }),
}));

describe("Assign Judges", () => {
  it("the sidebar opens /admin/assign-judges from any page", () => {
    const html = renderToStaticMarkup(createElement(AdminNav));
    const href = /<a [^>]*href="([^"]*)"[^>]*>(?:(?!<\/a>).)*?Assign Judges/s.exec(html)?.[1];
    expect(href).toBe("/admin/assign-judges");
  });

  it("lists every competition in the supported assignment workspace", async () => {
    const { default: Page } = await import("@/app/admin/assign/page");
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("Total competitions");
    expect(html).toContain("Active judges");
    expect(html).toContain("Assignment workspace");
    expect(html).toContain('id="judge-kathai-sollum-kutties"');
    expect(html).toContain('id="judge-kutti-pesalar"');
    expect(html).toContain("Anu (JDG-AB12C)");
    expect(html).not.toContain("Old (JDG-ZZ99Z)");
  });
});
