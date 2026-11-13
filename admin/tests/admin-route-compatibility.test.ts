import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => el("a", { href, ...rest }, children as never) };
});
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));
vi.mock("@/lib/staff/auth", () => ({ requireStaff: async () => ({ role: "admin" }) }));
vi.mock("@/lib/admin/api", () => ({
  loadCompetitions: async () => ({ ok: true, data: [{ slug: "alpha", nameTa: "அல்பா", nameEn: "Alpha", published: null, draft: null }] }),
  loadJudgesList: async () => ({ ok: true, data: [] }),
}));

describe("admin route compatibility", () => {
  it("keeps the legacy assign route on the supported assignment workspace", async () => {
    const { default: Page } = await import("@/app/admin/assign/page");
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("Assign Judges");
    expect(html).toContain("Judge assignment");
  });

  it("does not claim scoring detail data before the server capability exists", async () => {
    const { default: Page } = await import("@/app/admin/scoring/[slug]/page");
    const html = renderToStaticMarkup(createElement("div", null, await Page({ params: Promise.resolve({ slug: "alpha" }) })));
    expect(html).toContain("Scoring management is not available yet.");
    expect(html).toContain("Nothing is shown here until the required server capability is available.");
  });

  it("does not claim results detail data before the server capability exists", async () => {
    const { default: Page } = await import("@/app/admin/results/[slug]/page");
    const html = renderToStaticMarkup(createElement("div", null, await Page({ params: Promise.resolve({ slug: "alpha" }) })));
    expect(html).toContain("Results management is not available yet.");
    expect(html).toContain("Nothing is shown here until the required server capability is available.");
  });

  it("does not render answer data that the judge API deliberately omits", () => {
    const page = readFileSync(join(process.cwd(), "app/judge/entries/[id]/page.tsx"), "utf8");
    expect(page).not.toContain("entry.answers");
  });
});
