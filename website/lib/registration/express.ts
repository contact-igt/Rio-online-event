import "server-only";

import { cookies, headers as requestHeaders } from "next/headers";
import { classifyFetchError, logApiFault, resolveApiOrigin, resolveSiteOrigin } from "@/lib/api/origin";

export type PublicQuestion = {
  key: string;
  type: "short_text" | "paragraph" | "dropdown" | "radio" | "checkboxes" | "number" | "instruction";
  position: number;
  promptTa: string;
  promptEn: string;
  helpTa: string | null;
  helpEn: string | null;
  required: boolean;
  options: { code: string; ta: string; en: string }[] | null;
  maxLength: number | null;
  minNumber: number | null;
  maxNumber: number | null;
};

export type PublicEvent = {
  slug: string;
  nameTa: string;
  nameEn: string;
  minAge: number;
  maxAge: number;
  questionSet: { version: number; questions: PublicQuestion[] } | null;
};

export type PublicSettings = {
  registrationOpen: boolean;
  opensAt: string | null;
  closesAt: string | null;
  guardianConsentVersion: string | null;
  mediaConsentVersion: string | null;
  /** True when a parent with a draft could upload a video now (registration open, uploads switched on, bucket configured). */
  videoUploads?: boolean;
  serverTime: string;
};

export type RegistrationView = {
  reference: string;
  status: string;
  editable: boolean;
  event: { slug: string; nameTa: string; nameEn: string; minAge: number; maxAge: number };
  child: { name: string; age: number };
  guardian: { name: string; mobile: string; email: string | null };
  consent: { guardian: { version: string | null; at: string | null }; media: { granted: boolean | null; version: string | null; at: string | null } };
  questionSet: { version: number; questions: PublicQuestion[] };
  answers: Record<string, string | number | string[] | null>;
  missingRequired: string[];
  /** The entry's one checked video, if any. Never an object key or a URL. */
  video?: { uploaded: boolean; bytes: number | null; contentType: string | null; uploadedAt: string | null };
  createdAt: string | null;
  updatedAt: string | null;
  codeExpiresAt: string;
};

export type RegistrationReply<T> = {
  status: number;
  body: T | null;
  fields?: { field: string; problem: string }[];
  /** The API's own error code (lower-case words), when it sent one. */
  code?: string;
};

const REG_COOKIE_NAMES = new Set(["rio_reg", "__Host-rio_reg"]);
const PATHS = new Set(["/events", "/settings/public", "/registrations", "/registrations/recover", "/registrations/current", "/registrations/current/video-uploads", "/registrations/current/submit"]);
const COMPLETE = /^\/registrations\/current\/video-uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/complete$/;

export const isRegistrationPath = (path: string): boolean => PATHS.has(path) || COMPLETE.test(path);

export function registrationPath(path: string): string {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#") || path.includes("\\") || path.includes("..") || !isRegistrationPath(path)) {
    throw new Error("invalid_registration_path");
  }
  return `/api/v1${path}`;
}

function allowedCookieHeader(raw: string | null): string {
  return (raw ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => REG_COOKIE_NAMES.has(part.slice(0, part.indexOf("="))))
    .join("; ");
}

function setCookieHeaders(headers: Headers): string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  return getSetCookie ? getSetCookie.call(headers) : (headers.get("set-cookie") ? [headers.get("set-cookie")!] : []);
}

async function relayRecoveryCookies(headers: Headers): Promise<void> {
  const responseCookies = setCookieHeaders(headers);
  if (responseCookies.length === 0) return;
  const jar = await cookies();
  for (const header of responseCookies) {
      const first = header.split(";", 1)[0] ?? "";
      const eq = first.indexOf("=");
      if (eq <= 0 || !REG_COOKIE_NAMES.has(first.slice(0, eq))) continue;
      const name = first.slice(0, eq);
      const value = first.slice(eq + 1);
      const deleting = /(?:^|;)\s*Max-Age=0(?:;|$)/i.test(header);
      const secure = /;\s*Secure\s*(?:;|$)/i.test(header); // the API marks the cookie Secure in production; this site follows it
    jar.set({ name, value: deleting ? "" : value, httpOnly: true, sameSite: "strict", secure, path: "/", ...(deleting ? { maxAge: 0 } : {}) });
  }
}

export async function requestRegistration<T>(path: string, init: { method?: "GET" | "POST" | "PATCH"; body?: unknown; csrf?: string; relayCookies?: boolean } = {}): Promise<RegistrationReply<T>> {
  const target = registrationPath(path);
  const method = init.method ?? "GET";
  const api = resolveApiOrigin();
  if (!api.ok) {
    logApiFault("website", { method, path: target, host: null, status: 0, fault: api.fault, reason: api.reason });
    throw new Error("api_not_configured"); // callers turn any throw into their "unavailable" state; the log says why
  }
  // This site's own address is presented to the API on a change (it must be in the API's PUBLIC_ORIGINS); a read works without it.
  const site = resolveSiteOrigin("RIO_PUBLIC_ORIGIN");
  if (!site.ok && method !== "GET") {
    logApiFault("website", { method, path: target, host: api.host, status: 0, fault: site.fault, reason: site.reason });
    throw new Error("site_origin_not_configured");
  }
  const jar = await cookies();
  const headers = new Headers({ Accept: "application/json" });
  if (site.ok) headers.set("Origin", site.origin);
  const cookie = allowedCookieHeader(jar.toString());
  if (cookie) headers.set("Cookie", cookie);
  // The visitor's address, so the API's per-address limits tell visitors apart instead of counting this server as one (see TRUST_PROXY_HOPS in DEPLOYMENT.md).
  const visitor = (await requestHeaders()).get("x-forwarded-for")?.split(",")[0]?.trim();
  if (visitor) headers.set("X-Forwarded-For", visitor);
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (init.csrf) headers.set("X-CSRF-Token", init.csrf);
  let response: Response;
  try {
    response = await fetch(`${api.origin}${target}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    const { fault, cause } = classifyFetchError(error);
    logApiFault("website", { method, path: target, host: api.host, status: 0, fault, cause });
    throw error;
  }
  if (init.relayCookies ?? init.method !== "GET") await relayRecoveryCookies(response.headers);
  const body = (await response.json().catch(() => null)) as T | { error?: { code?: unknown; fields?: { field: string; problem: string }[] } } | null;
  const error = body && typeof body === "object" && "error" in body ? body.error : undefined;
  const apiCode = typeof error?.code === "string" && /^[a-z_]{1,40}$/u.test(error.code) ? error.code : undefined;
  // Quiet for what a parent can cause (closed window, bad field, rate limit); loud for anything that points at the setup.
  if (response.status >= 500 || response.status === 404 || (response.status === 403 && (apiCode === "origin_not_allowed" || apiCode === "csrf_invalid"))) {
    logApiFault("website", { method, path: target, host: api.host, status: response.status, apiCode });
  }
  return { status: response.status, body: response.ok ? (body as T) : null, fields: error?.fields, ...(apiCode ? { code: apiCode } : {}) };
}

export async function publicEvents(): Promise<PublicEvent[] | null> {
  try {
    const result = await requestRegistration<{ events: PublicEvent[] }>("/events");
    return result.status === 200 && result.body ? result.body.events : null;
  } catch {
    return null;
  }
}

export async function publicSettings(): Promise<PublicSettings | null> {
  try {
    const result = await requestRegistration<PublicSettings>("/settings/public");
    return result.status === 200 ? result.body : null;
  } catch {
    return null;
  }
}

export async function currentRegistration(): Promise<{ view: RegistrationView; csrfToken: string } | null> {
  try {
    const result = await requestRegistration<{ registration: RegistrationView; csrfToken: string }>("/registrations/current");
    return result.status === 200 && result.body ? { view: result.body.registration, csrfToken: result.body.csrfToken } : null;
  } catch {
    return null;
  }
}

export async function createRegistration(body: unknown): Promise<RegistrationReply<{ registration: RegistrationView; recoveryCode: string }>> {
  return requestRegistration("/registrations", { method: "POST", body });
}

export async function recoverRegistration(code: string): Promise<RegistrationReply<{ registration: RegistrationView; csrfToken: string }>> {
  return requestRegistration("/registrations/recover", { method: "POST", body: { code } });
}

export async function updateRegistration(body: unknown, csrf: string): Promise<RegistrationReply<{ registration: RegistrationView; csrfToken: string }>> {
  return requestRegistration("/registrations/current", { method: "PATCH", body, csrf });
}

export type VideoUploadGrant = { uploadId: string; url: string; contentType: string; expiresAt: string };

/** Asks the API for a 10-minute upload URL for the entry the cookie opens. The URL is a temporary credential for one object. */
export async function startVideoUpload(body: { type: string; bytes: number }, csrf: string): Promise<RegistrationReply<{ upload: VideoUploadGrant }>> {
  return requestRegistration("/registrations/current/video-uploads", { method: "POST", body, csrf });
}

/** Tells the API the browser finished its PUT; the API checks the stored object and attaches it (once, final). */
export async function completeVideoUpload(uploadId: string, csrf: string): Promise<RegistrationReply<{ registration: RegistrationView }>> {
  return requestRegistration(`/registrations/current/video-uploads/${uploadId}/complete`, { method: "POST", body: {}, csrf });
}

/** The last step: details, video, then this. The API checks everything again and finalizes the entry (or holds it for review). */
export async function submitRegistration(csrf: string): Promise<RegistrationReply<{ registration: RegistrationView }>> {
  return requestRegistration("/registrations/current/submit", { method: "POST", body: { confirm: true }, csrf });
}
