import { describe, expect, it } from "vitest";
import { isPrivatePath } from "@/components/meta-pixel";

// Owner, 2026-11-15: the Meta Pixel on public pages only, never where a parent enters a child's details or signs in.
describe("Meta Pixel pages", () => {
  it("loads on public information pages", () => {
    for (const path of ["/", "/competitions", "/events/kathai-sollum-kutties", "/results", "/events/registered-users"]) expect(isPrivatePath(path), path).toBe(false);
  });

  it("never loads on registration, sign-in, account or dev pages", () => {
    for (const path of ["/events/kathai-sollum-kutties/register", "/events/x/register/", "/signin", "/signin/verify", "/account", "/dev/registration-preview"]) {
      expect(isPrivatePath(path), path).toBe(true);
    }
  });
});
