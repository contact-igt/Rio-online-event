import { NextResponse, type NextRequest } from "next/server";

// Parents no longer sign in: a registration is opened with its recovery code (Express API), so the old Supabase sign-in and account pages are gone.
// Anyone with an old link or bookmark lands on the competitions list. Nothing here reads a session or calls any service.
export function proxy(request: NextRequest) {
  return NextResponse.redirect(new URL("/competitions", request.url));
}

export const config = {
  matcher: ["/signin/:path*", "/account"],
};
