import { NextRequest, NextResponse } from "next/server";

const API = (process.env.RIO_API_ORIGIN ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
const PUBLIC_ORIGIN = process.env.RIO_PUBLIC_ORIGIN ?? "http://localhost:3000";
const ALLOWED = new Set(["/events", "/settings/public", "/registrations", "/registrations/recover", "/registrations/current"]);
const COOKIE_NAMES = new Set(["rio_reg", "__Host-rio_reg"]);
const METHODS = new Set(["GET", "POST", "PATCH"]);

function pathFor(parts: string[] | undefined): string | null {
  if (!parts || parts.some((part) => !/^[a-z-]+$/.test(part))) return null;
  const path = `/${parts.join("/")}`;
  return ALLOWED.has(path) ? path : null;
}

function filteredCookie(raw: string | null): string {
  return (raw ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => COOKIE_NAMES.has(part.slice(0, part.indexOf("="))))
    .join("; ");
}

function filteredSetCookies(headers: Headers): string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  return (getSetCookie ? getSetCookie.call(headers) : [headers.get("set-cookie") ?? ""]).filter((cookie) => {
    const first = cookie.split(";", 1)[0] ?? "";
    return COOKIE_NAMES.has(first.slice(0, first.indexOf("=")));
  });
}

async function handler(request: NextRequest, context: { params: Promise<{ path?: string[] }> }): Promise<NextResponse> {
  if (!METHODS.has(request.method)) return NextResponse.json({ error: { code: "method_not_allowed" } }, { status: 405 });
  const path = pathFor((await context.params).path);
  if (!path) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  const suppliedOrigin = request.headers.get("origin");
  if (suppliedOrigin && suppliedOrigin !== PUBLIC_ORIGIN) return NextResponse.json({ error: { code: "origin_not_allowed" } }, { status: 403 });

  const headers = new Headers({ Accept: "application/json", Origin: PUBLIC_ORIGIN });
  const cookie = filteredCookie(request.headers.get("cookie"));
  if (cookie) headers.set("Cookie", cookie);
  const csrf = request.headers.get("x-csrf-token");
  if (csrf) headers.set("X-CSRF-Token", csrf);
  let body: string | undefined;
  if (request.method !== "GET") {
    headers.set("Content-Type", "application/json");
    body = await request.text();
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${API}/api/v1${path}`, { method: request.method, headers, body, cache: "no-store", redirect: "error" });
  } catch {
    return NextResponse.json({ error: { code: "unavailable" } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const response = new NextResponse(upstream.body, { status: upstream.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  for (const cookieHeader of filteredSetCookies(upstream.headers)) response.headers.append("Set-Cookie", cookieHeader);
  return response;
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
