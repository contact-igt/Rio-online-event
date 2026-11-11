import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("the retired e-mail sweep endpoint", () => {
  it("is a plain 404 whatever the caller sends", async () => {
    const response = GET();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("Not found");
  });
  it("reads no service and no environment", () => {
    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/import |process\.env|supabase|fetch\(/i);
  });
});
