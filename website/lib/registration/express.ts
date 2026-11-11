import "server-only";

import { cookies } from "next/headers";

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
  createdAt: string | null;
  updatedAt: string | null;
  codeExpiresAt: string;
};

export type RegistrationReply<T> = {
  status: number;
  body: T | null;
  fields?: { field: string; problem: string }[];
};

const API = (process.env.RIO_API_ORIGIN ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
const PUBLIC_ORIGIN = process.env.RIO_PUBLIC_ORIGIN ?? "http://localhost:3000";
const REG_COOKIE_NAMES = new Set(["rio_reg", "__Host-rio_reg"]);
const PATHS = new Set(["/events", "/settings/public", "/registrations", "/registrations/recover", "/registrations/current"]);

export const isRegistrationPath = (path: string): boolean => PATHS.has(path);

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
    jar.set({ name, value: deleting ? "" : value, httpOnly: true, sameSite: "strict", secure: PUBLIC_ORIGIN.startsWith("https://"), path: "/", ...(deleting ? { maxAge: 0 } : {}) });
  }
}

export async function requestRegistration<T>(path: string, init: { method?: "GET" | "POST" | "PATCH"; body?: unknown; csrf?: string; relayCookies?: boolean } = {}): Promise<RegistrationReply<T>> {
  const target = registrationPath(path);
  const jar = await cookies();
  const headers = new Headers({ Accept: "application/json", Origin: PUBLIC_ORIGIN });
  const cookie = allowedCookieHeader(jar.toString());
  if (cookie) headers.set("Cookie", cookie);
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (init.csrf) headers.set("X-CSRF-Token", init.csrf);
  const response = await fetch(`${API}${target}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), cache: "no-store", redirect: "error" });
  if (init.relayCookies ?? init.method !== "GET") await relayRecoveryCookies(response.headers);
  const body = (await response.json().catch(() => null)) as T | { error?: { fields?: { field: string; problem: string }[] } } | null;
  const error = body && typeof body === "object" && "error" in body ? body.error : undefined;
  return { status: response.status, body: response.ok ? (body as T) : null, fields: error?.fields };
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
