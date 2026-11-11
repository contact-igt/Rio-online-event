import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminNav } from "@/components/admin/admin-nav";
import { CompetitionLinks } from "@/components/admin/competition-links";
import type { Competition } from "@/lib/admin/api";

// Plain stand-ins: the test is about which href each link has, not about Next's router.
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown; className?: string }) => h("a", { href, ...rest }, children as never) };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/admin" }));

const competition = (slug: string, nameEn: string): Competition => ({ slug, nameTa: `${nameEn} (தமிழ்)`, nameEn, published: null, draft: null });

describe("Questions navigation", () => {
  it("the sidebar's Questions entry opens /admin/questions, not the dashboard", () => {
    const html = renderToStaticMarkup(createElement(AdminNav));
    const href = /<a [^>]*href="([^"]*)"[^>]*>(?:(?!<\/a>).)*?Questions/s.exec(html)?.[1];
    expect(href).toBe("/admin/questions");
    expect(html).not.toMatch(/href="\/admin#competitions"[^>]*>(?:(?!<\/a>).)*?Questions/s);
  });

  it("states that there are no competitions instead of redirecting", () => {
    const html = renderToStaticMarkup(createElement(CompetitionLinks, { competitions: [] }));
    expect(html).toContain("No competitions available yet.");
    expect(html).not.toContain("<a ");
  });

  it("lists every competition that shares the one question list, with the version its parents see, linking to the competition", () => {
    const published = { ...competition("kutti-pesalar", "Little Speakers"), published: { id: 7, version: 3, questionCount: 5 } };
    const html = renderToStaticMarkup(createElement(CompetitionLinks, { competitions: [published, competition("katturai", "Essay")] }));
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/admin/events/kutti-pesalar", "/admin/events/katturai"]);
    expect(html).toContain("Little Speakers");
    expect(html).toContain("Parents see v3 · 5 questions");
    expect(html).toContain("Not published yet");
    expect(html).not.toContain("No competitions available yet.");
  });
});
