import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => el("a", { href, ...rest }, children as never) };
});
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); }, redirect: () => { throw new Error("redirect"); }, useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/staff/auth", () => ({ requireStaff: async () => ({ role: "admin" }) }));
vi.mock("@/lib/admin/api", () => ({
  loadCompetitions: async () => ({ ok: true, data: [{ slug: "alpha", nameTa: "அல்பா", nameEn: "Alpha", published: null, draft: null }] }),
  loadJudgesList: async () => ({ ok: true, data: [] }),
  loadScoringOverview: async () => ({ ok: true, data: { competitions: [] } }),
  loadRanking: async () => ({ ok: true, data: { competition: { slug: "alpha", nameTa: "அல்பா", nameEn: "Alpha" }, entries: [], summary: { submitted: 0, ranked: 0, waiting: 0, notAssigned: 0, ties: 0, heldForReview: 0 } } }),
  loadWinners: async () => ({ ok: true, data: { competition: { slug: "alpha", nameTa: "அல்பா", nameEn: "Alpha" }, publishAt: null, frozen: false, winners: [], candidates: [] } }),
}));

describe("admin route compatibility", () => {
  it("keeps the legacy assign route on the supported assignment workspace", async () => {
    const { default: Page } = await import("@/app/admin/assign/page");
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("Assign Judges");
    expect(html).toContain("Judge assignment");
  });

  it("the scoring detail route shows the competition's ranking from the API (an empty one says so)", async () => {
    const { default: Page } = await import("@/app/admin/scoring/[slug]/page");
    const html = renderToStaticMarkup(createElement("div", null, await Page({ params: Promise.resolve({ slug: "alpha" }) })));
    expect(html).toContain("அல்பா");
    expect(html).toContain("No submitted entries in this competition yet.");
  });

  it("the results detail route shows the winners form and says nothing is public without a publication time", async () => {
    const { default: Page } = await import("@/app/admin/results/[slug]/page");
    const html = renderToStaticMarkup(createElement("div", null, await Page({ params: Promise.resolve({ slug: "alpha" }), searchParams: Promise.resolve({}) })));
    expect(html).toContain("No winner chosen yet.");
    expect(html).toContain("No publication time is set, so nothing will be shown publicly.");
  });

  it("does not render answer data that the judge API deliberately omits", () => {
    const page = readFileSync(join(process.cwd(), "app/judge/entries/[id]/page.tsx"), "utf8");
    expect(page).not.toContain("entry.answers");
  });
});
