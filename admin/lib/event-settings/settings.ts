// Pure helpers for the Event Settings screen. The API stores instants in UTC; the administrator types and reads Asia/Kolkata wall-clock time,
// which has no daylight saving, so the offset is the constant +05:30.

const IST_OFFSET_MS = 330 * 60_000;
const INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export type SettingsFields = { opensAt: string; closesAt: string; resultsPublishAt: string; guardianConsentVersion: string };
export type ApiSettings = {
  timezone: string;
  registrationOpen: boolean;
  opensAt: string | null;
  closesAt: string | null;
  resultsPublishAt: string | null;
  resultsPublished: boolean;
  guardianConsentVersion: string | null;
  mediaConsentVersion: string | null;
  updatedAt: string | null;
};

/** "2026-12-01T09:00" typed in IST becomes an ISO instant with an explicit offset, or null when empty, or "invalid". */
export function istInputToIso(value: string): string | null | "invalid" {
  const v = value.trim();
  if (v === "") return null;
  const m = INPUT.exec(v);
  if (!m) return "invalid";
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi));
  // Date.UTC rolls 31 February over to March; a round trip catches that.
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d || probe.getUTCHours() !== h) return "invalid";
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+05:30`;
}

/** An ISO instant shown as the value of a datetime-local input in IST ("" when unset). */
export function isoToIstInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** The current IST minute as a datetime-local value: the earliest opening time the API accepts, so today stays selectable. */
export const istMinuteNow = (now: Date): string => isoToIstInput(now.toISOString());

export const fieldsOf = (s: ApiSettings): SettingsFields => ({
  opensAt: isoToIstInput(s.opensAt),
  closesAt: isoToIstInput(s.closesAt),
  resultsPublishAt: isoToIstInput(s.resultsPublishAt),
  guardianConsentVersion: s.guardianConsentVersion ?? "",
});

export type FieldName = keyof SettingsFields;

/** Messages for the field codes the API returns. Tamil is provisional until the native-speaker review (brief D13). */
export const fieldMessages: Record<string, { en: string; ta: string }> = {
  window_needs_both: { en: "Set both the opening and the closing time, or clear both.", ta: "தொடக்கம், முடிவு இரண்டையும் அமையுங்கள் அல்லது இரண்டையும் நீக்குங்கள்." },
  close_before_open: { en: "The closing time must be after the opening time.", ta: "முடிவு நேரம் தொடக்க நேரத்துக்குப் பிறகு இருக்க வேண்டும்." },
  consent_version_required: { en: "A guardian consent version is required when a window is set.", ta: "நேர வரம்பு அமைக்கும்போது பெற்றோர் ஒப்புதல் பதிப்பு தேவை." },
  unsupported_consent_version: { en: "No owner-approved consent wording is deployed for this version, so registration cannot open.", ta: "இந்தப் பதிப்புக்கான உரிமையாளரின் ஒப்புதல் வாசகம் இன்னும் வெளியிடப்படவில்லை; பதிவைத் திறக்க முடியாது." },
  results_need_close: { en: "Set the closing time before scheduling results.", ta: "முடிவுகளைத் திட்டமிடும் முன் முடிவு நேரத்தை அமையுங்கள்." },
  results_before_close: { en: "Results cannot be published before registration closes.", ta: "பதிவு முடியும் முன் முடிவுகளை வெளியிட முடியாது." },
  results_before_approved_date: { en: "Results cannot be published before 14 November 2026 (IST).", ta: "முடிவுகளை 14 நவம்பர் 2026 (IST) க்கு முன் வெளியிட முடியாது." },
  results_in_past: { en: "The results time must be in the future.", ta: "முடிவுகள் நேரம் எதிர்காலத்தில் இருக்க வேண்டும்." },
  opens_in_past: { en: "The opening time cannot be in the past. Choose the current time or later (IST).", ta: "தொடக்க நேரம் கடந்த காலத்தில் இருக்கக் கூடாது. இப்போதைய நேரம் அல்லது அதற்குப் பிறகு தேர்ந்தெடுங்கள் (IST)." },
  invalid_date: { en: "Enter a valid date and time.", ta: "சரியான தேதி, நேரத்தை உள்ளிடுங்கள்." },
  invalid_consent_version: { en: "Use only letters, digits, dot, dash and underscore (up to 40 characters).", ta: "எழுத்துகள், இலக்கங்கள், புள்ளி, கோடு, அடிக்கோடு மட்டும் (40 வரை)." },
};

export type FormError = "forbidden" | "unavailable" | "published" | "invalid" | "signin";
