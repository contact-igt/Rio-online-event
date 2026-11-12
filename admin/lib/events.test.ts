import { describe, expect, it } from "vitest";
import { AGES, awards, events, fitsAge, getEvent, sharedAges, winnersLine } from "./events";

const TAMIL = /[஀-௿]/;

describe("competition data (poster fidelity)", () => {
  it("has events numbered 1 to 4 with unique slugs", () => {
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.number)).toEqual([1, 2, 3, 4]);
    expect(new Set(events.map((e) => e.slug)).size).toBe(4);
  });

  it("keeps the age bands printed on the poster", () => {
    expect(events.map((e) => [e.minAge, e.maxAge])).toEqual([
      [3, 5],
      [5, 8],
      [6, 12],
      [8, 12],
    ]);
  });

  it("keeps Tamil names and tasks in Tamil script", () => {
    for (const e of events) {
      expect(e.nameTa).toMatch(TAMIL);
      expect(e.taskTa).toMatch(TAMIL);
      expect(e.nameEn.length).toBeGreaterThan(0);
    }
  });

  it("slugs are URL-safe", () => {
    for (const e of events) expect(e.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("lists the five award categories in Tamil", () => {
    expect(awards).toHaveLength(5);
  });
});

describe("age rules", () => {
  it("covers ages 3 to 12 only", () => {
    expect(AGES[0]).toBe(3);
    expect(AGES.at(-1)).toBe(12);
    for (const age of AGES) expect(events.some((e) => fitsAge(e, age))).toBe(true);
    for (const age of [2, 13]) expect(events.some((e) => fitsAge(e, age))).toBe(false);
  });

  it("matches the overlaps parents will see", () => {
    const eligibleFor = (age: number) => events.filter((e) => fitsAge(e, age)).map((e) => e.number);
    expect(eligibleFor(3)).toEqual([1]);
    expect(eligibleFor(5)).toEqual([1, 2]);
    expect(eligibleFor(8)).toEqual([2, 3, 4]);
    expect(eligibleFor(12)).toEqual([3, 4]);
  });

  it("computes shared ages between events", () => {
    const [one, two, , four] = events;
    expect(sharedAges(one!, two!)).toEqual({ min: 5, max: 5 });
    expect(sharedAges(one!, four!)).toBeNull();
  });

  it("looks events up by slug", () => {
    expect(getEvent("kutti-pesalar")?.number).toBe(4);
    expect(getEvent("nope")).toBeUndefined();
  });
});

describe("announcement date", () => {
  it("is not hardcoded: until the client approves one, every line says it will be confirmed later", () => {
    const line = winnersLine();
    expect(line.en).toBe("The winners announcement date will be confirmed later.");
    expect(`${line.ta} ${line.en}`).not.toMatch(/\d/);
  });
});
