import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const entry = (code: string, status: "draft" | "final" | null, marks: number | null, hasVideo = true) => ({
  entryCode: code, competitionSlug: "a", competitionNameTa: "மழலை மொழி", competitionNameEn: "Toddler Tamil", hasVideo,
  score: status ? { marks, comments: null, status, finalizedAt: null } : null,
});
const h = vi.hoisted(() => ({
  list: { ok: true, data: [] as unknown[] } as { ok: boolean; data?: unknown[]; reason?: string },
  detail: { ok: true, data: null as unknown } as { ok: boolean; data?: unknown; reason?: string },
  staff: { role: "judge", user: { displayName: "Dr. Meena" } } as null | { role: string; user: { displayName: string } },
}));
vi.mock("next/link", async () => { const { createElement: el } = await import("react"); return { default: ({ href, children, ...r }: { href: string; children?: unknown }) => el("a", { href, ...r }, children as never) }; });
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); }, useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("@/lib/staff/auth", () => ({ requireStaff: async () => ({ role: "judge" }), currentStaff: async () => h.staff }));
vi.mock("@/lib/judging/api", () => ({ loadJudgeEntries: async () => h.list, loadJudgeEntryDetail: async () => h.detail }));
vi.mock("@/app/judge/actions", () => ({ getPlaybackUrl: async () => ({ ok: false, code: "unavailable" }), saveMyScore: async () => ({ ok: false, code: "unavailable" }) }));
vi.mock("@/app/staff/login/actions", () => ({ staffSignOut: async () => undefined }));

const portal = async () => { const { default: P } = await import("@/app/judge/page"); return renderToStaticMarkup(createElement("div", null, await P())); };
const header = async () => { const { JudgeHeader } = await import("@/components/judge/judge-header"); return renderToStaticMarkup(createElement("div", null, await JudgeHeader())); };
const review = async () => { const { default: P } = await import("@/app/judge/entries/[id]/page"); return renderToStaticMarkup(createElement("div", null, await P({ params: Promise.resolve({ id: "ENTRYA01" }) }))); };

beforeEach(() => { h.staff = { role: "judge", user: { displayName: "Dr. Meena" } }; });

describe("judge portal", () => {
  it("counts come from the real rows and always add up: Assigned = Scored + Pending (drafts are pending)", async () => {
    h.list = { ok: true, data: [entry("ENTRYA01", "final", 9), entry("ENTRYA02", "draft", 6), entry("ENTRYA03", null, null)] };
    const html = await portal();
    const value = (label: string) => Number(new RegExp(`${label}</span>.*?tabular-nums[^>]*>(\\d+)<`, "s").exec(html)?.[1]);
    expect([value("Assigned entries"), value("Scored entries"), value("Pending entries")]).toEqual([3, 1, 2]);
    expect(html).toContain("1 draft saved");
    for (const code of ["ENTRYA01", "ENTRYA02", "ENTRYA03"]) expect(html).toContain(code);
    expect(html).toContain("Toddler Tamil"); // the API's competition name
    expect(html).toContain('href="/judge/entries/ENTRYA02"');
    expect(html).toContain("9 / 10");
    expect(html).not.toMatch(/\/admin|Registrations|Assign Judges|Event Settings/); // nothing from the Admin area
  });

  it("a judge with no assignments gets a real empty state, not a fake row and not an error", async () => {
    h.list = { ok: true, data: [] };
    const html = await portal();
    expect(html).toContain("No entries assigned yet.");
    expect(html).toContain("இன்னும் பதிவுகள் ஒதுக்கப்படவில்லை.");
    expect(html).toContain("assigns them to you");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Could not load");
  });

  it("a failed load shows an error with Try again and dashes, never zero entries", async () => {
    h.list = { ok: false, reason: "unavailable" };
    const html = await portal();
    expect(html).toContain("Could not load your assigned entries.");
    expect(html).toContain("Try again");
    expect(html).not.toContain("No entries assigned yet.");
    expect(html.match(/tabular-nums[^>]*>–</g)).toHaveLength(3);
  });

  it("the header shows the signed-in judge, a Sign out button and the logo, and nothing for anyone else", async () => {
    const html = await header();
    expect(html).toContain("Dr. Meena"); expect(html).toContain("Sign out"); expect(html).toContain("rio logo v2.png"); expect(html).toContain("Judge Portal");
    h.staff = { role: "admin", user: { displayName: "Boss" } };
    expect(await header()).not.toContain("Boss");
    h.staff = null;
    expect(await header()).not.toContain("Sign out");
  });

  it("the review page shows the entry, the video control only when a checked video exists and playback is on, and the 0 to 10 score card", async () => {
    h.detail = { ok: true, data: { entryCode: "ENTRYA01", competition: { slug: "a", nameTa: "மழலை மொழி", nameEn: "Toddler Tamil" }, hasVideo: false, answers: [], score: null } };
    const none = await review();
    expect(none).toContain("No video has been uploaded for this entry."); expect(none).not.toContain("Load video");
    expect(none).toContain("0 to 10"); expect(none).toContain("Save draft"); expect(none).toContain("Submit final score");

    vi.stubEnv("RIO_PLAYBACK_ENABLED", "yes");
    vi.stubEnv("R2_ACCOUNT_ID", "0123456789abcdef0123456789abcdef");
    vi.resetModules();
    h.detail = { ok: true, data: { entryCode: "ENTRYA01", competition: { slug: "a", nameTa: "மழலை மொழி", nameEn: "Toddler Tamil" }, hasVideo: true, answers: [], score: { marks: 9, comments: "Good", status: "final", finalizedAt: "2026-11-12T10:00:00Z" } } };
    const final = await review();
    expect(final).toContain("Load video"); expect(final).not.toMatch(/<video|r2\.cloudflarestorage|videos\//);
    expect(final).toContain("This score is final"); expect(final).not.toContain("Submit final score"); // a final score cannot be edited
    vi.unstubAllEnvs();
  });

  it("an entry that is not this judge's is a 404", async () => {
    h.detail = { ok: false, reason: "not_found" };
    await expect(review()).rejects.toThrow("notFound");
  });
});
