import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const filtersSource = readFileSync(join(process.cwd(), "components", "admin", "registration-filters.tsx"), "utf8");
const registrationsPage = readFileSync(join(process.cwd(), "app", "admin", "registrations", "page.tsx"), "utf8");

describe("admin registrations layout", () => {
  it("keeps the page heading and filters compact and responsive", () => {
    expect(registrationsPage).toContain("text-[clamp(1.75rem,4vw,2rem)]");
    expect(filtersSource).toContain("lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))_auto]");
    expect(registrationsPage).toContain("bg-white/90");
    expect(filtersSource).toContain('Icon name="filter"');
  });

  it("uses the approved table structure with readable status and video cells", () => {
    expect(registrationsPage).toContain("card mt-6 overflow-hidden");
    expect(registrationsPage).toContain("overflow-x-auto");
    expect(registrationsPage).toContain("bg-rio-blush");
    expect(registrationsPage).toContain("updatedAt");
    expect(registrationsPage).toContain("bg-violet-50");
    expect(registrationsPage).toContain("bg-emerald-50");
  });

  it("preserves GET filtering, registration links, and pagination", () => {
    expect(registrationsPage).toContain("<RegistrationFilters");
    expect(filtersSource).toContain("router.replace"); // the URL stays the source of truth
    expect(filtersSource).toContain("DEBOUNCE_MS");
    expect(filtersSource).toContain("Apply filters");
    expect(registrationsPage).toContain("/admin/registrations/${r.entryCode}");
    expect(registrationsPage).toContain("pageLink(list.data.page - 1)");
    expect(registrationsPage).toContain("pageLink(list.data.page + 1)");
    expect(registrationsPage).toContain("aria-current");
  });
});
