import { writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The administrator's Results pages, rendered for real with the API answer stubbed: winners chosen by hand from the ranking, the publication
// time stated plainly, and no way to change anything once results are public.

const cand = (entryCode: string, childName: string, rank: number | null, average: number | null, tie = false) => ({
  entryCode, childName, childAge: 6, hasVideo: true, assigned: 2, finalScores: 2, drafts: 0, complete: rank !== null, average, rank, tie, judges: [],
});
const h = vi.hoisted(() => ({ frozen: false, publishAt: null as string | null }));
const data = () => ({
  competition: { slug: "kathai-sollum-kutties", nameTa: "கதை சொல்லும் குட்டீஸ்", nameEn: "Little Storytellers" },
  publishAt: h.publishAt,
  frozen: h.frozen,
  winners: [{ place: 1, entryCode: "RIOSCOREC3", childName: "Chitra Devi", displayName: "Chitra", awardLabel: "குட்டிக் கதைச் செல்வன் / செல்வி", average: 9.5, rank: 1, approvedAt: "2026-11-12T10:00:00.000Z" }],
  candidates: [cand("RIOSCOREC3", "Chitra Devi", 1, 9.5), cand("RIOSCOREA1", "Asha", 2, 8.5, true), cand("RIOSCOREB2", "Bala", 2, 8.5, true)],
});

vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => el("a", { href, ...rest }, children as never) };
});
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); }, redirect: () => { throw new Error("redirect"); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/staff/auth", () => ({ requireStaff: async () => ({ role: "admin" }), staffSession: async () => null }));
vi.mock("@/lib/admin/api", () => ({
  loadResultsOverview: async () => ({ ok: true, data: { publishAt: h.publishAt, frozen: h.frozen, competitions: [{ slug: "kathai-sollum-kutties", nameTa: "கதை சொல்லும் குட்டீஸ்", nameEn: "Little Storytellers", winners: 1, finalized: 3 }] } }),
  loadWinners: async () => ({ ok: true, data: data() }),
}));

const page = async (sp: Record<string, string> = {}) => {
  const { default: Page } = await import("@/app/admin/results/[slug]/page");
  return renderToStaticMarkup(createElement("div", null, await Page({ params: Promise.resolve({ slug: "kathai-sollum-kutties" }), searchParams: Promise.resolve(sp) })));
};

beforeEach(() => {
  h.frozen = false;
  h.publishAt = null;
});

describe("admin Results pages", () => {
  it("the overview links each competition and says that nothing is public without a publication time", async () => {
    const { default: Page } = await import("@/app/admin/results/page");
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('href="/admin/results/kathai-sollum-kutties"');
    expect(html).toContain("No publication time is set, so nothing will be shown publicly");
    if (process.env.RIO_WRITE_PREVIEW) writeFileSync(`${process.env.RIO_WRITE_PREVIEW}/results.html`, html);
  });

  it("before publication: the chosen winner can be removed, the form offers the remaining entries in ranking order and free places", async () => {
    h.publishAt = "2026-11-14T04:30:00.000Z";
    const html = await page({ notice: "approved" });
    expect(html).toContain("Public name: Chitra");
    expect(html).toContain("Remove…");
    expect(html).toContain("Winner saved. Not public until the publication time.");
    expect(html).toContain("Results go public on");
    // the winner is not offered again; the others are, in ranking order, ties marked
    expect(html).not.toMatch(/<option value="RIOSCOREC3"/);
    expect(html.indexOf('value="RIOSCOREA1"')).toBeLessThan(html.indexOf('value="RIOSCOREB2"'));
    expect(html.match(/· tie/g)).toHaveLength(2);
    expect(html).not.toMatch(/<option value="1">1<\/option>/); // place 1 is taken
    expect(html).toContain("குட்டிக் கலைச்சுடர் விருது"); // award suggestions in Tamil
    if (process.env.RIO_WRITE_PREVIEW) writeFileSync(`${process.env.RIO_WRITE_PREVIEW}/winners.html`, html);
  });

  it("after publication: winners are shown and nothing can be changed", async () => {
    h.frozen = true;
    h.publishAt = "2026-11-14T04:30:00.000Z";
    const html = await page();
    expect(html).toContain("Winners can no longer change");
    expect(html).not.toContain("Remove…");
    expect(html).not.toContain("Add a winner");
  });

  it("an error code from the API is shown as a plain message, never the code", async () => {
    const html = await page({ error: "place_taken" });
    expect(html).toContain("That place already has a winner. Remove it first.");
    expect(await page({ error: "made_up_code" })).toContain("That could not be done. Nothing was changed.");
  });
});
