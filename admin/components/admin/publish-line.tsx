import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { formatIst } from "@/lib/admin/format";

/** When the winners become public. Shared by the overview and the competition page. */
export function PublishLine({ publishAt, frozen }: { publishAt: string | null; frozen: boolean }) {
  const text = frozen
    ? { en: `Results are public since ${formatIst(publishAt)}. Winners can no longer change.`, ta: "முடிவுகள் வெளியிடப்பட்டன. வெற்றியாளர்களை இனி மாற்ற முடியாது." }
    : publishAt
      ? { en: `Results go public on ${formatIst(publishAt)}. Until then you can add and remove winners; nothing is shown before that time.`, ta: "குறித்த நேரத்தில் முடிவுகள் வெளியாகும். அதுவரை வெற்றியாளர்களைச் சேர்க்கலாம், நீக்கலாம்." }
      : { en: "No publication time is set, so nothing will be shown publicly. Set it in Event Settings when the winners are ready.", ta: "வெளியீட்டு நேரம் அமைக்கப்படவில்லை. நிகழ்வு அமைப்புகளில் அமைக்கவும்." };
  return (
    <p role="status" className="mt-4 flex items-start gap-3 rounded-2xl border border-rio-navy/10 bg-white p-3 font-semibold text-rio-navy">
      <Icon name={frozen ? "check" : "info"} className="mt-0.5 h-5 w-5 shrink-0" />
      <span>
        {text.en}
        <span lang="ta" className="mt-1 block font-medium">{text.ta}</span>
        {!frozen && <Link href="/admin/settings" className="mt-1 inline-flex min-h-11 items-center font-semibold text-rio-rose underline underline-offset-2">Event Settings / நிகழ்வு அமைப்புகள்</Link>}
      </span>
    </p>
  );
}
