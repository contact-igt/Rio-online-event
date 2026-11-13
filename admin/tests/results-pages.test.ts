import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => el("a", { href, ...rest }, children as never) };
});
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));
vi.mock("@/lib/staff/auth", () => ({ requireStaff: async () => ({ role: "admin" }) }));
vi.mock("@/lib/admin/api", () => ({
  loadCompetitions: async () => ({ ok: true, data: [{ slug: "kathai-sollum-kutties", nameTa: "கதை சொல்லும் குட்டீஸ்", nameEn: "Little Storytellers", published: null, draft: null }] }),
}));

describe("admin Results pages", () => {
  it("shows the bilingual not-ready workspace when results management is unavailable", async () => {
    const { default: Page } = await import("@/app/admin/results/page");
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("Results management is not available yet.");
    expect(html).toContain("Nothing is shown here until the required server capability is available.");
  });

  it("keeps competition detail routes explicit about the unavailable capability", async () => {
    const { default: Page } = await import("@/app/admin/results/[slug]/page");
    const html = renderToStaticMarkup(createElement("div", null, await Page({ params: Promise.resolve({ slug: "kathai-sollum-kutties" }) })));
    expect(html).toContain("Results management is not available yet.");
  });
});
