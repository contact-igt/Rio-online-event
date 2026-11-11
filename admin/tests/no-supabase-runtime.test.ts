import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Every route, layout, route handler and the proxy is an entry point. Following their imports (type-only imports are erased at build time and
// are skipped) must never reach a Supabase client, so no page, action or endpoint can fall back to the old database. Library files that no route
// reaches are legacy and are not examined here.

const root = resolve(import.meta.dirname, "..");
const norm = (p: string) => p.split(sep).join("/");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const sources = walk(root).filter((p) => /\.tsx?$/.test(p) && !/\.(test|spec)\./.test(p) && !/playwright[^/]*\.config\.ts$/.test(norm(p)) && !/\/(e2e|e2e-live|scripts|tests)\//.test(norm(p)));
const entries = sources.filter((p) => /\/app\/.*(page|layout|route|not-found|loading|error)\.tsx?$/.test(norm(p)) || /\/proxy\.ts$/.test(norm(p)));

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const found: string[] = [];
  for (const m of text.matchAll(/(?:import|export)\s+(type\s+)?(?:[^'"`;]*?from\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) if (!m[1]) found.push((m[2] ?? m[3])!);
  return found;
}
function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(root, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

describe("admin runtime", () => {
  it("has entry points to examine", () => {
    expect(entries.length).toBeGreaterThan(10);
  });
  it("reaches no Supabase client from any route, action or endpoint", () => {
    const seen = new Set<string>();
    const stack = [...entries];
    while (stack.length > 0) {
      const file = stack.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of importsOf(file)) {
        const next = resolveImport(file, spec);
        if (next) stack.push(next);
      }
    }
    const offenders = [...seen].filter((file) => importsOf(file).some((spec) => /supabase/i.test(spec))).map((file) => norm(relative(root, file)));
    expect(offenders).toEqual([]);
  });
  it("decides the API and site addresses in one place: nothing else names those variables, a local address or the hosted API", () => {
    // A comment is not code, but a URL inside a string ("http://...") must still be seen, so only a // that does not follow a colon, a word or a quote is cut.
    const code = (file: string) => readFileSync(file, "utf8").replace(/(?<![:\w"'`])\/\/.*$/gm, "");
    const offenders = sources
      .filter((file) => !/\/lib\/api\/origin\.ts$/.test(norm(file)) && /RIO_API_ORIGIN|RIO_BACKEND_API_URL|process.env.RIO_(?:ADMIN|PUBLIC)_ORIGIN|(?:127\.0\.0\.1|localhost):(?:3000|3001|4000)|up\.railway\.app/.test(code(file)))
      .map((file) => norm(relative(root, file)));
    expect(offenders).toEqual([]);
    expect(readFileSync(join(root, "lib/api/express.ts"), "utf8")).toContain("./origin");
  });
});
