// Where the Express API is, which address THIS site presents to it as its Origin, and what to log when either cannot be used. ONE module decides, so
// every call and every diagnostic agrees. Server-side only (it reads process.env). Nothing here returns, logs or throws a secret, a cookie, a header
// or a request body: logs carry the API's host name, the route, the HTTP status and a fixed fault code.
//
// There is NO default and NO fallback in any environment. A missing or unusable setting is an error that says which variable and why:
//   RIO_BACKEND_API_URL   the API's address, no path (a trailing /api/v1 is tolerated and removed).
//   RIO_ADMIN_ORIGIN / RIO_PUBLIC_ORIGIN   this site's own address (admin / website). It must be listed in the API's ALLOWED_ORIGINS / PUBLIC_ORIGINS.
// One .env holds both environments. APP_ENV (development | production) picks <NAME>_DEVELOPMENT or <NAME>_PRODUCTION, whatever NODE_ENV is, so
// `next dev` can talk to the hosted API; changing it needs a restart. With APP_ENV set, the plain <NAME> is refused so an old variable cannot
// quietly override the choice. Without APP_ENV (tests, a hosting dashboard that predates it) the plain <NAME> wins, else NODE_ENV picks the mode.
// Environment rules:
//   development  the API must be on this machine. A hosted API (Production included) is refused, so a stray value cannot point a developer at it.
//   production   https:// unless the address is this machine (next start on a laptop); and never this machine on Vercel.

export const API_URL_NAME = "RIO_BACKEND_API_URL";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

type Env = Record<string, string | undefined>;
export type ApiFault = "not_configured" | "invalid_config" | "unreachable" | "timeout" | "tls" | "bad_response";
type SetupFault = "not_configured" | "invalid_config";
type Failure = { ok: false; fault: SetupFault; reason: string };
export type ApiTarget = { ok: true; origin: string; host: string; source: string } | Failure;
export type SiteTarget = { ok: true; origin: string } | Failure;

/** Trims and removes one pair of surrounding quotes (a quoted value pasted into a hosting dashboard keeps them). */
const clean = (value: string | undefined): string => (value ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
const invalid = (reason: string): Failure => ({ ok: false, fault: "invalid_config", reason });

type Mode = "development" | "production" | null;
type Setting = { ok: true; value: string; source: string; mode: Mode } | Failure;

/** The value of `name` for this run (see the header). Under test, or with no mode at all, only the plain name counts. */
function setting(env: Env, name: string): Setting {
  const plain = clean(env[name]);
  const appEnv = clean(env.APP_ENV);
  if (appEnv) {
    if (appEnv !== "development" && appEnv !== "production") return invalid("APP_ENV must be development or production");
    if (plain) return invalid(`${name} must not be set when APP_ENV is set; use ${name}_${appEnv.toUpperCase()}`);
    const source = `${name}_${appEnv.toUpperCase()}`;
    return { ok: true, value: clean(env[source]), source, mode: appEnv };
  }
  const mode: Mode = env.NODE_ENV === "development" || env.NODE_ENV === "production" ? env.NODE_ENV : null;
  if (plain) return { ok: true, value: plain, source: name, mode };
  const source = mode ? `${name}_${mode.toUpperCase()}` : name;
  return { ok: true, value: clean(env[source]), source, mode };
}

/** The rules both kinds of address share. `apiRoot` tolerates a pasted ".../api/v1", which is unambiguous: every call adds /api/v1 itself. */
function parseAddress(raw: string, source: string, env: Env, mode: Mode, apiRoot: boolean): { ok: true; url: URL } | Failure {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return invalid(`${source} is not a valid URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return invalid(`${source} must start with https:// or http://`);
  if (url.username || url.password) return invalid(`${source} must not contain a user name or password`);
  const path = apiRoot ? url.pathname.replace(/^\/api(\/v1)?\/?$/u, "/") : url.pathname;
  if (path !== "/" || url.search || url.hash) return invalid(`${source} must be the server address only, without a path`);
  const loopback = LOOPBACK.has(url.hostname);
  if (mode === "production" && url.protocol === "http:" && !loopback) return invalid(`${source} must use https:// in production`);
  if (env.VERCEL && loopback) return invalid(`${source} points at the machine it runs on, which cannot be right on Vercel`);
  return { ok: true, url };
}

export function resolveApiOrigin(env: Env = process.env): ApiTarget {
  const chosen = setting(env, API_URL_NAME);
  if (!chosen.ok) return chosen;
  const { value, source, mode } = chosen;
  if (!value) return { ok: false, fault: "not_configured", reason: `${source} is not set` };

  const parsed = parseAddress(value, source, env, mode, true);
  if (!parsed.ok) return parsed;
  const { url } = parsed;
  if (mode === "development" && !LOOPBACK.has(url.hostname)) {
    return invalid(`${source} is a hosted address, but development may only use the API on this machine (use http://localhost:4000; set APP_ENV=production to use the hosted API)`);
  }
  return { ok: true, origin: url.origin, host: url.host, source };
}

/** This site's own address, which the API checks against its list of allowed origins on every change. No default: a guess would be refused by the API or, worse, accepted. */
export function resolveSiteOrigin(name: "RIO_ADMIN_ORIGIN" | "RIO_PUBLIC_ORIGIN", env: Env = process.env): SiteTarget {
  const chosen = setting(env, name);
  if (!chosen.ok) return chosen;
  const { value, source, mode } = chosen;
  if (!value) return { ok: false, fault: "not_configured", reason: `${source} is not set` };
  const parsed = parseAddress(value, source, env, mode, false);
  return parsed.ok ? { ok: true, origin: parsed.url.origin } : parsed;
}

/** A network failure as a fixed fault code plus the system error code (for example ECONNREFUSED or ENOTFOUND), never the message text. */
export function classifyFetchError(error: unknown): { fault: ApiFault; cause: string } {
  const e = error as { name?: unknown; code?: unknown; cause?: { code?: unknown; name?: unknown } } | null;
  const cause = String(e?.cause?.code ?? e?.code ?? e?.cause?.name ?? e?.name ?? "error").replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) || "error";
  if (e?.name === "TimeoutError" || e?.name === "AbortError" || cause === "UND_ERR_CONNECT_TIMEOUT" || cause === "ETIMEDOUT") return { fault: "timeout", cause };
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(cause)) return { fault: "tls", cause };
  return { fault: "unreachable", cause };
}

export type FaultLog = { method: string; path: string; host: string | null; status: number; fault?: ApiFault | undefined; apiCode?: string | undefined; cause?: string | undefined; reason?: string | undefined };
/** One JSON line to the server log. Only the fields above; the route without its query string. */
export function logApiFault(app: string, entry: FaultLog): void {
  const line: Record<string, string | number | null> = { level: "error", event: "api_call_failed", app, method: entry.method, path: entry.path.split("?")[0] ?? "", host: entry.host, status: entry.status };
  if (entry.fault) line.fault = entry.fault;
  if (entry.apiCode) line.apiCode = entry.apiCode;
  if (entry.cause) line.cause = entry.cause;
  if (entry.reason) line.reason = entry.reason;
  console.error(JSON.stringify(line));
}
