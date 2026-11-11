import { publicSettings } from "./express";

export type PublicRegistration = "open" | "closed";

/** Public pages read the same Express settings as the registration page. Any outage is fail-closed. */
export async function loadPublicRegistration(): Promise<PublicRegistration> {
  try {
    return (await publicSettings())?.registrationOpen ? "open" : "closed";
  } catch {
    return "closed";
  }
}
