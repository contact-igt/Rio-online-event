import { readdirSync, readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";
import { bundleFixture } from "@/e2e/fixtures/bundle";

// The one-page registration (owner, 2026-11-13: "enter the details, upload the video, tick the checkbox, submit"). The REAL form runs in the
// installed Chrome; saving, the upload and the submission are fakes, and the "bucket" is https://r2.test, intercepted here. Nothing is saved,
// uploaded or sent. The sample "videos" are tiny generated WAV clips labelled as video, which the browser can still measure.

let bundle = "";
let css = "";

test.beforeAll(async () => {
  try {
    css = readdirSync(".next/static/css").filter((f) => f.endsWith(".css")).map((f) => readFileSync(`.next/static/css/${f}`, "utf8")).join("\n");
  } catch {
    css = "";
  }
  bundle = await bundleFixture("e2e/fixtures/one-page-entry.tsx", {
    "@/app/events/[slug]/register/actions": "e2e/fixtures/fake-save-draft.ts",
    "@/app/events/[slug]/register/video-actions": "e2e/fixtures/fake-video-actions.ts",
    "@/app/events/[slug]/register/submit-actions": "e2e/fixtures/fake-submit-actions.ts",
    "next/navigation": "e2e/fixtures/fake-navigation.ts",
  });
});

async function open(page: Page, script: { request?: unknown[]; confirm?: unknown[] } = {}) {
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root" style="padding:16px"></div>');
  if (css) await page.addStyleTag({ content: css });
  await page.evaluate((s) => (window.__script = s as Window["__script"]), script);
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("button", { name: /Submit entry/ })).toBeVisible();
}

function bucket(page: Page, answers: ("ok" | "abort")[] = []) {
  const puts: string[] = [];
  void page.route("https://r2.test/**", async (route: Route) => {
    puts.push(route.request().url());
    if ((answers.shift() ?? "ok") === "abort") return route.abort("connectionreset");
    return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, body: "" });
  });
  return puts;
}

async function fill(page: Page) {
  await page.locator("#childName").fill("Asha Kumar");
  await page.locator("#childAge").selectOption("9");
  await page.locator("#parentName").fill("Meena Kumar");
  await page.locator("#mobile").fill("9876543210");
  await page.locator('input[name="guardianConsent"]').check();
}

/** A generated 31-second clip put into the file input, the way choosing one in the browser would. */
async function pickVideo(page: Page) {
  await page.evaluate(() => {
    const rate = 8000;
    const dataLength = 31 * rate;
    const buf = new Uint8Array(Math.max(44 + dataLength, 110 * 1024));
    const v = new DataView(buf.buffer);
    const tag = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    tag(0, "RIFF");
    v.setUint32(4, 36 + dataLength, true);
    tag(8, "WAVEfmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate, true);
    v.setUint16(32, 1, true);
    v.setUint16(34, 8, true);
    tag(36, "data");
    v.setUint32(40, dataLength, true);
    buf.fill(128, 44, 44 + dataLength);
    const input = document.getElementById("video-file") as HTMLInputElement;
    const dt = new DataTransfer();
    dt.items.add(new File([buf], "story.mp4", { type: "video/mp4" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.getByText("Video chosen: 31 seconds")).toBeVisible();
}

const record = (page: Page) =>
  page.evaluate(() => ({ saved: window.__saved ?? [], calls: (window.__calls ?? []).map((c) => c.fn), submits: (window.__submitCalls ?? []).length, refreshed: window.__refreshed ?? 0 }));

test("one Submit saves the details, uploads the chosen video and submits the entry", async ({ page }) => {
  const puts = bucket(page);
  await open(page);
  await fill(page);
  await pickVideo(page);
  await page.getByRole("button", { name: /Submit entry/ }).click();
  await expect(page.getByText("Entry submitted").first()).toBeVisible();
  const r = await record(page);
  expect(r.saved).toHaveLength(1);
  expect(r.saved[0].draftId).toBeUndefined(); // a new entry
  expect(r.calls).toEqual(["request", "confirm"]);
  expect(puts).toHaveLength(1);
  expect(r.submits).toBe(1);
  expect(r.refreshed).toBe(1);
  await expect(page.getByRole("button", { name: /Submit entry/ })).toBeDisabled(); // cannot be sent twice
});

test("without a video, Submit says so under the video and sends nothing", async ({ page }) => {
  bucket(page);
  await open(page);
  await fill(page);
  await page.getByRole("button", { name: /Submit entry/ }).click();
  await expect(page.locator("#video-error")).toContainText("Choose the video before you submit.");
  await expect(page.locator("#finish-error")).toContainText("Choose the video before you submit.");
  const r = await record(page);
  expect(r.saved).toHaveLength(0);
  expect(r.calls).toEqual([]);
  expect(r.submits).toBe(0);
});

test("a dropped upload is retried by pressing Submit again: the entry is updated, not created twice, and submitted once", async ({ page }) => {
  const puts = bucket(page, ["abort", "ok"]);
  await open(page);
  await fill(page);
  await pickVideo(page);
  await page.getByRole("button", { name: /Submit entry/ }).click();
  await expect(page.locator("#video-error")).toContainText("The connection dropped.");
  await expect(page.locator("#finish-error")).toContainText("The connection dropped."); // also beside the button that was pressed
  expect((await record(page)).submits).toBe(0);
  await page.getByRole("button", { name: /Submit entry/ }).click();
  await expect(page.getByText("Entry submitted").first()).toBeVisible();
  const r = await record(page);
  expect(r.saved).toHaveLength(2);
  expect(r.saved[1].draftId).toBe("current"); // the second save updates the entry the first one created
  expect(puts).toHaveLength(2);
  expect(r.submits).toBe(1);
});

test("a field problem stops before the video is uploaded, and shows under the field", async ({ page }) => {
  const puts = bucket(page);
  await open(page);
  await fill(page);
  await page.locator("#mobile").fill("12");
  await pickVideo(page);
  await page.getByRole("button", { name: /Submit entry/ }).click();
  await expect(page.locator("#mobile-error")).toBeVisible();
  expect(puts).toHaveLength(0);
  expect((await record(page)).submits).toBe(0);
});

test("fits a 360 px phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  bucket(page);
  await open(page);
  await fill(page);
  await pickVideo(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  const box = await page.getByRole("button", { name: /Submit entry/ }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});
