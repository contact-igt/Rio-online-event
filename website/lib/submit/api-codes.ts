// The API's answer to POST /registrations/current/submit as a key of reg.submit.errors. Anything unexpected is "unavailable" (the server log
// has the detail). A video refused at submission (wrong length or not a real video) has been removed by the API, so the parent can upload a
// correct one; the page then shows the upload step again.

export type SubmitErrorCode =
  | "notFound"
  | "closed"
  | "locked"
  | "noVideo"
  | "videoInvalid"
  | "videoDuration"
  | "consent"
  | "answers"
  | "tooMany"
  | "invalid"
  | "network"
  | "unavailable";

export function submitCodeFrom(reply: { status: number; code?: string; fields?: { field: string; problem: string }[] }): SubmitErrorCode {
  if (reply.status === 422) {
    const fields = reply.fields ?? [];
    const video = fields.find((f) => f.field === "video")?.problem;
    if (video === "too_short" || video === "too_long") return "videoDuration";
    if (video) return "videoInvalid";
    if (fields.some((f) => f.field === "guardianConsent")) return "consent";
    if (fields.some((f) => f.field.startsWith("answers."))) return "answers";
    return "invalid";
  }
  switch (reply.code) {
    case "video_required": return "noVideo";
    case "registration_closed": return "closed";
    case "not_editable": return "locked";
    case "no_registration": return "notFound";
  }
  if (reply.status === 429) return "tooMany";
  return "unavailable";
}
