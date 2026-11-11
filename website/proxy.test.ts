import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

describe("website proxy", () => {
  it("runs only on the retired parent sign-in routes, so the public pages stay static and no staff route lives here", () => {
    expect(config.matcher).toEqual(["/signin/:path*", "/account"]);
    for (const path of ["/", "/events/:slug", "/events/:slug/register", "/results", "/images/:path*", "/admin/:path*", "/judge/:path*", "/staff/:path*"]) expect(config.matcher).not.toContain(path);
  });
  it("sends an old sign-in or account link to the competitions list without reading any session", () => {
    for (const path of ["/signin", "/signin/verify?event=kutti-pesalar", "/account"]) {
      const response = proxy(new NextRequest(`http://localhost:3000${path}`));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost:3000/competitions");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });
});
