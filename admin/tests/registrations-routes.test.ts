import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ role: "super_admin" as string, path: "/admin/registrations", calls: [] as string[] }));
const base = (code: string) => ({ entryCode: code, status: "draft", competitionSlug: "a", competitionNameTa: "த", competitionNameEn: "Alpha", questionSetVersion: 1, childName: `Child${code}`, childAge: 4, guardianName: "G", answered: 0, openDuplicateFlag: false, hasVideo: false, createdAt: "2026-11-10T10:00:00Z", updatedAt: "2026-11-10T10:00:00Z" });
vi.mock("next/link", async () => { const { createElement: el } = await import("react"); return { default: ({ href, children, ...r }: { href: string; children?: unknown }) => el("a", { href, ...r }, children as never) }; });
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("notFound"); },
  redirect: (to: string) => { throw new Error(`redirect:${to}`); },
  usePathname: () => h.path,
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));
vi.mock("@/lib/staff/auth", () => ({ requireStaff: async (need: string) => { if (need === "super_admin" && h.role !== "super_admin") throw new Error("notFound"); return { role: h.role }; } }));
vi.mock("@/lib/admin/api", () => ({
  loadCompetitions: async () => ({ ok: true, data: [] }),
  loadRegistrations: async (f: unknown) => { h.calls.push(`active ${JSON.stringify(f)}`); return { ok: true, data: { registrations: [base("ACTIVE001"), base("ACTIVE002")], total: 2, page: 1, pageSize: 25 } }; },
  loadDeletedRegistrations: async (f: unknown) => { h.calls.push(`deleted ${JSON.stringify(f)}`); return { ok: true, data: { registrations: [{ ...base("GONE0001"), deletedAt: "2026-11-11T10:00:00Z", deletedBy: "Boss" }], total: 1, page: 1, pageSize: 25 } }; },
}));
vi.mock("@/app/admin/registrations/actions", () => ({ deleteRegistration: async () => ({ ok: true }), loadRegistrationForEdit: async () => ({ ok: false }), updateRegistration: async () => ({ ok: false }), restoreRegistration: async () => ({ ok: true }) }));

const active = async (sp: object = {}) => { const { default: P } = await import("@/app/admin/registrations/page"); return renderToStaticMarkup(createElement("div", null, await P({ searchParams: Promise.resolve(sp) }))); };
const deleted = async (sp: object = {}) => { const { default: P } = await import("@/app/admin/registrations/deleted/page"); return renderToStaticMarkup(createElement("div", null, await P({ searchParams: Promise.resolve(sp) }))); };

beforeEach(() => { h.role = "super_admin"; h.path = "/admin/registrations"; h.calls = []; });

describe("active and deleted registrations are separate pages", () => {
  it("Active shows only active rows, no restore, Active tab current, and never calls the deleted API", async () => {
    const html = await active({ q: "abc", sort: "oldest" });
    expect(html).toContain("ACTIVE001"); expect(html).toContain("ACTIVE002");
    expect(html).not.toContain("GONE0001"); expect(html).not.toContain("Restore");
    expect(html).toMatch(/href="\/admin\/registrations"[^>]*aria-current="page"/);
    expect(html).toContain('href="/admin/registrations/deleted"');
    expect(h.calls.every((c) => c.startsWith("active"))).toBe(true);
  });
  it("Deleted shows only deleted rows with Restore, Deleted tab current, no active row actions, and its own query state", async () => {
    h.path = "/admin/registrations/deleted";
    const html = await deleted({ q: "zz", page: "1", sort: "oldest", status: "draft" });
    expect(html).toContain("GONE0001"); expect(html).toContain("Restore"); expect(html).toContain("Boss");
    expect(html).not.toContain("ACTIVE001"); expect(html).not.toContain("Edit registration"); expect(html).not.toContain("Delete registration");
    expect(html).toMatch(/href="\/admin\/registrations\/deleted"[^>]*aria-current="page"/);
    expect(html).not.toMatch(/href="\/admin\/registrations"[^>]*aria-current/);
    expect(h.calls).toEqual(['deleted {"q":"zz","page":1}']); // sort/status of the other page are not carried over
  });
  it("a plain Admin gets a 404 on Deleted, and no Deleted tab on Active", async () => {
    h.role = "admin";
    await expect(deleted()).rejects.toThrow("notFound"); // the check and the data request run together, but nothing is rendered without the check
    const html = await active();
    expect(html).toContain("ACTIVE001"); expect(html).not.toContain("Deleted registrations");
  });
  it("the old ?tab=deleted address redirects to the new route", async () => {
    await expect(active({ tab: "deleted" })).rejects.toThrow("redirect:/admin/registrations/deleted");
  });
});
