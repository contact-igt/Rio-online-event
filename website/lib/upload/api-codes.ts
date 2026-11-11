import type { UploadErrorCode } from "./rules";

/** The API's answer as a code for the screen. Anything unexpected is "unavailable" (the server log has the detail). */
export function codeFrom(reply: { status: number; code?: string; fields?: { field: string; problem: string }[] }): UploadErrorCode {
  const problem = reply.fields?.[0]?.problem;
  if (reply.status === 422) {
    if (problem === "too_big") return "tooBig";
    if (problem === "too_small") return "tooSmall";
    if (problem === "unsupported_type") return "type";
    if (problem === "mismatch") return "mismatch";
    return "invalid";
  }
  switch (reply.code) {
    case "video_already_uploaded": return "already";
    case "registration_closed": return "closed";
    case "not_editable": return "locked";
    case "upload_not_current":
    case "upload_not_found": return "notCurrent";
    case "upload_expired": return "expired";
    case "upload_missing": return "missing";
    case "no_registration": return "notFound";
  }
  if (reply.status === 429) return "tooMany";
  return "unavailable";
}
