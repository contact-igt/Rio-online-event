import { writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The administrator's Scoring pages, rendered for real with the API answer stubbed: the overview links every competition to its ranking;
// the ranking lists ranked entries first (ties flagged in words), then entries waiting for judges, then unassigned ones; nothing is invented.

const summary = { submitted: 6, ranked: 3, waiting: 1, notAssigned: 1, ties: 2, heldForReview: 1 };
const judge = (judgeName: string, marks: number | null, status: "draft" | "final" | "none") => ({ judgeName, judgeCode: `JDG-${judgeName}`, marks, status });
const row = (entryCode: string, childName: string, rank: number | null, average: number | null, tie: boolean, complete: boolean, judges: ReturnType<typeof judge>[]) => ({
  entryCode, childName, childAge: 6, hasVideo: true, assigned: judges.length, finalScores: judges.filter((j) => j.status === "final").length,
  drafts: judges.filter((j) => j.status === "draft").length, complete, average, rank, tie, judges,
});
const ranking = {
  competition: { slug: "kathai-sollum-kutties", nameTa: "கதை சொல்லும் குட்டீஸ்", nameEn: "Little Storytellers" },
  summary,
  entries: [
    row("RIOSCOREC3", "Chitra", 1, 9.5, false, true, [judge("Anu", 10, "final"), judge("Ravi", 9, "final")]),
    row("RIOSCOREA1", "Asha", 2, 8.5, true, true, [judge("Anu", 9, "final"), judge("Ravi", 8, "final")]),
    row("RIOSCOREB2", "Bala", 2, 8.5, true, true, [judge("Anu", 8.5, "final"), judge("Ravi", 8.5, "final")]),
    row("RIOSCORED4", "Divya", null, 7, false, false, [judge("Anu", 7, "final"), judge("Ravi", 9.75, "draft")]),
    row("RIOSCOREF6", "Farah", null, null, false, false, []),
  ],
};

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => el("a", { href, ...rest }, children as never) };
});
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));
vi.mock("@/lib/staff/auth", () => ({ requireStaff: async () => ({ role: "admin" }) }));
vi.mock("@/lib/admin/api", () => ({
  loadScoringOverview: async () => ({ ok: true, data: { competitions: [{ slug: "kathai-sollum-kutties", nameTa: "கதை சொல்லும் குட்டீஸ்", nameEn: "Little Storytellers", ...summary }] } }),
  loadRanking: async () => ({ ok: true, data: ranking }),
}));

describe("admin Scoring pages", () => {
  it("the overview shows each competition's progress and links to its ranking", async () => {
    const { default: Page } = await import("@/app/admin/scoring/page");
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('href="/admin/scoring/kathai-sollum-kutties"');
    expect(html).toContain("1 waiting for judges · 1 not assigned · 1 held for review");
    if (process.env.RIO_WRITE_PREVIEW) writeFileSync(`${process.env.RIO_WRITE_PREVIEW}/scoring.html`, html);
  });

  it("the ranking lists ranked entries in order with ties flagged in words, then waiting, then unassigned", async () => {
    const { default: Page } = await import("@/app/admin/scoring/[slug]/page");
    const html = renderToStaticMarkup(createElement("div", null, await Page({ params: Promise.resolve({ slug: "kathai-sollum-kutties" }) })));
    const order = ["RIOSCOREC3", "RIOSCOREA1", "RIOSCOREB2", "RIOSCORED4", "RIOSCOREF6"].map((c) => html.indexOf(c));
    expect(order.every((at, i) => at > -1 && (i === 0 || at > order[i - 1]!))).toBe(true);
    expect(html.match(/Tie: decide by hand/g)).toHaveLength(2);
    expect(html).toContain("9.50");
    expect(html).toContain("Waiting for judges");
    expect(html).toContain("Not assigned");
    expect(html).toContain("(draft)");
    expect(html).toContain('href="/admin/registrations/RIOSCOREC3"');
    if (process.env.RIO_WRITE_PREVIEW) writeFileSync(`${process.env.RIO_WRITE_PREVIEW}/ranking.html`, html);
  });
});
