import { cookies, headers } from "next/headers";
import { classifyFetchError, logApiFault, resolveApiOrigin, resolveSiteOrigin, type ApiFault } from "./origin";

// The admin site's way of talking to the Express API. It runs on the Next.js SERVER only (server components and server actions), so:
//   * the browser never calls the API itself: the session cookie stays HttpOnly, and the Content-Security-Policy (connect-src 'self') needs no change;
//   * the cookie the API issues is relayed to the browser by relayCookies(), with the attributes the API chose (HttpOnly, SameSite, Secure, lifetime);
//   * every request that changes something carries the admin site's own Origin (it must be one of the API's ALLOWED_ORIGINS) and the session's
//     CSRF token, so the API's Origin and CSRF checks stay in force; Next.js's own server-action Origin check guards the browser side.
// Settings (server-only, never NEXT_PUBLIC_): RIO_BACKEND_API_URL and RIO_ADMIN_ORIGIN. Neither has a default; see origin.ts.
//
// A call never hides why it failed: `fault` says what went wrong before any answer arrived (not configured, unreachable, timeout, TLS, unreadable
// answer) and `apiCode` is the API's own error code when it sent one. Unexpected failures go to the server log, without any secret.

/** The API uses the __Host- name when its cookie is Secure (production) and the plain name otherwise. */
export const SESSION_COOKIE_NAMES = ["__Host-rio_staff", "rio_staff"] as const;

/** status 0 means no answer came back at all; `fault` then says why. `apiCode` is error.code from the API's own JSON error, if any. */
export type ApiReply<T> = { status: number; body: T | null; setCookies: string[]; fault?: ApiFault; apiCode?: string };

export async function sessionCookieHeader(): Promise<string | null> {
  const jar = await cookies();
  for (const name of SESSION_COOKIE_NAMES) {
    const found = jar.get(name);
    if (found) return `${name}=${found.value}`;
  }
  return null;
}

export async function callApi<T>(path: string, init: { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown; cookie?: string | null; csrf?: string } = {}): Promise<ApiReply<T>> {
  const method = init.method ?? "GET";
  const target = resolveApiOrigin();
  if (!target.ok) {
    logApiFault("admin", { method, path, host: null, status: 0, fault: target.fault, reason: target.reason });
    return { status: 0, body: null, setCookies: [], fault: target.fault };
  }
  const out: Record<string, string> = { accept: "application/json" };
  if (init.cookie) out.cookie = init.cookie;
  if (method !== "GET") {
    const site = resolveSiteOrigin("RIO_ADMIN_ORIGIN");
    if (!site.ok) {
      logApiFault("admin", { method, path, host: target.host, status: 0, fault: site.fault, reason: site.reason });
      return { status: 0, body: null, setCookies: [], fault: site.fault };
    }
    out["content-type"] = "application/json";
    out.origin = site.origin;
    if (init.csrf) out["x-csrf-token"] = init.csrf;
  }
  // The visitor's address, so the API's per-address limits can tell visitors apart once it is told how many proxies to trust (TRUST_PROXY_HOPS).
  const forwarded = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) out["x-forwarded-for"] = forwarded;
  try {
    const res = await fetch(`${target.origin}/api/v1${path}`, {
      method,
      headers: out,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    let body: T | null = null;
    let unreadable = false;
    try {
      body = text ? (JSON.parse(text) as T) : null;
    } catch {
      unreadable = true; // an HTML error page from a proxy, for example: treated as no usable answer
    }
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
    const apiCode = typeof code === "string" && /^[a-z_]{1,40}$/u.test(code) ? code : undefined;
    const fault: ApiFault | undefined = unreadable ? "bad_response" : undefined;
    // Quiet for the answers a normal user can cause (wrong password, rate limit, a field problem); loud for anything that points at the setup.
    if (fault || res.status >= 500 || res.status === 403 || res.status === 404) logApiFault("admin", { method, path, host: target.host, status: res.status, fault, apiCode });
    return { status: res.status, body, setCookies: res.headers.getSetCookie(), ...(fault ? { fault } : {}), ...(apiCode ? { apiCode } : {}) };
  } catch (error) {
    const { fault, cause } = classifyFetchError(error);
    logApiFault("admin", { method, path, host: target.host, status: 0, fault, cause });
    return { status: 0, body: null, setCookies: [], fault };
  }
}

export type ParsedCookie = { name: string; value: string; maxAge?: number; httpOnly: boolean; secure: boolean; sameSite?: "strict" | "lax" | "none"; path: string };

/** One Set-Cookie header from the API. Only the attributes the API sets are understood; anything else is ignored. */
export function parseSetCookie(header: string): ParsedCookie | null {
  const parts = header.split(";").map((p) => p.trim());
  const first = parts[0] ?? "";
  const eq = first.indexOf("=");
  if (eq < 1) return null;
  const cookie: ParsedCookie = { name: first.slice(0, eq), value: first.slice(eq + 1), httpOnly: false, secure: false, path: "/" };
  for (const attr of parts.slice(1)) {
    const [rawKey = "", ...rest] = attr.split("=");
    const key = rawKey.toLowerCase();
    const value = rest.join("=");
    if (key === "httponly") cookie.httpOnly = true;
    else if (key === "secure") cookie.secure = true;
    else if (key === "path") cookie.path = value || "/";
    else if (key === "max-age" && /^-?\d+$/.test(value)) cookie.maxAge = Number(value);
    else if (key === "expires" && cookie.maxAge === undefined) {
      const at = Date.parse(value);
      if (!Number.isNaN(at)) cookie.maxAge = Math.round((at - Date.now()) / 1000);
    } else if (key === "samesite" && ["strict", "lax", "none"].includes(value.toLowerCase())) cookie.sameSite = value.toLowerCase() as "strict" | "lax" | "none";
  }
  return cookie;
}

/** Gives the browser the cookies the API issued (a new session) or cleared (sign-out). Server actions only. */
export async function relayCookies(setCookies: readonly string[]): Promise<void> {
  const jar = await cookies();
  for (const header of setCookies) {
    const c = parseSetCookie(header);
    if (!c || !(SESSION_COOKIE_NAMES as readonly string[]).includes(c.name)) continue; // only the session cookie is ever relayed
    if (c.value === "" || (c.maxAge !== undefined && c.maxAge <= 0)) {
      jar.delete(c.name);
      continue;
    }
    jar.set(c.name, c.value, { httpOnly: true, secure: c.secure, sameSite: c.sameSite ?? "strict", path: c.path, ...(c.maxAge === undefined ? {} : { maxAge: c.maxAge }) });
  }
}

/** Removes the session cookie from the browser whatever the API said (used when signing out, so a failed API call can never leave a cookie behind). */
export async function forgetSessionCookie(): Promise<void> {
  const jar = await cookies();
  for (const name of SESSION_COOKIE_NAMES) jar.delete(name);
}
