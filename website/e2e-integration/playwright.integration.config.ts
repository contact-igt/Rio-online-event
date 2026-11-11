import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// Admin site -> Express API -> database <- Express API <- public website, all three started here against a DISPOSABLE SQLite file (never a
// real database, never a .env file: every setting below is passed explicitly). Both Next apps must already be built (npm run build in
// website/ and in admin/). Run:  npm run test:e2e:integration   (inside website/)
// Ports differ from the everyday ones (3000, 3001, 4000) and from the common 3100, 3101, 4100, so a running development setup is never touched.

const API = "http://127.0.0.1:4110";
const SITE = "http://localhost:3110";
const ADMIN = "http://localhost:3111";

const random = (bytes: number) => randomBytes(bytes).toString("base64url");
process.env.RIO_E2E_DB ??= join(process.env.RIO_E2E_DIR ?? tmpdir(), `rio-e2e-${Date.now()}.disposable.dev.sqlite`);
process.env.RIO_E2E_SUPER_EMAIL ??= "super.e2e@example.test";
process.env.RIO_E2E_SUPER_PASSWORD ??= `Aa1-${random(12)}`;
process.env.RIO_E2E_NEW_PASSWORD ??= `Bb2-${random(12)}`;
process.env.RIO_E2E_API = API;
process.env.RIO_E2E_SITE = SITE;
process.env.RIO_E2E_ADMIN = ADMIN;

// Optional: RIO_E2E_MYSQL_URL = mysql://<user>:<password>@127.0.0.1:<port>/<empty database> on a throw-away MariaDB on THIS machine (the backend itself refuses
// a non-local database when NODE_ENV=development, and a name ending _test). Without it the run uses the disposable SQLite file above.
const mysqlUrl = process.env.RIO_E2E_MYSQL_URL;
const database: Record<string, string> = mysqlUrl
  ? { DB_DIALECT: "mysql", DB_ENGINE: "mariadb", DB_ALLOWED_HOST: "127.0.0.1", DB_ALLOWED_DATABASE: new URL(mysqlUrl).pathname.slice(1), DATABASE_URL: mysqlUrl }
  : { DB_DIALECT: "sqlite", SQLITE_PATH: process.env.RIO_E2E_DB! };

const backendEnv = {
  NODE_ENV: "development",
  APP_ENV: "development",
  ...database,
  HOST: "127.0.0.1",
  PORT: "4110",
  ALLOWED_ORIGINS: ADMIN,
  PUBLIC_ORIGINS: SITE,
  TRUST_PROXY_HOPS: "1",
  RIO_SUPER_ADMIN_PASSWORD: process.env.RIO_E2E_SUPER_PASSWORD,
};

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 420_000,
  reporter: [["list"]],
  use: { baseURL: SITE, channel: "chrome", trace: "off" }, // the Chrome already on the machine, like the other configs: no browser download
  webServer: [
    {
      cwd: "../../backend",
      command: `node src/db/cli.ts migrate && node src/db/seed-events-cli.ts && node src/auth/cli.ts seed-super-admin --email ${process.env.RIO_E2E_SUPER_EMAIL} --name "E2E Super Admin" && node src/server.ts`,
      url: `${API}/api/v1/health`,
      env: backendEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      cwd: "../../admin",
      command: "npm run start -- -p 3111",
      url: `${ADMIN}/staff/login`,
      env: { RIO_BACKEND_API_URL: API, RIO_ADMIN_ORIGIN: ADMIN },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      cwd: "..",
      command: "npm run start -- -p 3110",
      url: `${SITE}/competitions`,
      env: { RIO_BACKEND_API_URL: API, RIO_PUBLIC_ORIGIN: SITE },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
