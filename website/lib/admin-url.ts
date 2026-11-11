// The admin panel is a separate site; this is its public address (no trailing slash). It is a public address, not a secret.
// APP_ENV (development | production, passed to the browser by next.config.ts) picks NEXT_PUBLIC_ADMIN_URL_DEVELOPMENT or _PRODUCTION; without it,
// NODE_ENV does. The plain NEXT_PUBLIC_ADMIN_URL (an older hosting dashboard) is used only when APP_ENV is not set. Written out in full because
// Next.js inlines these names only when spelled literally. Left unset, links stay on this origin.
const appEnv = process.env.APP_ENV;
const production = appEnv ? appEnv === "production" : process.env.NODE_ENV === "production";
const base =
  (appEnv ? "" : process.env.NEXT_PUBLIC_ADMIN_URL) ||
  (production ? process.env.NEXT_PUBLIC_ADMIN_URL_PRODUCTION : process.env.NEXT_PUBLIC_ADMIN_URL_DEVELOPMENT) ||
  "";
export const adminUrl = (path: string) => `${base}${path}`;
