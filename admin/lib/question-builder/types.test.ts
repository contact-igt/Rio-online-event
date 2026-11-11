import { describe, expect, it } from "vitest";
import { blankForm, bodyOf, formOf, moved, type Question } from "./types";

describe("question form model", () => {
  it("builds the API body for each type, sending nulls for empty optional fields", () => {
    const short = { ...blankForm("short_text"), promptTa: "பெயர்", promptEn: "Name", maxLength: "40" };
    expect(bodyOf(short)).toEqual({ ok: true, body: { type: "short_text", promptTa: "பெயர்", promptEn: "Name", helpTa: null, helpEn: null, active: true, required: false, maxLength: 40 } });
    const box = { ...blankForm("checkboxes"), promptTa: "அ", promptEn: "A", minChoices: "1", maxChoices: "", options: [{ ta: "ஒன்று", en: "One" }, { code: "o2", ta: "இரண்டு", en: "Two" }] };
    expect(bodyOf(box)).toMatchObject({ ok: true, body: { minChoices: 1, maxChoices: null, options: [{ ta: "ஒன்று", en: "One" }, { code: "o2", ta: "இரண்டு", en: "Two" }] } });
    const info = { ...blankForm("instruction"), promptTa: "தகவல்", promptEn: "Info", required: true };
    expect((bodyOf(info) as { body: Record<string, unknown> }).body).not.toHaveProperty("required"); // an instruction is never required
  });
  it("reports numbers that are not numbers by field instead of sending them", () => {
    expect(bodyOf({ ...blankForm("number"), minNumber: "abc", maxNumber: "5" })).toEqual({ ok: false, fields: { minNumber: "not_a_number" } });
    expect(bodyOf({ ...blankForm("number"), minNumber: "Infinity" })).toEqual({ ok: false, fields: { minNumber: "not_a_number" } });
  });
  it("round-trips a stored question through the form", () => {
    const q: Question = { id: 1, key: "q1", type: "radio", position: 1, active: false, promptTa: "அ", promptEn: "A", helpTa: null, helpEn: "h", required: true, options: [{ code: "o1", ta: "x", en: "X" }, { code: "o2", ta: "y", en: "Y" }], maxLength: null, minNumber: null, maxNumber: null, minChoices: null, maxChoices: null };
    const f = formOf(q);
    expect(f).toMatchObject({ helpTa: "", helpEn: "h", active: false, required: true });
    expect(bodyOf(f)).toMatchObject({ ok: true, body: { options: q.options, active: false, helpTa: null } });
  });
  it("moves an item one place and stops at the ends", () => {
    expect(moved([1, 2, 3], 1, -1)).toEqual([2, 1, 3]);
    expect(moved([1, 2, 3], 1, 1)).toEqual([1, 3, 2]);
    expect(moved([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moved([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });
});
