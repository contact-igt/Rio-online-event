import { defineConfig } from "@playwright/test";

// Runs only the one-page registration test. It renders fixtures with page.setContent, so it needs no web server.
export default defineConfig({ testDir: ".", testMatch: "one-page-register.spec.ts", use: { channel: "chrome" } });
