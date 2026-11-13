import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import type { IconName } from "@/components/ui/icon";

// Shown where a screen needs data the Express API does not provide yet. It says so plainly and shows nothing invented.
export function ApiNotReady({
  title,
  titleTa,
  eyebrow = "Admin management",
  description,
  messageEn = "This workspace is not available yet.",
  messageTa = "இந்தப் பணியிடம் இன்னும் தயாராகவில்லை.",
  icon = "info",
  back = "/admin",
}: {
  title: string;
  titleTa?: string;
  eyebrow?: string;
  description?: string;
  messageEn?: string;
  messageTa?: string;
  icon?: IconName;
  back?: string;
}) {
  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <p lang="en" className="eyebrow">
        <span aria-hidden="true" className="h-px w-8 bg-current" />
        {eyebrow}
      </p>
      <h1 className="mt-2 text-[clamp(1.75rem,4vw,2rem)] font-bold leading-tight text-rio-navy">
        {titleTa && <span lang="ta" className="block">{titleTa}</span>}
        <span lang="en" className="mt-0.5 block text-base font-medium leading-snug text-rio-slate sm:text-lg">{title}</span>
      </h1>
      {description && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-rio-slate">{description}</p>}
      <div className="card mt-6 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rio-mist text-rio-navy"><Icon name={icon} className="h-5 w-5" /></span>
          <div>
            <p role="status" className="font-semibold leading-snug text-rio-navy">{messageEn}</p>
            <p lang="ta" className="mt-1 text-sm font-medium leading-relaxed text-rio-slate">{messageTa}</p>
          </div>
        </div>
        <p className="mt-4 rounded-xl bg-rio-mist px-4 py-3 text-sm leading-relaxed text-rio-slate">Nothing is shown here until the required server capability is available.</p>
        <Link href={back} className="btn btn-outline mt-5 w-full sm:w-auto">Back / திரும்பு</Link>
      </div>
    </section>
  );
}
