import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const fonts = readFileSync(join(process.cwd(), "lib", "fonts.ts"), "utf8");
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

describe("RIO typography", () => {
  it("uses the hospital site's English sans and a dedicated Tamil companion", () => {
    expect(fonts).toContain("Montserrat");
    expect(fonts).toContain("Noto_Sans_Tamil");
    expect(css).toContain("--font-montserrat");
    expect(css).toContain("--font-tamil");
    expect(css).toContain('[lang="ta"]');
  });
});
