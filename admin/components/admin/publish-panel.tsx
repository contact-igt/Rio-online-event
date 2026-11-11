"use client";

import { useState } from "react";
import { publishAction } from "@/app/admin/events/[slug]/questions/actions";
import { SubmitButton } from "@/components/auth/submit-button";

// Two steps: "Publish…" only opens the confirmation; nothing is sent until the box is ticked and the confirm button is pressed.

type Props = { slug: string; setId: number; version: number; activeCount: number; inactiveCount: number; publishedVersion: number | null; blocked: boolean };

export function PublishPanel({ slug, setId, version, activeCount, inactiveCount, publishedVersion, blocked }: Props) {
  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={blocked} onClick={() => setOpen(true)}>
        <span>வெளியிடு…</span>
        <span lang="en" className="font-medium">Publish…</span>
      </button>
    );
  }
  return (
    <form action={publishAction} className="space-y-3 rounded-2xl border-2 border-rio-rose bg-white p-4" aria-labelledby="publish-title">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="setId" value={setId} />
      <h3 id="publish-title" className="font-display text-xl font-bold text-rio-navy">
        Publish version {version}? <span lang="ta" className="font-medium">/ பதிப்பு {version} ஐ வெளியிடவா?</span>
      </h3>
      <ul className="list-disc space-y-1 pl-5">
        <li>{activeCount} active question{activeCount === 1 ? "" : "s"} will be published. A published version cannot be edited; to change it you create a new draft.</li>
        {inactiveCount > 0 && <li>{inactiveCount} inactive question{inactiveCount === 1 ? " is" : "s are"} not published and will be removed from this draft.</li>}
        {publishedVersion !== null && <li>Version {publishedVersion} will be retired. Entries already started keep their answers on version {publishedVersion}.</li>}
        <li>Registration stays closed. This does not open it.</li>
      </ul>
      <label className="flex min-h-11 items-center gap-3 font-semibold text-rio-navy">
        <input type="checkbox" name="confirm" value="yes" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="h-6 w-6 accent-rio-rose" />
        I have checked the preview. / முன்னோட்டத்தைச் சரிபார்த்தேன்.
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <SubmitButton idle={{ en: "Publish now", ta: "இப்போது வெளியிடு" }} busy={{ en: "Publishing…", ta: "வெளியிடுகிறது…" }} disabled={!agreed} />
        <button type="button" className="btn btn-outline w-full sm:w-auto" onClick={() => { setOpen(false); setAgreed(false); }}>
          Cancel / ரத்து
        </button>
      </div>
    </form>
  );
}
