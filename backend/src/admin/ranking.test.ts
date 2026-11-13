import { describe, expect, it } from "vitest";
import { rankEntries, type Assignment, type Score } from "./ranking.ts";

const assign = (sub: string, ...judges: string[]): Assignment[] => judges.map((judgeId) => ({ submissionId: sub, judgeId }));
const final = (sub: string, judgeId: string, marks: number): Score => ({ submissionId: sub, judgeId, marks, status: "final" });
const draft = (sub: string, judgeId: string, marks: number | null): Score => ({ submissionId: sub, judgeId, marks, status: "draft" });
const byId = (r: ReturnType<typeof rankEntries>, id: string) => r.find((x) => x.submissionId === id)!;

describe("rankEntries", () => {
  it("averages the final marks of the assigned judges and ranks the highest first", () => {
    const r = rankEntries(["a", "b", "c"], [...assign("a", "j1", "j2"), ...assign("b", "j1", "j2"), ...assign("c", "j1", "j2")], [
      final("a", "j1", 80), final("a", "j2", 90),
      final("b", "j1", 95), final("b", "j2", 85.5),
      final("c", "j1", 50), final("c", "j2", 51),
    ]);
    expect(r.map((x) => [x.submissionId, x.average, x.rank])).toEqual([["b", 90.25, 1], ["a", 85, 2], ["c", 50.5, 3]]);
    expect(r.every((x) => x.complete && !x.tie)).toBe(true);
  });

  it("is reproducible: the same scores in any order give the same result", () => {
    const subs = ["a", "b", "c", "d"];
    const assignments = subs.flatMap((s) => assign(s, "j1", "j2"));
    const scores = [final("a", "j1", 70), final("a", "j2", 71), final("b", "j1", 90), final("b", "j2", 80), final("c", "j1", 85), final("c", "j2", 85), final("d", "j1", 60), final("d", "j2", 61)];
    const one = rankEntries(subs, assignments, scores);
    const two = rankEntries([...subs].reverse(), [...assignments].reverse(), [...scores].reverse());
    expect(two).toEqual(one);
  });

  it("flags equal averages as a tie, shares the rank (1, 1, 3) and resolves nothing", () => {
    const r = rankEntries(["a", "b", "c"], [...assign("a", "j1"), ...assign("b", "j1"), ...assign("c", "j1")], [final("a", "j1", 88), final("b", "j1", 88), final("c", "j1", 70)]);
    expect(r.map((x) => [x.rank, x.tie])).toEqual([[1, true], [1, true], [3, false]]);
  });

  it("detects a tie from different marks that average the same (to two decimals)", () => {
    const r = rankEntries(["a", "b"], [...assign("a", "j1", "j2"), ...assign("b", "j1", "j2")], [final("a", "j1", 100), final("a", "j2", 80), final("b", "j1", 91.5), final("b", "j2", 88.5)]);
    expect(r.every((x) => x.tie && x.rank === 1)).toBe(true);
  });

  it("does not rank an entry until EVERY assigned judge has finalized, and a draft never counts", () => {
    const r = rankEntries(["a", "b"], [...assign("a", "j1", "j2"), ...assign("b", "j1", "j2")], [final("a", "j1", 99), draft("a", "j2", 100), final("b", "j1", 10), final("b", "j2", 12)]);
    expect(byId(r, "a")).toMatchObject({ complete: false, rank: null, finalScores: 1, drafts: 1, average: 99 });
    expect(byId(r, "b")).toMatchObject({ complete: true, rank: 1, average: 11 });
    expect(r[0]!.submissionId).toBe("b"); // unranked entries sort after ranked ones
  });

  it("ignores scores by judges who are not assigned to the entry", () => {
    const r = rankEntries(["a"], assign("a", "j1"), [final("a", "j1", 70), final("a", "stray", 100)]);
    expect(byId(r, "a")).toMatchObject({ average: 70, finalScores: 1, complete: true });
  });

  it("an entry with no assigned judge, or no scores, is unranked and has no average", () => {
    const r = rankEntries(["a", "b"], assign("b", "j1"), []);
    expect(byId(r, "a")).toMatchObject({ assigned: 0, complete: false, rank: null, average: null });
    expect(byId(r, "b")).toMatchObject({ assigned: 1, complete: false, rank: null, average: null });
  });

  it("does not suffer floating-point drift on awkward decimals", () => {
    const r = rankEntries(["a"], assign("a", "j1", "j2", "j3"), [final("a", "j1", 70.1), final("a", "j2", 70.2), final("a", "j3", 70.3)]);
    expect(byId(r, "a").average).toBe(70.2);
  });
});
