import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dashboardPage = readFileSync(join(process.cwd(), "app", "admin", "page.tsx"), "utf8");
const dashboardPanel = readFileSync(join(process.cwd(), "components", "admin", "dashboard-panel.tsx"), "utf8");
const adminLayout = readFileSync(join(process.cwd(), "app", "admin", "layout.tsx"), "utf8");
const adminNav = readFileSync(join(process.cwd(), "components", "admin", "admin-nav.tsx"), "utf8");

describe("admin dashboard layout", () => {
  it("uses a compact dashboard page heading", () => {
    expect(dashboardPage).toContain("text-[clamp(1.75rem,5vw,2rem)]");
    expect(dashboardPage).toContain("font-bold leading-tight");
    expect(dashboardPage).toContain("lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]");
  });

  it("uses a one-, two-, and three-column KPI grid across responsive breakpoints", () => {
    expect(dashboardPanel).toContain("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3");
  });

  it("uses compact section headings and a responsive registration row", () => {
    expect(dashboardPage).toContain("text-lg font-semibold leading-snug");
    expect(dashboardPanel).toContain("text-lg font-semibold leading-snug");
    expect(dashboardPanel).toContain("sm:grid-cols-[7.5rem_minmax(0,1fr)_auto]");
  });

  it("keeps the admin shell full-height with the official logo in the shared sidebar", () => {
    expect(adminLayout).toContain("min-h-dvh");
    expect(adminLayout).toContain("lg:grid-cols-[15rem_minmax(0,1fr)]");
    expect(adminNav).toContain("/images/rio logo v2.png");
    expect(adminLayout).toContain("bg-rio-navy");
  });

  it("uses distinct soft accent treatments for the KPI tiles", () => {
    expect(dashboardPanel).toContain("bg-rio-blush");
    expect(dashboardPanel).toContain("bg-rio-mist");
    expect(dashboardPanel).toContain("bg-emerald-50");
  });
});
