import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ role: "super_admin" as string, path: "/admin/judges", calls: [] as string[] }));
const active = (id: number, name: string) => ({ id, name, email: `${name.toLowerCase()}@x.org`, judgeCode: `JDG-ACT${id}`, active: true, mustChangePassword: false, assigned: 0, drafts: 0, final: 0, progress: null, lastLoginAt: null, createdAt: "2026-01-01T00:00:00Z" });
vi.mock("next/link", async () => { const { createElement: el } = await import("react"); return { default: ({ href, children, ...r }: { href: string; children?: unknown }) => el("a", { href, ...r }, children as never) }; });
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("notFound"); },
  usePathname: () => h.path,
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));
vi.mock("@/lib/staff/auth", () => ({ requireStaff: async (need: string) => { if (need === "super_admin" && h.role !== "super_admin") throw new Error("notFound"); return { role: h.role }; } }));
vi.mock("@/lib/admin/api", () => ({
  loadJudgesList: async () => { h.calls.push("active"); return { ok: true, data: [active(1, "Alice")] }; },
  loadDeletedJudges: async () => { h.calls.push("deleted"); return { ok: true, data: [{ id: 9, name: "Gone", email: "gone@x.org", judgeCode: "JDG-GONE9", deletedAt: "2026-11-11T10:00:00Z" }] }; },
}));
vi.mock("@/app/admin/judges/actions", () => ({
  provisionJudge: async () => ({ ok: false }), setJudgeActive: async () => ({ ok: true }), resetJudgePassword: async () => ({ ok: true }),
  updateJudge: async () => ({ ok: true }), deleteJudge: async () => ({ ok: true }), restoreJudge: async () => ({ ok: true }), purgeJudge: async () => ({ ok: true }),
}));

const activePage = async () => { const { default: P } = await import("@/app/admin/judges/page"); return renderToStaticMarkup(createElement("div", null, await P())); };
const deletedPage = async () => { const { default: P } = await import("@/app/admin/judges/deleted/page"); return renderToStaticMarkup(createElement("div", null, await P())); };

beforeEach(() => { h.role = "super_admin"; h.path = "/admin/judges"; h.calls = []; });

describe("active and deleted judges are separate pages", () => {
  it("Active shows the roster only, with both tabs for a Super Admin and Active highlighted", async () => {
    const html = await activePage();
    expect(html).toContain("Alice"); expect(html).not.toContain("Gone"); expect(html).not.toContain("Delete permanently");
    expect(html).toMatch(/href="\/admin\/judges"[^>]*aria-current="page"/);
    expect(html).toContain('href="/admin/judges/deleted"');
    expect(h.calls).toEqual(["active"]);
  });
  it("Deleted shows only deleted judges with Restore and Delete permanently, and Deleted highlighted", async () => {
    h.path = "/admin/judges/deleted";
    const html = await deletedPage();
    expect(html).toContain("Gone"); expect(html).toContain("JDG-GONE9"); expect(html).toContain("Restore"); expect(html).toContain("Delete permanently");
    expect(html).not.toContain("Alice");
    expect(html).toMatch(/href="\/admin\/judges\/deleted"[^>]*aria-current="page"/);
    expect(html).not.toContain("Add judge");
    expect(h.calls).toEqual(["deleted"]);
  });
  it("a plain Admin gets a 404 on Deleted and sees no tabs on Active", async () => {
    h.role = "admin";
    await expect(deletedPage()).rejects.toThrow("notFound");
    const html = await activePage();
    expect(html).toContain("Alice"); expect(html).not.toContain("Deleted judges"); expect(html).not.toContain("Active judges");
  });
});
