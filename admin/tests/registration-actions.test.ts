import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const deletedPage = readFileSync(join(process.cwd(), "app", "admin", "registrations", "deleted", "page.tsx"), "utf8");
const tabs = readFileSync(join(process.cwd(), "components", "admin", "registration-tabs.tsx"), "utf8");
const page = readFileSync(join(process.cwd(), "app", "admin", "registrations", "page.tsx"), "utf8");
const actions = readFileSync(join(process.cwd(), "app", "admin", "registrations", "actions.ts"), "utf8");
const component = readFileSync(join(process.cwd(), "components", "admin", "registration-row-actions.tsx"), "utf8");
const api = readFileSync(join(process.cwd(), "lib", "admin", "api.ts"), "utf8");
const editForm = readFileSync(join(process.cwd(), "components", "admin", "registration-edit-form.tsx"), "utf8");

describe("registration row actions", () => {
  it("keeps View on the existing detail page and renders the compact action component", () => {
    expect(page).toContain("/admin/registrations/${r.entryCode}");
    expect(page).toContain("<RegistrationRowActions");
    expect(page).toContain('canDelete={session.role === "super_admin"}');
  });

  it("keeps Copy browser-only and separates the four menu actions into dialogs or a link", () => {
    expect(component).toContain("navigator.clipboard.writeText");
    expect(component).toContain("View registration");
    expect(component).toContain("Edit registration");
    expect(component).toContain("Copy reference");
    expect(component).toContain("Delete registration");
    expect(component).toContain("createPortal");
    expect(component).toContain('event.key === "Escape"');
  });

  it("keeps mutation authorization in server actions", () => {
    expect(actions).toMatch(/^"use server";/);
    expect(actions).toContain("staffSessionCheck");
    expect(actions).toContain("updateRegistrationApi");
    expect(actions).toContain("deleteRegistrationApi");
    expect(actions).toContain('staffSessionCheck("admin")');
    expect(actions).toContain('staffSessionCheck("super_admin")');
  });

  it("gives Active and Deleted their own routes, with the Deleted page for the Super Admin only", () => {
    expect(tabs).toContain("/admin/registrations/deleted");
    expect(tabs).toContain("usePathname");
    expect(tabs).toContain("Active registrations");
    expect(tabs).toContain("Deleted registrations");
    expect(page).toContain("<RegistrationTabs");
    expect(page).toContain('requireStaff("admin")');
    expect(page).not.toContain("loadDeletedRegistrations");
    expect(deletedPage).toContain('requireStaff("super_admin")');
    expect(deletedPage).toContain("loadDeletedRegistrations");
    expect(deletedPage).not.toContain("RegistrationRowActions");
    expect(api).toContain("/admin/registrations/deleted");
  });

  it("keeps the edit form card responsive and adds a separate restore confirmation action", () => {
    expect(editForm).toContain("sm:grid-cols-2");
    expect(editForm).toContain("Save changes");
    expect(editForm).toContain("Cancel");
    expect(component).toContain("Restore registration");
    expect(component).toContain("Yes, restore");
    expect(actions).toContain("restoreRegistration");
    expect(actions).toContain('staffSessionCheck("super_admin")');
    expect(api).toContain("restoreRegistrationApi");
  });
});
