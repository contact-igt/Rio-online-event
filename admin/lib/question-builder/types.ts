// Shapes returned by the Express question-builder API, the editable form model, and the messages for its error codes.
// Pure data and functions: client components import this file, so it must not import any server-only module.

export type QuestionType = "short_text" | "paragraph" | "dropdown" | "radio" | "checkboxes" | "number" | "instruction";
export const QUESTION_TYPES: readonly QuestionType[] = ["short_text", "paragraph", "dropdown", "radio", "checkboxes", "number", "instruction"];
export const hasOptions = (t: QuestionType): boolean => t === "dropdown" || t === "radio" || t === "checkboxes";

export type Option = { code: string; ta: string; en: string };
export type Question = {
  id: number;
  key: string;
  type: QuestionType;
  position: number;
  active: boolean;
  promptTa: string;
  promptEn: string;
  helpTa: string | null;
  helpEn: string | null;
  required: boolean;
  options: Option[] | null;
  maxLength: number | null;
  minNumber: number | null;
  maxNumber: number | null;
  minChoices: number | null;
  maxChoices: number | null;
};
export type SetStatus = "draft" | "published" | "retired";
export type SetSummary = { id: number; version: number; status: SetStatus; createdAt: string; publishedAt: string | null; retiredAt: string | null; questionCount: number; entryCount: number };
export type Competition = { slug: string; nameTa: string; nameEn: string };
export type SetList = { competition: Competition; sets: SetSummary[] };
export type SetDetail = { competition: Competition; set: SetSummary; questions: Question[] };
export type PreviewQuestion = Omit<Question, "id" | "active">;
export type Preview = { competition: Competition; set: SetSummary; questions: PreviewQuestion[]; inactiveCount: number; problems: { key: string; code: string }[] };

/** The type labels, Tamil first. Tamil is provisional until the native-speaker review (brief D13). */
export const TYPE_LABEL: Record<QuestionType, { en: string; ta: string }> = {
  short_text: { en: "Short text", ta: "சிறு உரை" },
  paragraph: { en: "Paragraph", ta: "பத்தி" },
  dropdown: { en: "Dropdown", ta: "கீழிறங்கு பட்டியல்" },
  radio: { en: "Radio buttons", ta: "ஒரு தேர்வு" },
  checkboxes: { en: "Checkboxes", ta: "பல தேர்வுகள்" },
  number: { en: "Number", ta: "எண்" },
  instruction: { en: "Instruction / information", ta: "அறிவுரை / தகவல்" },
};

/** The form's text-only model: every input is a string until it is sent. */
export type OptionDraft = { code?: string; ta: string; en: string };
export type FormModel = {
  type: QuestionType;
  promptTa: string;
  promptEn: string;
  helpTa: string;
  helpEn: string;
  required: boolean;
  active: boolean;
  options: OptionDraft[];
  maxLength: string;
  minNumber: string;
  maxNumber: string;
  minChoices: string;
  maxChoices: string;
};

export const blankForm = (type: QuestionType): FormModel => ({
  type, promptTa: "", promptEn: "", helpTa: "", helpEn: "", required: false, active: true,
  options: hasOptions(type) ? [{ ta: "", en: "" }, { ta: "", en: "" }] : [], maxLength: "", minNumber: "", maxNumber: "", minChoices: "", maxChoices: "",
});

export const formOf = (q: Question): FormModel => ({
  type: q.type, promptTa: q.promptTa, promptEn: q.promptEn, helpTa: q.helpTa ?? "", helpEn: q.helpEn ?? "", required: q.required, active: q.active,
  options: (q.options ?? []).map((o) => ({ code: o.code, ta: o.ta, en: o.en })),
  maxLength: q.maxLength === null ? "" : String(q.maxLength), minNumber: q.minNumber === null ? "" : String(q.minNumber), maxNumber: q.maxNumber === null ? "" : String(q.maxNumber),
  minChoices: q.minChoices === null ? "" : String(q.minChoices), maxChoices: q.maxChoices === null ? "" : String(q.maxChoices),
});

/** "" is no value; anything that is not a finite number is reported by the field name so the API is never sent a guess. */
function numberOf(text: string): number | null | "invalid" {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : "invalid";
}

/** The API body for a form, or the fields that are not numbers. Everything else is validated by the API, the only authority. */
export function bodyOf(f: FormModel): { ok: true; body: Record<string, unknown> } | { ok: false; fields: Record<string, string> } {
  const bad: Record<string, string> = {};
  const num = (name: keyof FormModel, text: string) => {
    const n = numberOf(text);
    if (n === "invalid") {
      bad[name] = "not_a_number";
      return null;
    }
    return n;
  };
  const body: Record<string, unknown> = { type: f.type, promptTa: f.promptTa, promptEn: f.promptEn, helpTa: f.helpTa.trim() === "" ? null : f.helpTa, helpEn: f.helpEn.trim() === "" ? null : f.helpEn, active: f.active };
  if (f.type !== "instruction") body.required = f.required;
  if (f.type === "short_text" || f.type === "paragraph") body.maxLength = num("maxLength", f.maxLength);
  if (hasOptions(f.type)) body.options = f.options.map((o) => (o.code ? { code: o.code, ta: o.ta, en: o.en } : { ta: o.ta, en: o.en }));
  if (f.type === "checkboxes") {
    body.minChoices = num("minChoices", f.minChoices);
    body.maxChoices = num("maxChoices", f.maxChoices);
  }
  if (f.type === "number") {
    body.minNumber = num("minNumber", f.minNumber);
    body.maxNumber = num("maxNumber", f.maxNumber);
  }
  return Object.keys(bad).length > 0 ? { ok: false, fields: bad } : { ok: true, body };
}

/** Moves an item one place; returns the same array when it cannot move. */
export function moved<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

export const fieldMessage = (code: string): { en: string; ta: string } =>
  FIELD_MESSAGES[code] ?? { en: "This value is not accepted.", ta: "இந்த மதிப்பு ஏற்கப்படவில்லை." };

const FIELD_MESSAGES: Record<string, { en: string; ta: string }> = {
  required: { en: "This is required.", ta: "இது அவசியம்." },
  too_long: { en: "This is too long.", ta: "இது மிக நீளமாக உள்ளது." },
  unsafe_text: { en: "Remove the angle brackets (< and >).", ta: "கோண அடைப்புகளை (< >) நீக்குங்கள்." },
  invalid_text: { en: "Remove the control characters.", ta: "கட்டுப்பாட்டு எழுத்துகளை நீக்குங்கள்." },
  min_two_options: { en: "Add at least two options.", ta: "குறைந்தது இரண்டு விருப்பங்களைச் சேருங்கள்." },
  too_many_options: { en: "Use at most 30 options.", ta: "அதிகபட்சம் 30 விருப்பங்கள்." },
  duplicate_option: { en: "Two options are the same.", ta: "இரண்டு விருப்பங்கள் ஒன்றே." },
  duplicate_code: { en: "Two options share a code.", ta: "இரண்டு விருப்பங்களுக்கு ஒரே குறியீடு." },
  max_below_min: { en: "The maximum must not be below the minimum.", ta: "அதிகபட்சம் குறைந்தபட்சத்துக்குக் கீழே இருக்கக் கூடாது." },
  min_above_options: { en: "The minimum is more than the number of options.", ta: "குறைந்தபட்சம் விருப்பங்களை விட அதிகம்." },
  max_above_options: { en: "The maximum is more than the number of options.", ta: "அதிகபட்சம் விருப்பங்களை விட அதிகம்." },
  required_needs_one: { en: "A required question needs a minimum of at least 1.", ta: "அவசியமான கேள்விக்கு குறைந்தபட்சம் 1 வேண்டும்." },
  not_a_number: { en: "Enter a number.", ta: "எண்ணை உள்ளிடுங்கள்." },
  type_cannot_change: { en: "The type cannot be changed. Delete the question and add a new one.", ta: "வகையை மாற்ற முடியாது." },
  too_many_questions: { en: "A competition can have at most 60 questions.", ta: "ஒரு போட்டிக்கு அதிகபட்சம் 60 கேள்விகள்." },
};

export const PROBLEM_MESSAGE: Record<string, { en: string; ta: string }> = {
  no_active_questions: { en: "Add at least one active question before publishing.", ta: "வெளியிடும் முன் குறைந்தது ஒரு செயலில் உள்ள கேள்வியைச் சேருங்கள்." },
  only_instructions: { en: "Add at least one question that a parent can answer, not only instructions.", ta: "பெற்றோர் பதிலளிக்கக்கூடிய ஒரு கேள்வியாவது வேண்டும்." },
  min_two_options: { en: "A choice question needs at least two options.", ta: "தேர்வுக் கேள்விக்கு குறைந்தது இரண்டு விருப்பங்கள் வேண்டும்." },
};

export const NOTICE: Record<string, { en: string; ta: string }> = {
  created: { en: "Draft created.", ta: "வரைவு உருவாக்கப்பட்டது." },
  discarded: { en: "Draft discarded.", ta: "வரைவு நீக்கப்பட்டது." },
  saved: { en: "Question saved.", ta: "கேள்வி சேமிக்கப்பட்டது." },
  deleted: { en: "Question deleted.", ta: "கேள்வி நீக்கப்பட்டது." },
  moved: { en: "Order changed.", ta: "வரிசை மாற்றப்பட்டது." },
  published: { en: "Published to all competitions. Registration is still closed.", ta: "எல்லாப் போட்டிகளுக்கும் வெளியிடப்பட்டது. பதிவு இன்னும் மூடியே உள்ளது." },
};

/** The one Questions page: every competition shares the same list. */
export const QUESTIONS_PATH = "/admin/questions";
export const ERROR: Record<string, { en: string; ta: string }> = {
  unavailable: { en: "The server is not reachable. Nothing was changed.", ta: "சேவையகத்தை அணுக முடியவில்லை. எதுவும் மாற்றப்படவில்லை." },
  forbidden: { en: "Your session cannot do this. Sign in again.", ta: "உங்கள் அமர்வால் இதைச் செய்ய முடியாது. மீண்டும் உள்நுழையுங்கள்." },
  not_a_draft: { en: "Only a draft can be changed. Create a draft revision first.", ta: "வரைவை மட்டுமே மாற்ற முடியும்." },
  draft_exists: { en: "A draft already exists.", ta: "ஏற்கெனவே ஒரு வரைவு உள்ளது." },
  not_publishable: { en: "The draft cannot be published yet. See the list of problems.", ta: "வரைவை இன்னும் வெளியிட முடியாது." },
  rule_violation: { en: "The change is not allowed by the question rules.", ta: "மாற்றம் விதிகளுக்கு உட்பட்டதல்ல." },
  invalid_order: { en: "The order could not be changed. Reload and try again.", ta: "வரிசையை மாற்ற முடியவில்லை. மீண்டும் ஏற்றவும்." },
  too_many_questions: { en: "A competition can have at most 60 questions.", ta: "ஒரு போட்டிக்கு அதிகபட்சம் 60 கேள்விகள்." },
  other: { en: "That could not be done. Nothing was changed.", ta: "அதைச் செய்ய முடியவில்லை. எதுவும் மாற்றப்படவில்லை." },
};
