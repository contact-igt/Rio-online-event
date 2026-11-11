import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

// The whole chain through the real screens, in order, against the disposable database started by playwright.integration.config.ts:
//   Super Admin sign-in -> competition -> dynamic questions -> save draft -> publish -> schedule registration -> website registration ->
//   published questions only -> required and format validation -> answers stored -> recovery -> question version kept -> duplicate flag ->
//   admin registration list and detail.
// The database is read (and, once, written to stand in for the not-yet-built final submission) directly, only to prove what was stored:
// the disposable SQLite file by default, or the throw-away MariaDB named by RIO_E2E_MYSQL_URL (see the config).

const API = process.env.RIO_E2E_API!;
const SITE = process.env.RIO_E2E_SITE!;
const ADMIN = process.env.RIO_E2E_ADMIN!;
const DB_PATH = process.env.RIO_E2E_DB!;
const MYSQL = process.env.RIO_E2E_MYSQL_URL;
const BRIDGE = join(process.cwd(), "e2e-integration", "sql.mjs");
const EMAIL = process.env.RIO_E2E_SUPER_EMAIL!;
const FIRST_PASSWORD = process.env.RIO_E2E_SUPER_PASSWORD!;
const NEW_PASSWORD = process.env.RIO_E2E_NEW_PASSWORD!;

const A = "kutti-pesalar"; // ages 8 to 12
const B = "malalai-mozhi"; // ages 3 to 5; only ever has a draft question set
const MOBILE = "9876543210";

const seen: string[] = []; // every URL any browser page asked for
function watch(page: Page) {
  page.on("request", (request) => seen.push(request.url()));
  return page;
}
async function newPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: SITE });
  return { context, page: watch(await context.newPage()) };
}

const rows = <T>(sql: string, ...params: (string | number)[]): T[] => {
  if (MYSQL) return JSON.parse(execFileSync(process.execPath, [BRIDGE, sql, JSON.stringify(params)], { encoding: "utf8" })) as T[];
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
};
const one = <T>(sql: string, ...params: (string | number)[]): T => rows<T>(sql, ...params)[0]!;

/** "YYYY-MM-DDTHH:mm" in India time for a datetime-local field, the next whole minute at least `leadSeconds` away. */
function istField(leadSeconds: number, extraMinutes = 0): string {
  const at = new Date(Math.ceil((Date.now() + leadSeconds * 1000) / 60_000) * 60_000 + extraMinutes * 60_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

async function addQuestion(page: Page, linkName: RegExp, fields: { ta: string; en: string; required?: boolean; options?: [string, string][] }) {
  await page.getByRole("link", { name: linkName }).first().click();
  await page.locator("#promptTa").fill(fields.ta);
  await page.locator("#promptEn").fill(fields.en);
  if (fields.options) {
    while ((await page.locator('[id^="o-ta-"]').count()) < fields.options.length) await page.getByRole("button", { name: /Add an option/ }).click();
    for (const [i, [ta, en]] of fields.options.entries()) {
      await page.locator(`#o-ta-${i}`).fill(ta);
      await page.locator(`#o-en-${i}`).fill(en);
    }
  }
  if (fields.required) await page.getByLabel(/Required/).check();
  await page.getByRole("button", { name: /Save question/ }).click();
  await expect(page.getByText(fields.en).first()).toBeVisible();
}

async function publish(page: Page) {
  await page.getByRole("button", { name: /Publish…/ }).click();
  await page.getByLabel(/I have checked the preview/).check();
  await page.getByRole("button", { name: /Publish now/ }).click();
  await page.waitForURL(/notice=published/); // the action redirects here only after the API confirmed the publish
}

async function fillChild(page: Page, o: { name: string; age: string; parent: string; mobile: string; consent?: boolean }) {
  await page.locator("#childName").fill(o.name);
  await page.locator("#childAge").selectOption(o.age);
  await page.locator("#parentName").fill(o.parent);
  await page.locator("#mobile").fill(o.mobile);
  if (o.consent !== false) await page.locator('input[name="guardianConsent"]').check();
}
const saveButton = (page: Page) => page.locator("form", { has: page.locator("#childName") }).locator('button[type="submit"]');
/** Presses save and waits until the action has finished and React has reset the form, so the next fill is not overwritten by that reset. */
async function submit(page: Page) {
  await saveButton(page).click();
  await expect(saveButton(page)).toBeEnabled();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test.describe.serial("Admin -> Express API -> database -> website", () => {
  let browser: Browser;
  let admin: Page;
  let adminContext: BrowserContext;
  let recoveryCode = "";
  let parentOne: { context: BrowserContext; page: Page };

  test.beforeAll(async ({ browser: b }) => {
    browser = b;
    ({ context: adminContext, page: admin } = await newPage(browser));
  });
  test.afterEach(async ({}, testInfo) => {
    // A failed step prints what the parent's page was showing, since the failure snapshot may belong to another page.
    if (testInfo.status !== testInfo.expectedStatus && parentOne) {
      const text = await parentOne.page.locator("body").innerText().catch(() => "(page closed)");
      const alerts = await parentOne.page.locator("[role=alert]").allInnerTexts().catch(() => []);
      console.log(`--- parent page at failure (${parentOne.page.url()}), alerts: ${JSON.stringify(alerts)}
...${text.slice(-1800)}`);
    }
  });
  test.afterAll(async () => {
    await adminContext?.close();
    await parentOne?.context.close();
  });

  test("legacy Supabase pages are gone: old sign-in and account links land on the competitions list, the e-mail sweep is closed", async ({ request }) => {
    const { page, context } = await newPage(browser);
    for (const path of ["/signin", "/signin/verify?event=kutti-pesalar", "/account"]) {
      await page.goto(path);
      await expect(page).toHaveURL(`${SITE}/competitions`);
    }
    expect((await request.get(`${SITE}/api/email-sweep`)).status()).toBe(404);
    await context.close();
  });

  test("nothing is open or published yet: the website says so and shows no form; the API hides everything", async ({ request }) => {
    const { page, context } = await newPage(browser);
    await page.goto(`/events/${A}/register`);
    await expect(page.locator("#childName")).toHaveCount(0);
    await expect(page.getByText(/not been configured|temporarily unavailable|not open|Questions are not published/i).first()).toBeVisible();
    const events = (await (await request.get(`${API}/api/v1/events`)).json()) as { events: { slug: string; questionSet: unknown }[] };
    expect(events.events).toHaveLength(6);
    expect(events.events.every((e) => e.questionSet === null)).toBe(true);
    expect(await (await request.get(`${API}/api/v1/settings/public`)).json()).toMatchObject({ registrationOpen: false });
    await page.goto("/results");
    await expect(page.getByText("The winners announcement date will be confirmed later.")).toBeVisible();
    await context.close();
  });

  test("admin area refuses a visitor without a session, and a wrong password starts none", async ({ request }) => {
    await admin.goto(`${ADMIN}/admin`);
    await expect(admin).toHaveURL(/\/staff\/login/);
    expect((await request.get(`${API}/api/v1/admin/registrations`)).status()).toBe(401);
    expect((await request.get(`${API}/api/v1/admin/dashboard`)).status()).toBe(401);
    await admin.locator("#staff-email").fill(EMAIL);
    await admin.locator("#staff-password").fill("wrong-password-123");
    await admin.locator('form button[type="submit"]').click();
    await expect(admin.locator("#staff-error")).toBeVisible();
    await expect(admin).toHaveURL(/\/staff\/login/);
  });

  test("Super Admin signs in with the issued password, must choose a new one, and reaches the dashboard", async () => {
    await admin.locator("#staff-password").fill(FIRST_PASSWORD);
    await admin.locator('form button[type="submit"]').click();
    await expect(admin).toHaveURL(/\/staff\/set-password/);
    await admin.goto(`${ADMIN}/admin`); // nothing else is reachable until the password is changed
    await expect(admin).toHaveURL(/\/staff\/set-password/);
    await admin.locator("#current-password").fill(FIRST_PASSWORD);
    await admin.locator("#new-password").fill(NEW_PASSWORD);
    await admin.locator("#confirm-password").fill(NEW_PASSWORD);
    await admin.locator('form button[type="submit"]').click();
    await expect(admin).toHaveURL(`${ADMIN}/admin`);
    await expect(admin.getByText("Super Admin").first()).toBeVisible();
    await expect(admin.getByText(/Registration is\s*closed/)).toBeVisible();
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM staff_users WHERE role = 'super_admin'").n).toBe(1);
    const cookies = await adminContext.cookies(ADMIN);
    expect(cookies.find((c) => c.name === "rio_staff")).toMatchObject({ httpOnly: true, sameSite: "Strict" });
    expect(await admin.evaluate(() => document.cookie)).not.toContain("rio_staff");
  });

  test("dashboard and competition list come from the database: six competitions, no registrations", async () => {
    await admin.goto(`${ADMIN}/admin`);
    await expect(admin.getByRole("link", { name: /Kutti Pesalar|Little Speaker/ }).first()).toBeVisible();
    const total = one<{ n: number }>("SELECT COUNT(*) AS n FROM events").n;
    expect(total).toBe(6);
    await expect(admin.locator("dt", { hasText: "Competitions" }).locator("xpath=following-sibling::dd")).toHaveText("6");
    await expect(admin.locator("dt", { hasText: "Registrations" }).locator("xpath=following-sibling::dd")).toHaveText("0");
  });

  test("builds a draft question set for one competition, saves it, and the public API still shows nothing", async ({ request }) => {
    await admin.goto(`${ADMIN}/admin/events/${A}/questions`);
    await admin.getByRole("button", { name: /Blank draft/ }).click();
    await addQuestion(admin, /Short text/, { ta: "பள்ளியின் பெயர்", en: "School name", required: true });
    await addQuestion(admin, /Radio buttons/, { ta: "வகுப்பு நிலை", en: "Class level", options: [["தொடக்கம்", "Primary"], ["உயர்", "Upper primary"]] });
    await addQuestion(admin, /Checkboxes/, { ta: "பொழுதுபோக்குகள்", en: "Hobbies", options: [["வாசிப்பு", "Reading"], ["ஓவியம்", "Drawing"], ["பாடல்", "Singing"]] });
    await addQuestion(admin, /Instruction/, { ta: "கவனமாகப் படியுங்கள்", en: "Read each question carefully" });
    expect(one<{ status: string; n: number }>("SELECT qs.status, COUNT(q.id) AS n FROM question_sets qs JOIN events e ON e.id = qs.event_id LEFT JOIN questions q ON q.question_set_id = qs.id WHERE e.slug = ? GROUP BY qs.id", A)).toEqual({ status: "draft", n: 4 });

    // A second competition keeps its own, unpublished draft; its text must never reach the first competition's form or the public API.
    await admin.goto(`${ADMIN}/admin/events/${B}/questions`);
    await admin.getByRole("button", { name: /Blank draft/ }).click();
    await addQuestion(admin, /Short text/, { ta: "ரகசிய வரைவு", en: "SECRET-DRAFT-OF-B", required: true });

    const events = await (await request.get(`${API}/api/v1/events`)).text();
    expect(events).not.toContain("School name");
    expect(events).not.toContain("SECRET-DRAFT-OF-B");
  });

  test("previews and publishes the first competition's questions; the public API now serves exactly that version", async ({ request }) => {
    await admin.goto(`${ADMIN}/admin/events/${A}/questions`);
    await admin.getByRole("link", { name: "Preview", exact: true }).click();
    await expect(admin.getByText("School name").first()).toBeVisible();
    await admin.getByRole("link", { name: "Questions", exact: true }).click();
    await publish(admin);
    const events = (await (await request.get(`${API}/api/v1/events`)).json()) as { events: { slug: string; questionSet: { version: number; questions: { promptEn: string; required: boolean }[] } | null }[] };
    const a = events.events.find((e) => e.slug === A)!;
    expect(a.questionSet?.version).toBe(1);
    expect(a.questionSet?.questions.map((q) => q.promptEn)).toEqual(["School name", "Class level", "Hobbies", "Read each question carefully"]);
    expect(a.questionSet?.questions[0]?.required).toBe(true);
    expect(events.events.find((e) => e.slug === B)?.questionSet).toBeNull();
    expect(JSON.stringify(events)).not.toContain("SECRET-DRAFT-OF-B");
    expect(one<{ status: string }>("SELECT qs.status FROM question_sets qs JOIN events e ON e.id = qs.event_id WHERE e.slug = ?", A).status).toBe("published");
  });

  test("schedules the registration window; it cannot be opened on the spot, and stays closed until the saved time", async ({ request }) => {
    await admin.goto(`${ADMIN}/admin/settings`);
    await admin.locator("#guardianConsentVersion").fill("v0-provisional");
    await admin.locator("#opensAt").fill(istField(-3600)); // an hour ago would open it now: refused
    await admin.locator("#closesAt").fill(istField(0, 120));
    await admin.getByRole("button", { name: /Save settings/ }).click();
    await expect(admin.getByRole("alert").first()).toBeVisible();
    expect((await (await request.get(`${API}/api/v1/settings/public`)).json()).registrationOpen).toBe(false);

    await admin.locator("#opensAt").fill(istField(20));
    await admin.locator("#closesAt").fill(istField(20, 120));
    await admin.getByRole("button", { name: /Save settings/ }).click();
    await expect(admin.getByText(/Settings saved/)).toBeVisible();
    await admin.reload();
    await expect(admin.locator("#guardianConsentVersion")).toHaveValue("v0-provisional");
    expect(one<{ guardian_consent_version: string; submissions_open_at: string }>("SELECT guardian_consent_version, submissions_open_at FROM event_settings WHERE id = 1").guardian_consent_version).toBe("v0-provisional");
    expect((await (await request.get(`${API}/api/v1/settings/public`)).json()).registrationOpen).toBe(false);
  });

  test("registration opens at the saved time", async ({ request }) => {
    await expect.poll(async () => (await (await request.get(`${API}/api/v1/settings/public`)).json()).registrationOpen, { timeout: 150_000, intervals: [2_000] }).toBe(true);
  });

  test("the website shows only this competition's published questions, and none of another competition's draft", async () => {
    parentOne = await newPage(browser);
    const { page } = parentOne;
    await page.goto(`/events/${A}/register`);
    await expect(page.locator("#childName")).toBeVisible();
    for (const text of ["School name", "Class level", "Hobbies", "Read each question carefully"]) await expect(page.getByText(text).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("SECRET-DRAFT-OF-B");
    await expect(page.locator("body")).not.toContainText("Favourite subject");

    const { page: other, context } = await newPage(browser);
    await other.goto(`/events/${B}/register`);
    await expect(other.locator("#childName")).toHaveCount(0); // B has only a draft: nothing to fill in
    await expect(other.getByText(/Questions are not published/)).toBeVisible();
    await expect(other.locator("body")).not.toContainText("SECRET-DRAFT-OF-B");
    await context.close();
  });

  test("on a 360px phone the dynamic form has no sideways scroll and every published question sits inside the screen, in the order set in the admin", async () => {
    const context = await browser.newContext({ baseURL: SITE, viewport: { width: 360, height: 800 } });
    const page = watch(await context.newPage());
    await page.goto(`/events/${A}/register`);
    await expect(page.getByText("School name").first()).toBeVisible();
    const fit = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(fit.scroll).toBeLessThanOrEqual(fit.inner);
    const fields = page.locator('[id^="answer_"]:not([id$="-error"])');
    expect(await fields.count()).toBeGreaterThanOrEqual(1);
    for (const box of await fields.evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON() as { left: number; right: number }))) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(360);
    }
    const labels = await page.locator("label").allInnerTexts();
    const order = ["School name", "Class level", "Hobbies"].map((text) => labels.findIndex((label) => label.includes(text)));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b)); // the order the administrator saved
    await page.screenshot({ path: join(process.env.RIO_E2E_DIR ?? "test-results", "registration-360.png"), fullPage: true });
    await context.close();
  });

  test("the form validates on the server: format, required answers and consent, keeping what was typed", async () => {
    const { page } = parentOne;
    await page.goto(`/events/${A}/register`);
    await submit(page); // everything empty
    await expect(page.locator("#mobile-error")).toBeVisible();

    await fillChild(page, { name: "Asha Kumar", age: "9", parent: "Meena Kumar", mobile: "12345" });
    await submit(page);
    await expect(page.locator("#mobile-error")).toBeVisible();
    await expect(page.locator("#childName")).toHaveValue("Asha Kumar");

    await page.locator("#mobile").fill(MOBILE);
    await page.getByLabel(/Upper primary/).check();
    await submit(page); // the required "School name" is empty
    await expect(page.locator('[id^="answer_"][id$="-error"]')).toHaveCount(1);
    await expect(page.getByText("Please answer this question.")).toBeVisible();
    await expect(page.locator("#childName")).toHaveValue("Asha Kumar");
    await expect(page.getByLabel(/Upper primary/)).toBeChecked(); // the answer typed so far is kept
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM submissions").n).toBe(0);

    await page.getByLabel(/School name/).fill("Government Primary School");
    await page.locator('input[name="guardianConsent"]').uncheck();
    await submit(page); // no guardian consent
    await expect(page.locator("#guardianConsent-error")).toBeVisible();
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM submissions").n).toBe(0);
  });

  test("a valid registration is saved without any parent login or OTP, with the recovery code shown once", async () => {
    const { page } = parentOne;
    await page.locator('input[name="guardianConsent"]').check();
    await page.getByLabel(/Drawing/).check();
    await page.getByLabel(/Reading/).check();
    await saveButton(page).click();
    await expect(page).toHaveURL(/saved=1/);
    await expect(page.getByText("Draft saved")).toBeVisible();
    recoveryCode = (await page.getByLabel("Recovery code").innerText()).trim();
    expect(recoveryCode).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){5}$/);
    await expect(page.locator("body")).not.toContainText(/OTP|one-time code|sign in/i);

    const entry = one<{ entry_code: string; status: string; child_name: string; child_age: number; guardian_name: string; guardian_mobile: string; guardian_consent_version: string; set_status: string; version: number; slug: string }>(
      "SELECT s.entry_code, s.status, s.child_name, s.child_age, s.guardian_name, s.guardian_mobile, s.guardian_consent_version, qs.status AS set_status, qs.version, e.slug FROM submissions s JOIN question_sets qs ON qs.id = s.question_set_id JOIN events e ON e.id = s.event_id",
    );
    expect(entry).toMatchObject({ status: "draft", child_name: "Asha Kumar", child_age: 9, guardian_name: "Meena Kumar", guardian_mobile: `+91${MOBILE}`, guardian_consent_version: "v0-provisional", set_status: "published", version: 1, slug: A });
    expect(entry.entry_code).toMatch(/^[A-Z0-9]{6,16}$/);
    const answers = rows<{ k: string; value_text: string | null; value_json: string | null }>("SELECT q.prompt_en AS k, a.value_text, a.value_json FROM entry_answers a JOIN questions q ON q.id = a.question_id ORDER BY q.position");
    expect(answers).toEqual([
      { k: "School name", value_text: "Government Primary School", value_json: null },
      { k: "Class level", value_text: expect.any(String), value_json: null },
      { k: "Hobbies", value_text: null, value_json: expect.stringContaining("[") },
    ]);
    expect(JSON.parse(answers[2]!.value_json!)).toHaveLength(2);
    // Only a SHA-256 of the code is stored, never the code.
    expect(rows<{ token_sha256: string }>("SELECT token_sha256 FROM registration_recovery").map((r) => r.token_sha256).join()).not.toContain(recoveryCode.replaceAll("-", ""));
    const audit = rows<{ details: string | null }>("SELECT details FROM audit_log WHERE action = 'registration.created'");
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toMatch(/Asha|Meena|9876543210/);
  });

  test("a refresh reopens the draft from the HttpOnly cookie; an edit is stored", async () => {
    const { page, context } = parentOne;
    await page.goto(`/events/${A}/register`);
    await expect(page.locator("#childName")).toHaveValue("Asha Kumar");
    await expect(page.getByLabel(/School name/)).toHaveValue("Government Primary School");
    await expect(page.getByLabel(/Drawing/)).toBeChecked();
    expect((await context.cookies(SITE)).find((c) => c.name === "rio_reg")).toMatchObject({ httpOnly: true });
    expect(await page.evaluate(() => document.cookie)).not.toContain("rio_reg");
    await page.getByLabel(/School name/).fill("Government Primary School, Salem");
    await page.getByLabel(/Singing/).check();
    await saveButton(page).click();
    await expect(page).toHaveURL(/saved=1/);
    expect(one<{ value_text: string }>("SELECT a.value_text FROM entry_answers a JOIN questions q ON q.id = a.question_id WHERE q.prompt_en = 'School name'").value_text).toBe("Government Primary School, Salem");
    expect(JSON.parse(one<{ value_json: string }>("SELECT a.value_json FROM entry_answers a JOIN questions q ON q.id = a.question_id WHERE q.prompt_en = 'Hobbies'").value_json)).toHaveLength(3);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM submissions").n).toBe(1);
  });

  test("a draft belonging to one competition is never edited from another competition's page", async () => {
    const { page } = parentOne;
    await page.goto(`/events/malalai-mozhi/register`);
    await expect(page.getByText(/saved draft for another competition/i)).toBeVisible();
    await expect(page.locator("#childName")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Government Primary School");
  });

  test("the draft opens on another device with the recovery code; a wrong code is refused alike", async () => {
    const { page, context } = await newPage(browser);
    await page.goto(`/events/${A}/register`);
    await page.locator("#recoveryCode").fill("AAAA-AAAA-AAAA-AAAA-AAAA-AAAA");
    await page.getByRole("button", { name: /Open draft/ }).click();
    await expect(page.getByText(/registration could not be found|கிடைக்கவில்லை/i).first()).toBeVisible();
    // A visitor without a draft always sees the empty new-registration form beside the recovery form; a wrong code must reveal nothing of any draft.
    await expect(page.locator("#childName")).toHaveValue("");
    await expect(page.locator("body")).not.toContainText("Asha");
    await page.locator("#recoveryCode").fill(recoveryCode);
    await page.getByRole("button", { name: /Open draft/ }).click();
    await expect(page.locator("#childName")).toHaveValue("Asha Kumar");
    expect(page.url()).not.toContain(recoveryCode);
    await context.close();
  });

  test("a new version is published; the started draft keeps its own questions, new entries get the new ones", async ({ request }) => {
    await admin.goto(`${ADMIN}/admin/events/${A}/questions`);
    await admin.getByRole("button", { name: /New draft from v1/ }).click();
    await addQuestion(admin, /Short text/, { ta: "பிடித்த பாடம்", en: "Favourite subject", required: true });
    await publish(admin);
    const events = (await (await request.get(`${API}/api/v1/events`)).json()) as { events: { slug: string; questionSet: { version: number; questions: { promptEn: string }[] } | null }[] };
    expect(events.events.find((e) => e.slug === A)?.questionSet?.version).toBe(2);
    expect(rows<{ version: number; status: string }>("SELECT qs.version, qs.status FROM question_sets qs JOIN events e ON e.id = qs.event_id WHERE e.slug = ? ORDER BY qs.version", A)).toEqual([{ version: 1, status: "retired" }, { version: 2, status: "published" }]);

    // The parent who started on version 1 still sees (and is checked against) version 1.
    const { page } = parentOne;
    await page.goto(`/events/${A}/register`);
    await expect(page.getByLabel(/School name/)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Favourite subject");
    await page.getByLabel(/School name/).fill("Government Primary School, Salem district");
    await saveButton(page).click();
    await expect(page).toHaveURL(/saved=1/);
    const first = one<{ v: number }>("SELECT qs.version AS v FROM submissions s JOIN question_sets qs ON qs.id = s.question_set_id").v;
    expect(first).toBe(1);

    // A new parent gets version 2, with its new required question.
    const second = await newPage(browser);
    await second.page.goto(`/events/${A}/register`);
    await expect(second.page.getByLabel(/Favourite subject/)).toBeVisible();
    await fillChild(second.page, { name: "Ravi Selvam", age: "10", parent: "Kumar Selvam", mobile: "9123456780" });
    await second.page.getByLabel(/School name/).fill("City School");
    await submit(second.page);
    await expect(second.page.getByText("Please answer this question.")).toBeVisible();
    await expect(second.page.locator('input[name="guardianConsent"]')).not.toBeChecked(); // consent is never carried over an error: it is given again
    await second.page.getByLabel(/Favourite subject/).fill("Tamil");
    await second.page.locator('input[name="guardianConsent"]').check();
    await saveButton(second.page).click();
    await expect(second.page).toHaveURL(/saved=1/);
    expect(rows<{ child_name: string; v: number }>("SELECT s.child_name, qs.version AS v FROM submissions s JOIN question_sets qs ON qs.id = s.question_set_id ORDER BY s.id")).toEqual([{ child_name: "Asha Kumar", v: 1 }, { child_name: "Ravi Selvam", v: 2 }]);
    await second.context.close();
  });

  test("the same child and mobile number registered again is accepted without telling the parent, and flagged for the administrator", async () => {
    // Stand-in for the final submission (not built yet): mark the first entry as submitted so it can be matched. Disposable database only.
    const stamp = (at: Date) => (MYSQL ? at.toISOString().slice(0, 23).replace("T", " ") : at.toISOString()); // the column format of each database
    const standIn = (db: { run: (sql: string, ...params: (string | number)[]) => void }) => {
      const id = one<{ id: number }>("SELECT id FROM submissions WHERE child_name = 'Asha Kumar'").id;
      const now = stamp(new Date());
      db.run("INSERT INTO video_uploads (submission_id, object_key, content_type, declared_bytes, status, expires_at, verified_at, verified_bytes) VALUES (?, ?, 'video/mp4', 200000, 'verified', ?, ?, 200000)", id, crypto.randomUUID(), stamp(new Date(Date.now() + 3_600_000)), now);
      db.run("UPDATE submissions SET status = 'finalized', submitted_at = ?, finalized_at = ? WHERE id = ?", now, now, id);
    };
    if (MYSQL) {
      standIn({ run: (sql, ...params) => void execFileSync(process.execPath, [BRIDGE, sql, JSON.stringify(params)], { encoding: "utf8" }) });
    } else {
      const db = new DatabaseSync(DB_PATH);
      try {
        db.exec("PRAGMA busy_timeout = 5000");
        standIn({ run: (sql, ...params) => void db.prepare(sql).run(...params) });
      } finally {
        db.close();
      }
    }
    const third = await newPage(browser);
    await third.page.goto(`/events/${A}/register`);
    await fillChild(third.page, { name: "  asha   kumar ", age: "9", parent: "Meena Kumar", mobile: MOBILE });
    await third.page.getByLabel(/School name/).fill("Another School");
    await third.page.getByLabel(/Favourite subject/).fill("Maths");
    await saveButton(third.page).click();
    await expect(third.page).toHaveURL(/saved=1/); // the parent sees the same result as for any other child
    await expect(third.page.getByText("Draft saved")).toBeVisible();
    await expect(third.page.locator("body")).not.toContainText(/duplicate|already registered/i);
    expect(rows<{ status: string; reason: string }>("SELECT status, reason FROM duplicate_reviews")).toEqual([{ status: "flagged", reason: "same_child_mobile_event" }]);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM submissions WHERE status = 'finalized'").n).toBe(1); // the database allows only one finalized entry per child
    await third.context.close();
  });

  test("the administrator sees the registrations from the same database, filters them, and opens one with its answers and contact details", async () => {
    await admin.goto(`${ADMIN}/admin/registrations`);
    await expect(admin.getByText("3 registrations")).toBeVisible();
    await expect(admin.getByText("Asha Kumar").first()).toBeVisible();
    await expect(admin.getByText("Possible duplicate")).toHaveCount(1);
    await expect(admin.locator("body")).not.toContainText(MOBILE); // contact details are not in the list

    await admin.locator("#status").selectOption("finalized");
    await admin.getByRole("button", { name: "Filter" }).click();
    await expect(admin.getByText("1 registration.")).toBeVisible();
    await admin.goto(`${ADMIN}/admin/registrations?competition=${B}`);
    await expect(admin.getByText("No registrations match.")).toBeVisible();

    const code = one<{ entry_code: string }>("SELECT entry_code FROM submissions WHERE child_name = 'Asha Kumar' AND status = 'finalized'").entry_code;
    const auditBefore = one<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'registration.viewed'").n;
    await admin.goto(`${ADMIN}/admin/registrations/${code}`);
    await expect(admin.getByText(MOBILE)).toBeVisible();
    await expect(admin.getByText("Government Primary School, Salem district")).toBeVisible();
    await expect(admin.getByText("Upper primary / உயர்")).toBeVisible();
    await expect(admin.getByText("Reading / வாசிப்பு; Drawing / ஓவியம்; Singing / பாடல்")).toBeVisible();
    await expect(admin.getByText("v1")).toBeVisible(); // answers are shown against the version the entry was created with
    await expect(admin.locator("body")).not.toContainText("Favourite subject");
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'registration.viewed'").n).toBe(auditBefore + 1);
    expect(JSON.stringify(rows("SELECT details FROM audit_log WHERE action = 'registration.viewed'"))).not.toMatch(/Asha|Meena|9876543210/);

    const dup = one<{ entry_code: string }>("SELECT entry_code FROM submissions WHERE status = 'draft' AND child_name LIKE 'asha%'").entry_code;
    await admin.goto(`${ADMIN}/admin/registrations/${dup}`);
    await expect(admin.getByText("Possible duplicate")).toBeVisible();
    await expect(admin.getByText("Same child name and mobile number in this competition")).toBeVisible();
  });

  test("the public API refuses what it should, and the browsers never talked to it or to any other service", async ({ request }) => {
    const body = { eventSlug: A, childName: "X Y", childAge: 9, guardianName: "P Q", guardianMobile: `+91${MOBILE}`, guardianConsent: { accepted: true, version: "v0-provisional" } };
    expect((await request.post(`${API}/api/v1/registrations`, { data: body, headers: { origin: "https://evil.example" } })).status()).toBe(403);
    expect((await request.post(`${API}/api/v1/registrations`, { data: body })).status()).toBe(403); // no Origin at all
    expect((await request.patch(`${API}/api/v1/registrations/current`, { data: {}, headers: { origin: SITE } })).status()).toBe(401); // no recovery cookie
    expect((await request.patch(`${API}/api/v1/admin/settings`, { data: { guardianConsentVersion: "x" }, headers: { origin: ADMIN } })).status()).toBe(401);
    expect((await request.get(`${API}/api/v1/admin/registrations`)).status()).toBe(401);
    expect((await request.get(`${API}/api/v1/admin/staff`)).status()).toBe(401);
    expect(await (await request.get(`${API}/api/v1/results`)).json()).toEqual({ state: "pending" });

    const origins = new Set(seen.filter((u) => /^https?:/.test(u)).map((u) => new URL(u).origin));
    expect([...origins].sort()).toEqual([ADMIN, SITE].sort());
    expect(seen.some((u) => /supabase/i.test(u))).toBe(false);
  });

  test("the staff session survives a refresh, and sign-out ends it on the API as well as in the browser", async ({ request }) => {
    await admin.goto(`${ADMIN}/admin`);
    await admin.reload();
    await expect(admin).toHaveURL(`${ADMIN}/admin`);
    const token = (await adminContext.cookies(ADMIN)).find((c) => c.name === "rio_staff")!.value;
    const me = () => request.get(`${API}/api/v1/staff/me`, { headers: { cookie: `rio_staff=${token}` } });
    expect((await me()).status()).toBe(200);
    await admin.getByRole("button", { name: /Sign out/ }).click();
    await expect(admin).toHaveURL(/\/staff\/login/);
    expect((await adminContext.cookies(ADMIN)).some((c) => c.name === "rio_staff")).toBe(false);
    await admin.goto(`${ADMIN}/admin`);
    await expect(admin).toHaveURL(/\/staff\/login/);
    expect((await me()).status()).toBe(401); // ended on the server, not only forgotten by the browser
    await admin.locator("#staff-email").fill(EMAIL);
    await admin.locator("#staff-password").fill(NEW_PASSWORD);
    await admin.locator('form button[type="submit"]').click();
    await expect(admin).toHaveURL(`${ADMIN}/admin`); // the chosen password works and no further change is asked
  });
});
