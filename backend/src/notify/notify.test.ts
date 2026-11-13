import { describe, expect, it } from "vitest";
import { testConfig } from "../test-helpers.ts";
import { confirmationEmail } from "./confirmation.ts";
import { resendMailer } from "./resend.ts";

const KEY = "re_test_abcdefghijklmnop";

describe("confirmation e-mail settings", () => {
  it("is off unless switched on, and sends only with a well-formed key and sender", () => {
    expect(testConfig().email).toEqual({ enabled: false, resend: null });
    expect(testConfig({ RIO_EMAIL_ENABLED: "yes" }).email).toEqual({ enabled: true, resend: null }); // on, but nothing to send with: messages wait
    expect(testConfig({ RIO_EMAIL_ENABLED: "true", RESEND_API_KEY: KEY, RIO_EMAIL_FROM: "a@b.org" }).email.enabled).toBe(false); // exactly "yes"
    expect(testConfig({ RESEND_API_KEY: KEY, RIO_EMAIL_FROM: "Rio Hospital <events@rio.example>" }).email.resend).toEqual({ apiKey: KEY, from: "Rio Hospital <events@rio.example>", replyTo: null });
    expect(testConfig({ RESEND_API_KEY: KEY, RIO_EMAIL_FROM: "events@rio.example", RIO_EMAIL_REPLY_TO: "help@rio.example" }).email.resend?.replyTo).toBe("help@rio.example");
    for (const bad of [{ RESEND_API_KEY: "not-a-key", RIO_EMAIL_FROM: "a@b.org" }, { RESEND_API_KEY: KEY, RIO_EMAIL_FROM: "nobody" }, { RESEND_API_KEY: KEY, RIO_EMAIL_FROM: "a@b.org", RIO_EMAIL_REPLY_TO: "x" }]) {
      expect(testConfig(bad).email.resend).toBeNull();
    }
  });
});

describe("Resend mailer", () => {
  const message = confirmationEmail({ to: "parent@example.org", reference: "RIO0007", childName: "Asha", eventTa: "கதை", eventEn: "Stories" });

  it("posts one message with the key only in the Authorization header and the reference as the idempotency key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const mailer = resendMailer({ apiKey: KEY, from: "Rio <events@rio.example>", replyTo: "help@rio.example" }, (async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response("{}", { status: 200 }))) as typeof fetch);
    expect(await mailer.send(message)).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers["Idempotency-Key"]).toBe("rio-confirmation-RIO0007");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ from: "Rio <events@rio.example>", to: ["parent@example.org"], reply_to: "help@rio.example" });
    expect(String(calls[0]!.init.body)).not.toContain(KEY);
  });

  it("says whether trying again could help, and refuses a header-breaking message without calling out", async () => {
    const answer = (status: number) => resendMailer({ apiKey: KEY, from: "a@b.org", replyTo: null }, (async () => new Response("", { status })) as unknown as typeof fetch);
    expect(await answer(429).send(message)).toEqual({ ok: false, retryable: true });
    expect(await answer(503).send(message)).toEqual({ ok: false, retryable: true });
    expect(await answer(422).send(message)).toEqual({ ok: false, retryable: false });
    const down = resendMailer({ apiKey: KEY, from: "a@b.org", replyTo: null }, (async () => { throw new Error("offline"); }) as unknown as typeof fetch);
    expect(await down.send(message)).toEqual({ ok: false, retryable: true });
    let called = false;
    const never = resendMailer({ apiKey: KEY, from: "a@b.org", replyTo: null }, (async () => ((called = true), new Response(""))) as unknown as typeof fetch);
    expect(await never.send({ ...message, to: "a@b.org, c@d.org" })).toEqual({ ok: false, retryable: false });
    expect(await never.send({ ...message, subject: "x\r\nBcc: c@d.org" })).toEqual({ ok: false, retryable: false });
    expect(called).toBe(false);
  });
});

describe("confirmation message", () => {
  it("escapes what the parent typed", () => {
    const m = confirmationEmail({ to: "p@example.org", reference: "RIO0001", childName: '<img src=x onerror="a">', eventTa: "கதை", eventEn: "Stories & more" });
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("&lt;img src=x onerror=&quot;a&quot;&gt;");
    expect(m.html).toContain("Stories &amp; more");
  });
});
