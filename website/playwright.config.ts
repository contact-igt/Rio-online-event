import { loadEnvConfig } from "@next/env";
import { defineConfig } from "@playwright/test";

// Load .env.local the way Next does, so the tests can tell whether Supabase is configured.
loadEnvConfig(process.cwd());

const PORT = 3100;

// Uses the Chrome already installed on the machine/CI runner; no browser download.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  use: { baseURL: `http://localhost:${PORT}`, channel: "chrome" },
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    // These tests drive fixtures and never need the API. APP_ENV=development (process values beat .env) pins it to a local port nothing listens on,
    // and development refuses any hosted address: a test can fail to reach the API but can never reach the real one.
    env: { APP_ENV: "development", RIO_BACKEND_API_URL_DEVELOPMENT: "http://127.0.0.1:4999", RIO_PUBLIC_ORIGIN_DEVELOPMENT: `http://localhost:${PORT}` },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
