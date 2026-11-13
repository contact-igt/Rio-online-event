import type { EmailMessage } from "./resend.ts";

// The confirmation e-mail a parent receives once the entry is submitted: bilingual, Tamil first. It holds the child's name, the competition
// and the reference number, nothing else: no video, no link, no storage address, no mobile number. Every value is HTML-escaped.

export type Confirmation = { to: string; reference: string; childName: string; eventTa: string; eventEn: string };

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function confirmationEmail(c: Confirmation): EmailMessage {
  const subject = `பதிவு உறுதி / Registration confirmed: ${c.reference}`;
  const text = [
    `${c.childName} அவர்களின் பதிவு வெற்றிகரமாக முடிந்தது.`,
    `${c.childName} is registered successfully.`,
    "",
    `போட்டி / Competition: ${c.eventTa} / ${c.eventEn}`,
    `குறிப்பு எண் / Reference: ${c.reference}`,
    "",
    "இந்தக் குறிப்பு எண்ணைக் குறித்து வைத்துக்கொள்ளுங்கள். முடிவுகள் இணையதளத்தில் அறிவிக்கப்படும்.",
    "Please keep this reference number. Results will be announced on the website.",
    "",
    "ரியோ மருத்துவமனை · குழந்தைகள் தினக் கொண்டாட்டம் 2026",
    "Rio Hospital for Women & Children · Children's Day Celebration 2026",
  ].join("\n");
  const e = { child: escape(c.childName), ta: escape(c.eventTa), en: escape(c.eventEn), ref: escape(c.reference) };
  const html = `<!doctype html><html><body style="margin:0;background:#FFF1F6;font-family:Arial,Helvetica,sans-serif;color:#173B78">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:#ffffff;border-radius:16px;padding:24px">
<h1 style="margin:0 0 4px;font-size:22px;line-height:1.5">${e.child} அவர்களின் பதிவு வெற்றிகரமாக முடிந்தது</h1>
<p style="margin:0 0 16px;font-size:16px;color:#D4206B;font-weight:bold">${e.child} is registered successfully</p>
<p style="margin:0 0 4px;font-size:14px;color:#475569">போட்டி / Competition</p>
<p style="margin:0 0 16px;font-size:16px;font-weight:bold">${e.ta} / ${e.en}</p>
<div style="border:2px dashed #c9d6ea;background:#EAF4FC;border-radius:12px;padding:12px;text-align:center">
<p style="margin:0;font-size:13px;color:#475569">குறிப்பு எண் / Reference</p>
<p style="margin:4px 0 0;font-size:26px;font-weight:bold;letter-spacing:2px;font-family:Consolas,Menlo,monospace">${e.ref}</p>
</div>
<p style="margin:16px 0 0;font-size:14px;line-height:1.6">இந்தக் குறிப்பு எண்ணைக் குறித்து வைத்துக்கொள்ளுங்கள். முடிவுகள் இணையதளத்தில் அறிவிக்கப்படும்.<br>Please keep this reference number. Results will be announced on the website.</p>
</div>
<p style="margin:16px 0 0;font-size:12px;color:#475569;text-align:center">ரியோ மருத்துவமனை · குழந்தைகள் தினக் கொண்டாட்டம் 2026<br>Rio Hospital for Women &amp; Children · Children's Day Celebration 2026</p>
</div></body></html>`;
  return { to: c.to, subject, html, text, idempotencyKey: `rio-confirmation-${c.reference}` };
}
